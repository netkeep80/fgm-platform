#!/usr/bin/env python3
"""Проверить локальное свидетельство состава перед сборкой единой FGM-сущности."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

import build_r06_evidence as evidence

WITNESS_SCHEMA = "fgm-regenerator/membership-witness-v1"
FRAME_SCHEMA = "fgm-regenerator/frame-source-witness-v1"
OUTPUT_SCHEMA = "fgm-regenerator/verified-membership-input-v1"
MAX_WITNESS_BYTES = 1024 * 1024
MAX_MEMBERS = 4096


def ensure(condition, code="E_S2B_WITNESS"):
    if not condition:
        raise evidence.EvidenceError(code)


@contextmanager
def pinned_r02(path, expected_sha256):
    """Hash the bytes copied into a private staging directory, then run that copy.

    The original pathname is never executed after verification, even when it is
    atomically renamed/replaced between the digest check and the R02 call.
    """
    ensure(isinstance(expected_sha256, str) and
           evidence.DIGEST.fullmatch(expected_sha256), "E_S2B_R02_BINDING")
    with tempfile.TemporaryDirectory(prefix="fgmr-pinned-r02-") as directory:
        name = "r02-pinned.exe" if Path(path).suffix.lower() == ".exe" else "r02-pinned"
        pinned = Path(directory) / name
        digest = hashlib.sha256()
        count = 0
        with Path(path).open("rb") as source, pinned.open("xb") as target:
            for chunk in iter(lambda: source.read(65536), b""):
                count += len(chunk)
                ensure(count <= 100 * 1024 * 1024, "E_S2B_LIMIT")
                ensure(target.write(chunk) == len(chunk), "E_S2B_R02_BINDING")
                digest.update(chunk)
            target.flush()
            os.fsync(target.fileno())
        ensure(digest.hexdigest() == expected_sha256, "E_S2B_R02_BINDING")
        os.chmod(pinned, 0o700)
        yield pinned, digest.hexdigest()


def load_json(path):
    data = evidence.read_limited(path, MAX_WITNESS_BYTES)
    return json.loads(data, object_pairs_hook=evidence.unique_json), hashlib.sha256(data).hexdigest()


def normalized_member(value):
    evidence.object_fields(value, ("xyz", "part", "dataset", "record"))
    xyz = evidence.coordinates(value["xyz"])
    ensure(value["part"] in evidence.PARTS)
    dataset = evidence.identifier(value["dataset"])
    record = evidence.integer(value["record"], 0, 65535)
    return (xyz, value["part"], dataset, record)


def verify_membership(graph, manifest, witness):
    evidence.object_fields(witness, ("schema", "source", "instance", "prototype",
                                     "anchor", "members"))
    ensure(witness["schema"] == WITNESS_SCHEMA)
    source = evidence.identifier(witness["source"])
    instance = evidence.identifier(witness["instance"])
    prototype = evidence.identifier(witness["prototype"])
    anchor = evidence.coordinates(witness["anchor"], anchor=True)
    members = evidence.sequence(witness["members"])
    ensure(1 <= len(members) <= MAX_MEMBERS, "E_S2B_LIMIT")
    requested = [normalized_member(item) for item in members]
    ensure(len(set(requested)) == len(requested), "E_S2B_MEMBERSHIP")

    declared = [x for x in manifest.get("assemblies", [])
                if x["instance"] == instance and x["evidence"] == "explicit"]
    ensure(len(declared) == 1, "E_S2B_MEMBERSHIP")
    original = declared[0]
    ensure(original["source"] != source and original["prototype"] == prototype
           and tuple(original["anchor"]) == anchor, "E_S2B_WITNESS")
    ensure(set(normalized_member(x) for x in original["members"]) == set(requested),
           "E_S2B_MEMBERSHIP")

    nodes = {item["id"]: item for item in graph["nodes"]}
    instance_id = "instance/" + instance
    ensure(instance_id in nodes and tuple(nodes[instance_id]["anchor_xyz"]) == anchor,
           "E_S2B_MEMBERSHIP")
    types = [edge for edge in graph["edges"] if edge["relation"] == "instance_of"
             and edge["from"] == instance_id and edge["evidence"] == "explicit"]
    ensure(len(types) == 1 and types[0]["to"] == "prototype/" + prototype,
           "E_S2B_MEMBERSHIP")

    references = {}
    for edge in graph["edges"]:
        if edge["relation"] == "references_mcd":
            ensure(edge["from"] not in references, "E_S2B_GRAPH")
            references[edge["from"]] = edge["to"]
    chosen = [edge for edge in graph["edges"]
              if edge["relation"] == "member_of" and edge["to"] == instance_id
              and edge["evidence"] == "explicit"]
    ensure(len(chosen) == len(requested), "E_S2B_MEMBERSHIP")
    wanted = set(requested)
    unresolved = {item["from"] for item in graph["unknown"]
                  if item["relation"] == "member_of"}
    proven = []
    for edge in chosen:
        placement = nodes.get(edge["from"])
        ensure(placement is not None and placement["kind"] == "map_tile_placement",
               "E_S2B_GRAPH")
        record = references.get(edge["from"], "")
        ensure(record.startswith("mcd/"), "E_S2B_GRAPH")
        dataset, index = record[4:].rsplit("/", 1)
        key = (tuple(placement["xyz"]), placement["part"], dataset, int(index))
        ensure(key in wanted, "E_S2B_MEMBERSHIP")
        local = [point - origin for point, origin in zip(key[0], anchor, strict=True)]
        ensure(edge["local_xyz"] == local, "E_S2B_GRAPH")
        ensure(edge["from"] not in unresolved, "E_S2B_MEMBERSHIP")
        proven.append((key, placement["map_record"], local))
    ensure(len({item[0] for item in proven}) == len(requested), "E_S2B_MEMBERSHIP")
    return instance, prototype, anchor, sorted(proven)


def verified_input(arguments):
    manifest, manifest_hash = load_json(arguments.manifest)
    witness, witness_hash = load_json(arguments.witness)
    frames, frames_hash = load_json(arguments.frame_source)
    evidence.object_fields(frames, ("schema", "inventories"))
    ensure(frames["schema"] == FRAME_SCHEMA)
    ensure(frames["inventories"] == manifest.get("frame_inventories", []),
           "E_S2B_FRAME_BINDING")
    with pinned_r02(arguments.facts_tool, arguments.r02_sha256) as (pinned, r02_hash):
        facts = evidence.facts_snapshot(pinned, arguments.map, arguments.mcd)
    graph = evidence.build_graph(manifest, facts)
    graph_data = json.dumps(graph, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    ensure(len(graph_data) <= evidence.MAX_GRAPH_BYTES, "E_S2B_LIMIT")
    instance, prototype, anchor, members = verify_membership(graph, manifest, witness)
    bindings = [
        {"xyz": list(key[0]), "part": key[1], "dataset": key[2], "record": key[3],
         "map_record": index, "local_xyz": local}
        for key, index, local in members
    ]
    return {
        "schema": OUTPUT_SCHEMA,
        "instance": instance, "prototype": prototype, "anchor_xyz": list(anchor),
        "cell_bindings": bindings,
        "status": "verified_explicit_membership",
        "limits": {"source_bytes": evidence.MAX_SOURCE_BYTES,
                   "graph_bytes": evidence.MAX_GRAPH_BYTES,
                   "r02_timeout_seconds": evidence.R02_TIMEOUT_SECONDS},
        "provenance": {
            "r02_sha256": r02_hash,
            "map_sha256": manifest["map"]["sha256"],
            "datasets": manifest["datasets"],
            "manifest_sha256": manifest_hash,
            "membership_witness_sha256": witness_hash,
            "frame_source_sha256": frames_hash,
            "graph_sha256": hashlib.sha256(graph_data).hexdigest()
        }
    }


def publish_receipt(output, payload):
    """Publish a fully written same-filesystem staging file without replacement.

    os.link is an atomic create-if-absent operation on supported local
    filesystems (POSIX and Windows/NTFS). Unsupported filesystem: fail closed.
    """
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output.parent,
                                         prefix=".verified-s2b-", delete=False) as staging:
            temporary = Path(staging.name)
            staging.write(payload)
            staging.flush()
            os.fsync(staging.fileno())
        try:
            os.link(temporary, output)
        except FileExistsError as error:
            raise evidence.EvidenceError("E_S2B_OUTPUT_EXISTS") from error
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--facts-tool", required=True)
    parser.add_argument("--r02-sha256", required=True)
    parser.add_argument("--map", required=True)
    parser.add_argument("--mcd", action="append", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--witness", type=Path, required=True)
    parser.add_argument("--frame-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        ensure(not args.output.exists(), "E_S2B_OUTPUT_EXISTS")
        receipt = verified_input(args)
        payload = (json.dumps(receipt, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
        ensure(len(payload) <= MAX_WITNESS_BYTES, "E_S2B_LIMIT")
        publish_receipt(args.output, payload)
    except evidence.EvidenceError as error:
        print("R06-S2B1: " + str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, IndexError, RecursionError):
        print("R06-S2B1: E_S2B_INPUT", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
