#!/usr/bin/env python3
"""Построить локальный доказательный граф на основе проверенного вывода R02."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import threading
import time

FACTS_SCHEMA = "fgm-regenerator/map-mcd-facts-v1"
MANIFEST_SCHEMA = "fgm-regenerator/entity-evidence-manifest-v1"
GRAPH_SCHEMA = "fgm-regenerator/entity-evidence-graph-v1"
OPENXCOM_REVISION = "4a4bae5fa2e5a09282928e84943fc84b093e34ff"
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}")
DIGEST = re.compile(r"[a-f0-9]{64}")
PARTS = ("floor", "west_wall", "north_wall", "object")
OBSERVATION_AXES = ("camera_view", "facing", "time_phase", "state", "pose", "configuration")
START_POINT = 1
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_R02_BYTES = 48 * 1024 * 1024
MAX_GRAPH_BYTES = 32 * 1024 * 1024
MAX_NODES = 150000
MAX_EDGES = 400000
MAX_UNKNOWN = 150000
R02_TIMEOUT_SECONDS = 20


class EvidenceError(ValueError):
    """Ошибка с безопасным кодом без исходных путей и значений."""


def require(condition, code="E_EVIDENCE_MANIFEST"):
    if not condition:
        raise EvidenceError(code)


def object_fields(value, required, optional=()):
    require(isinstance(value, dict) and set(required) <= value.keys()
            and value.keys() <= set(required) | set(optional))
    return value


def sequence(value):
    require(isinstance(value, list))
    return value


def identifier(value):
    require(isinstance(value, str) and IDENTIFIER.fullmatch(value))
    return value


def integer(value, minimum, maximum):
    require(type(value) is int and minimum <= value <= maximum)
    return value


def coordinates(value, *, anchor=False):
    require(isinstance(value, list) and len(value) == 3)
    return tuple(integer(component, -255 if anchor else 0, 254) for component in value)


def unique_json(pairs):
    result = dict(pairs)
    require(len(result) == len(pairs))
    return result


def digest_matches(expected, actual):
    require(isinstance(expected, str) and DIGEST.fullmatch(expected))
    require(expected == actual, "E_EVIDENCE_INPUT_BINDING")


def read_limited(path, maximum):
    with Path(path).open("rb") as source:
        data = source.read(maximum + 1)
    require(len(data) <= maximum, "E_EVIDENCE_LIMIT")
    return data


def source_size_budget(map_path, mcd_arguments):
    paths = [Path(map_path)]
    for entry in mcd_arguments:
        require("=" in entry)
        label, value = entry.split("=", 1)
        identifier(label)
        require(value)
        paths.append(Path(value))
    require(1 <= len(paths) <= 17)
    total = 0
    for path in paths:
        size = path.stat().st_size
        require(0 <= size <= MAX_SOURCE_BYTES, "E_EVIDENCE_LIMIT")
        total += size
        require(total <= MAX_SOURCE_BYTES, "E_EVIDENCE_LIMIT")


def read_r02_json(command):
    """Consume R02 stdout with a hard spool cap, and reap on overflow/timeout.

    read1() returns available pipe data without waiting for a full 64 KiB block.
    The worker never writes a chunk that would exceed MAX_R02_BYTES.
    """
    with tempfile.TemporaryFile() as output:
        with subprocess.Popen(command, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL) as process:
            failure = []
            def drain():
                written = 0
                try:
                    while True:
                        chunk = process.stdout.read1(65536)
                        if not chunk:
                            break
                        if written + len(chunk) > MAX_R02_BYTES:
                            failure.append("E_EVIDENCE_LIMIT")
                            return
                        output.write(chunk)
                        written += len(chunk)
                except OSError:
                    failure.append("E_EVIDENCE_R02_REJECTED")

            deadline = time.monotonic() + R02_TIMEOUT_SECONDS
            reader = threading.Thread(target=drain, daemon=True)
            reader.start()
            reader.join(max(0.0, deadline - time.monotonic()))
            if reader.is_alive() or failure:
                timed_out = reader.is_alive()
                process.kill()
                process.wait()
                reader.join()
                raise EvidenceError("E_EVIDENCE_R02_TIMEOUT" if timed_out else failure[0])
            try:
                remaining = max(0.0, deadline - time.monotonic())
                returncode = process.wait(timeout=remaining)
            except subprocess.TimeoutExpired as error:
                process.kill()
                process.wait()
                raise EvidenceError("E_EVIDENCE_R02_TIMEOUT") from error
            require(returncode == 0, "E_EVIDENCE_R02_REJECTED")
        output.seek(0)
        return json.load(output, object_pairs_hook=unique_json)


def facts_snapshot(facts_tool, map_path, mcd_arguments):
    source_size_budget(map_path, mcd_arguments)
    facts = read_r02_json(
        [str(facts_tool), "--map", str(map_path),
         *(arg for item in mcd_arguments for arg in ("--mcd", item))])
    require(facts["schema"] == FACTS_SCHEMA, "E_EVIDENCE_R02_SCHEMA")
    return facts


def bind_inputs(manifest, facts):
    map_input = object_fields(manifest["map"], ("id", "sha256"))
    map_id = identifier(map_input["id"])
    order_source = identifier(manifest["dataset_order_source"])
    expected_datasets = sequence(manifest["datasets"])
    for item in expected_datasets:
        object_fields(item, ("id", "sha256"))
        identifier(item["id"])
    datasets = facts["datasets"]
    require([item["id"] for item in expected_datasets] == [item["id"] for item in datasets],
            "E_EVIDENCE_DATASET_ORDER")

    # Восстанавливаем хеш именно декодированного снимка, без повторного чтения файлов.
    map_hash = hashlib.sha256(bytes(facts["map"]["header_yxz"]))
    for tile in facts["map"]["tiles"]:
        map_hash.update(bytes(part["source_index"] for part in tile["parts"]))
    digest_matches(map_input["sha256"], map_hash.hexdigest())
    for expected, dataset in zip(expected_datasets, datasets, strict=True):
        mcd_hash = hashlib.sha256()
        for record in dataset["records"]:
            mcd_hash.update(bytes.fromhex(record["raw_hex"]))
        digest_matches(expected["sha256"], mcd_hash.hexdigest())
    return map_id, order_source


def provenance(input_id, locator, version=MANIFEST_SCHEMA):
    return {"input_id": input_id, "locator": locator, "version": version}


def source_rule(locator):
    return provenance("OpenXcom", locator, OPENXCOM_REVISION)


class EvidenceGraph:
    def __init__(self):
        self.nodes = {}
        self.edges = []
        self.unknown = []

    def node(self, node_id, kind, **fields):
        value = {"id": node_id, "kind": kind, **fields}
        if node_id in self.nodes:
            require(self.nodes[node_id] == value, "E_EVIDENCE_ID_COLLISION")
        else:
            require(len(self.nodes) < MAX_NODES, "E_EVIDENCE_LIMIT")
            self.nodes[node_id] = value
        return node_id

    def edge(self, origin, target, relation, evidence, *sources, **fields):
        require(len(self.edges) < MAX_EDGES, "E_EVIDENCE_LIMIT")
        self.edges.append({"from": origin, "to": target, "relation": relation,
                           "evidence": evidence, "provenance": sources, **fields})

    def unresolved(self, origin, relation, reason, *sources):
        require(len(self.unknown) < MAX_UNKNOWN, "E_EVIDENCE_LIMIT")
        self.unknown.append({"from": origin, "to": None, "relation": relation,
                             "evidence": "unknown", "reason": reason,
                             "provenance": sources})


def load_frame_inventories(manifest):
    inventories = {}
    for index, item in enumerate(sequence(manifest.get("frame_inventories", []))):
        object_fields(item, ("atlas", "source", "frames"))
        atlas = item["atlas"]
        require(isinstance(atlas, str) and "/" in atlas)
        kind, name = atlas.split("/", 1)
        require(kind in ("terrain", "actor") and identifier(name) and atlas not in inventories)
        frames = sequence(item["frames"])
        present = {integer(frame, 0, 65535) for frame in frames}
        require(len(present) == len(frames))
        source = provenance(identifier(item["source"]), f"/frame_inventories/{index}/frames")
        inventories[atlas] = (present, source)
    return inventories


def link_frame(graph, inventories, origin, atlas, frame, evidence, *sources):
    node_id = f"frame/{atlas}/{frame}"
    if node_id not in graph.nodes:
        graph.node(node_id, "frame", atlas=atlas, frame=frame)
        if atlas not in inventories:
            graph.unresolved(node_id, "frame_availability", "frame_inventory_missing", *sources)
        else:
            frames, inventory_source = inventories[atlas]
            if frame in frames:
                graph.nodes[node_id]["declared_availability"] = inventory_source
            else:
                graph.unresolved(node_id, "frame_availability", "frame_not_in_inventory",
                                 *sources, inventory_source)
    graph.edge(origin, node_id, "references_frame", evidence, *sources)


def terrain_record_id(dataset, index):
    return f"mcd/{dataset}/{index}"


def terrain_fields(record):
    return {field: record[field] for field in
            ("loft", "tile_type", "big_wall", "door", "ufo_door",
             "gravlift", "target_type", "alt_mcd", "die_mcd")}


def terrain_observations(graph, inventories, dataset, record, record_id):
    index = record["index"]
    atlas = f"terrain/{dataset}"
    mcd_locator = f"record/{index}"
    slots = []
    for phase, frame in enumerate(record["frame"]):
        slot_id = graph.node(f"{record_id}/slot/{phase}", "observation",
                             camera_view=None, facing=None, time_phase=phase,
                             state=None, pose=None, configuration=None)
        slots.append(slot_id)
        source = provenance(dataset, f"{mcd_locator}/Frame/{phase}", FACTS_SCHEMA)
        graph.edge(record_id, slot_id, "has_observation", "explicit", source)
        link_frame(graph, inventories, slot_id, atlas, frame, "explicit", source)

    # Применяем правила движка к данным записи, сохраняя события и их условия.
    ufo_door = bool(record["ufo_door"])
    record_source = provenance(dataset, mcd_locator, FACTS_SCHEMA)
    animate_rule = source_rule("src/Savegame/Tile.cpp#L626-L647")
    open_rule = source_rule("src/Savegame/Tile.cpp#L342-L365")
    states = {}
    if ufo_door:
        for state in ("closed", "opening", "fully_open"):
            states[state] = graph.node(f"{record_id}/state/{state}", "state", name=state)
    for phase, slot_id in enumerate(slots):
        if ufo_door:
            state = {0: "closed", 7: "fully_open"}.get(phase, "opening")
            graph.edge(slot_id, states[state], "phase_state", "derived", record_source, open_rule)
        if not ufo_door or phase not in (0, 7):
            target = (phase + 1) % 8
            sources = [record_source, animate_rule]
            if ufo_door and record["target_type"] == START_POINT and target == 3:
                target = 7
                sources.append(source_rule("src/Mod/MapData.h#L27-L29"))
            graph.edge(slot_id, slots[target], "next_phase", "derived", *sources, event="tick")
        if ufo_door and phase > 0:
            graph.edge(slot_id, slots[0], "next_phase", "derived", record_source,
                       source_rule("src/Savegame/Tile.cpp#L369-L379"),
                       source_rule("src/Savegame/Tile.h#L142-L146"),
                       event="close", applicable_parts=PARTS[:3])
    if ufo_door and not record["door"]:
        graph.edge(slots[0], slots[1], "next_phase", "derived", record_source,
                   open_rule, event="open")

    if record["door"]:
        graph.edge(record_id, terrain_record_id(dataset, record["alt_mcd"]),
                   "open_replacement_record", "derived",
                   provenance(dataset, f"{mcd_locator}/Alt_MCD", FACTS_SCHEMA),
                   source_rule("src/Savegame/Tile.cpp#L342-L353"))
    if not record["gravlift"] and record["die_mcd"] != 0:
        graph.edge(record_id, terrain_record_id(dataset, record["die_mcd"]),
                   "destroyed_as", "derived", provenance(dataset, f"{mcd_locator}/Die_MCD", FACTS_SCHEMA),
                   source_rule("src/Savegame/Tile.cpp#L469-L480"))


def add_terrain(graph, facts, map_id, order_source, inventories):
    source_id = graph.node(f"map/{map_id}", "source_resource", format="MAP", input_id=map_id,
                           dimensions_xyz=facts["map"]["dimensions_xyz"],
                           dataset_order=[dataset["id"] for dataset in facts["datasets"]])
    for dataset in facts["datasets"]:
        name = dataset["id"]
        dataset_id = graph.node(f"mcd/{name}", "source_resource", format="MCD", input_id=name)
        for record in dataset["records"]:
            index = record["index"]
            record_id = graph.node(terrain_record_id(name, index), "mcd_record",
                                   dataset=name, record=index, **terrain_fields(record))
            graph.edge(dataset_id, record_id, "has_record", "explicit",
                       provenance(name, f"record/{index}", FACTS_SCHEMA))
            terrain_observations(graph, inventories, name, record, record_id)

    placements = {}
    for tile in facts["map"]["tiles"]:
        xyz = tile["x"], tile["y"], tile["z"]
        record = tile["record_index"]
        for part in tile["parts"]:
            if not part["present"]:
                continue
            kind = part["kind"]
            placement_id = graph.node(f"{source_id}/{record}/{kind}", "map_tile_placement",
                                      xyz=xyz, part=kind, map_record=record,
                                      source_index=part["source_index"])
            loc = provenance(map_id, f"record/{record}/{kind}", FACTS_SCHEMA)
            graph.edge(source_id, placement_id, "has_placement", "explicit", loc)
            dataset, index = part["dataset"], part["local_index"]
            graph.edge(placement_id, terrain_record_id(dataset, index), "references_mcd", "derived",
                       loc, provenance(order_source, "/datasets"),
                       provenance(dataset, f"record/{index}", FACTS_SCHEMA),
                       source_rule("src/Mod/RuleTerrain.cpp#L175-L197"))
            placements[(xyz, kind)] = (placement_id, dataset, index, loc)
    return placements


def add_assemblies(graph, manifest, placements):
    assigned = set()
    seen_instances = set()
    for index, item in enumerate(sequence(manifest.get("assemblies", []))):
        object_fields(item, ("prototype", "instance", "anchor", "members", "source", "evidence"))
        instance = identifier(item["instance"])
        prototype = identifier(item["prototype"])
        anchor = coordinates(item["anchor"], anchor=True)
        source = identifier(item["source"])
        evidence = item["evidence"]
        members = sequence(item["members"])
        require(evidence in ("explicit", "hypothesis") and members and instance not in seen_instances)
        seen_instances.add(instance)
        prototype_id = graph.node(f"prototype/{prototype}", "prototype_candidate", input_id=prototype)
        instance_id = graph.node(f"instance/{instance}", "instance_candidate",
                                 input_id=instance, anchor_xyz=anchor)
        pointer = f"/assemblies/{index}"
        graph.edge(instance_id, prototype_id, "instance_of", evidence, provenance(source, pointer))
        seen_placements = set()
        for member_index, member in enumerate(members):
            object_fields(member, ("xyz", "part", "dataset", "record"))
            xyz = coordinates(member["xyz"])
            part = member["part"]
            require(part in PARTS)
            key = (xyz, part)
            match = placements.get(key)
            bound = (identifier(member["dataset"]), integer(member["record"], 0, 65535))
            require(match is not None and match[1:3] == bound, "E_EVIDENCE_MEMBER_BINDING")
            require(key not in seen_placements
                    and (evidence != "explicit" or key not in assigned),
                    "E_EVIDENCE_MEMBERSHIP_CONFLICT")
            seen_placements.add(key)
            if evidence == "explicit":
                assigned.add(key)
            graph.edge(match[0], instance_id, "member_of", evidence,
                       provenance(source, f"{pointer}/members/{member_index}"), match[3],
                       local_xyz=[cell - origin for cell, origin in zip(xyz, anchor, strict=True)])

    for key, (placement_id, _, _, loc) in placements.items():
        if key not in assigned:
            graph.unresolved(placement_id, "member_of", "membership_unconfirmed", loc)


def add_actor_observation(graph, inventories, observation, actor_id, armor, armor_source, pointer):
    object_fields(observation, ("id", "source", "parts"), OBSERVATION_AXES)
    observation_id = identifier(observation["id"])
    node_id = f"{actor_id}/observation/{observation_id}"
    require(node_id not in graph.nodes)
    axes = {axis: observation.get(axis) for axis in OBSERVATION_AXES}
    for axis, value in axes.items():
        if value is None:
            continue
        if axis in ("camera_view", "facing", "time_phase"):
            integer(value, 0, 7 if axis == "facing" else 65535)
        else:
            identifier(value)
    source_id = identifier(observation["source"])
    graph.node(node_id, "observation", input_id=observation_id, **axes)
    graph.edge(actor_id, node_id, "has_observation", "explicit", provenance(source_id, pointer))
    parts = sequence(observation["parts"])
    if not parts:
        graph.unresolved(node_id, "has_actor_part", "actor_parts_missing",
                         provenance(source_id, f"{pointer}/parts"))
    for layer, part in enumerate(parts):
        object_fields(part, ("role",), ("sprite_sheet", "atlas_scope", "frame", "footprint_part"))
        body_sheet = part.get("atlas_scope") == "body"
        if "atlas_scope" in part:
            require(body_sheet and "sprite_sheet" not in part)
        position = part.get("footprint_part")
        if position is not None:
            integer(position, 0, armor["size"] ** 2 - 1 if armor else 65535)
        layer_id = graph.node(f"{node_id}/layer/{layer}", "actor_part",
                              role=identifier(part["role"]), layer=layer, footprint_part=position)
        source = provenance(source_id, f"{pointer}/parts/{layer}")
        graph.edge(node_id, layer_id, "has_actor_part", "explicit", source)
        default_sheet = body_sheet and armor is not None
        sheet = armor["sprite_sheet"] if default_sheet else part.get("sprite_sheet")
        frame = part.get("frame")
        if frame is not None:
            integer(frame, 0, 65535)
        if sheet is not None:
            identifier(sheet)
        if frame is None:
            graph.unresolved(layer_id, "references_frame", "actor_frame_missing", source)
        elif sheet is None:
            graph.unresolved(layer_id, "references_frame", "actor_sheet_missing", source)
        elif default_sheet:
            link_frame(graph, inventories, layer_id, f"actor/{sheet}", frame, "derived",
                       source, armor_source, source_rule("src/Battlescape/Map.cpp#L1557-L1562"))
        else:
            link_frame(graph, inventories, layer_id, f"actor/{sheet}", frame, "explicit", source)


def add_actors(graph, manifest, inventories):
    for index, actor in enumerate(sequence(manifest.get("actors", []))):
        object_fields(actor, ("id",), ("armor", "observations"))
        input_id = identifier(actor["id"])
        actor_id = f"actor/{input_id}"
        require(actor_id not in graph.nodes)
        graph.node(actor_id, "actor_candidate", input_id=input_id)
        pointer = f"/actors/{index}"
        armor = actor.get("armor")
        armor_source = None
        if armor is None:
            graph.unresolved(actor_id, "has_armor_rule", "actor_rule_missing",
                             provenance(input_id, f"{pointer}/armor"))
        else:
            object_fields(armor, ("source", "sprite_sheet", "drawing_routine", "size"))
            armor_id = graph.node(f"{actor_id}/armor", "armor_rule",
                                  sprite_sheet=identifier(armor["sprite_sheet"]),
                                  drawing_routine=integer(armor["drawing_routine"], 0, 65535),
                                  size=integer(armor["size"], 1, 255))
            armor_source = provenance(identifier(armor["source"]), f"{pointer}/armor")
            graph.edge(actor_id, armor_id, "has_armor_rule", "explicit", armor_source)
        observations = sequence(actor.get("observations", []))
        if not observations:
            graph.unresolved(actor_id, "has_observation", "actor_observations_missing",
                             provenance(input_id, f"{pointer}/observations"))
        for number, observation in enumerate(observations):
            add_actor_observation(graph, inventories, observation, actor_id, armor, armor_source,
                                  f"{pointer}/observations/{number}")


def build_graph(manifest, facts):
    object_fields(manifest, ("schema", "map", "dataset_order_source", "datasets"),
                  ("assemblies", "frame_inventories", "actors"))
    require(manifest["schema"] == MANIFEST_SCHEMA)
    map_id, order_source = bind_inputs(manifest, facts)
    graph = EvidenceGraph()
    inventories = load_frame_inventories(manifest)
    placements = add_terrain(graph, facts, map_id, order_source, inventories)
    add_assemblies(graph, manifest, placements)
    add_actors(graph, manifest, inventories)
    return {"schema": GRAPH_SCHEMA, "decoder": FACTS_SCHEMA,
            "reference_revision": OPENXCOM_REVISION, "nodes": list(graph.nodes.values()),
            "edges": graph.edges, "unknown": graph.unknown}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--facts-tool", required=True)
    parser.add_argument("--map", required=True)
    parser.add_argument("--mcd", action="append", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    arguments = parser.parse_args()

    try:
        manifest = json.loads(read_limited(arguments.manifest, MAX_MANIFEST_BYTES),
                              object_pairs_hook=unique_json)
        facts = facts_snapshot(arguments.facts_tool, arguments.map, arguments.mcd)
        graph = build_graph(manifest, facts)
        output = json.dumps(graph, ensure_ascii=True, separators=(",", ":"))
        require(len(output.encode("utf-8")) <= MAX_GRAPH_BYTES, "E_EVIDENCE_LIMIT")
    except EvidenceError as error:
        print(f"R06-S2A: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        print("R06-S2A: E_EVIDENCE_INPUT", file=sys.stderr)
        return 2
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
