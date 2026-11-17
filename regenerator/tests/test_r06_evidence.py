"""Синтетическая проверка R06-S2A через настоящий декодер MAP/MCD."""
import hashlib
import os
import time
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SCRIPT, R02, VERIFIER = map(Path, sys.argv[1:4])
del sys.argv[1:4]
sys.path.insert(0, str(SCRIPT.parent))
import build_r06_evidence as evidence
import verify_r06_membership as verifier


def digest(data):
    return hashlib.sha256(data).hexdigest()


def record(frames=(0,) * 8, *, door=False, ufo_door=False, die=0, alt=0,
           target_type=0):
    raw = bytearray(62)
    raw[:8] = bytes(frames)
    raw[30] = int(ufo_door)
    raw[35] = int(door)
    raw[42] = 20
    raw[44] = die
    raw[46] = alt
    raw[53] = 3
    raw[59] = target_type
    return bytes(raw)


class EvidenceTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        # Объект 2×2 занимает x=0,1. Два одиночных соседа — x=2,3.
        # Внизу x=2,3 те же исходные записи, но без подтверждения состава.
        parts = bytes([1, 0, 0, 2] * 8)
        self.map = bytes([2, 4, 1]) + parts
        blank = record() + record()
        terrain = (record((3, 4, 3, 5, 5, 5, 3, 4), door=True, die=1)
                   + record(ufo_door=True, target_type=1))
        self.map_path = self.write("private-map.MAP", self.map)
        self.mcd_paths = [self.write("private-first.MCD", blank),
                          self.write("private-second.MCD", terrain)]
        self.manifest = {
            "schema": "fgm-regenerator/entity-evidence-manifest-v1",
            "map": {"id": "sample", "sha256": digest(self.map)},
            "dataset_order_source": "terrain-rule",
            "datasets": [{"id": "first", "sha256": digest(blank)},
                         {"id": "second", "sha256": digest(terrain)}],
            "assemblies": [
                self.assembly("square", "square-type", [0, 0, 0],
                              [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]]),
                self.assembly("left", "single-type", [2, 0, 0], [[2, 0, 0]]),
                self.assembly("right", "single-type", [3, 0, 0], [[3, 0, 0]]),
                self.assembly("maybe", "guess-type", [2, 1, 0],
                              [[2, 1, 0], [3, 1, 0]], "hypothesis"),
            ],
            "frame_inventories": [
                {"atlas": "terrain/second", "source": "terrain-atlas-index",
                 "frames": [0, 3, 4]},
                {"atlas": "actor/unit-sheet", "source": "actor-atlas-index",
                 "frames": [10, 40]},
            ],
            "actors": [
                {"id": "unit", "armor": {"source": "armor-rule",
                 "sprite_sheet": "unit-sheet", "drawing_routine": 0, "size": 1},
                 "observations": [
                     {"id": "north", "source": "unit-trace", "facing": 0,
                      "time_phase": 1, "state": "walking", "pose": "standing",
                      "configuration": "equipped",
                      "parts": [{"role": "legs", "atlas_scope": "body", "frame": 10},
                                {"role": "torso", "atlas_scope": "body", "frame": 40},
                                {"role": "weapon", "sprite_sheet": "item-sheet",
                                 "frame": 70}]},
                     {"id": "west", "source": "unit-trace", "camera_view": 0,
                      "facing": 6, "time_phase": 2, "state": "walking",
                      "parts": [{"role": "legs", "atlas_scope": "body", "frame": 11},
                                {"role": "torso"}]},
                 ]},
                {"id": "unknown-unit"},
            ],
        }

    @staticmethod
    def assembly(instance, prototype, anchor, coordinates, evidence="explicit"):
        return {"instance": instance, "prototype": prototype, "anchor": anchor,
                "source": "assembly-witness", "evidence": evidence,
                "members": [{"xyz": xyz, "part": "object",
                             "dataset": "second", "record": 0}
                            for xyz in coordinates]}

    def write(self, name, data):
        path = self.root / name
        path.write_bytes(data)
        return path

    def run_graph(self, *, reverse=False):
        manifest = self.write("private-evidence.json",
                              json.dumps(self.manifest).encode("utf-8"))
        pairs = list(zip(("first", "second"), self.mcd_paths, strict=True))
        if reverse:
            pairs.reverse()
        arguments = [sys.executable, str(SCRIPT), "--facts-tool", str(R02),
                     "--map", str(self.map_path), "--manifest", str(manifest)]
        for label, path in pairs:
            arguments.extend(["--mcd", f"{label}={path}"])
        return subprocess.run(arguments, capture_output=True, check=False)

    def graph(self):
        result = self.run_graph()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return json.loads(result.stdout)

    def assert_rejected(self, code, **options):
        result = self.run_graph(**options)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        self.assertIn(code.encode(), result.stderr)
        self.assertNotIn(b"private-", result.stderr)

    def test_full_placements_and_independent_grouping_oracle(self):
        graph = self.graph()
        nodes = {node["id"]: node for node in graph["nodes"]}
        placements = {node["id"]: (node["xyz"], node["part"])
                      for node in nodes.values() if node["kind"] == "map_tile_placement"}
        by_instance = {}
        for edge in graph["edges"]:
            if edge["relation"] == "member_of" and edge["evidence"] == "explicit":
                xyz, part = placements[edge["from"]]
                self.assertEqual(part, "object")
                instance = nodes[edge["to"]]["input_id"]
                by_instance.setdefault(instance, {})[tuple(xyz)] = edge["local_xyz"]
        # Список ожидаемых связей выведен из ручной разметки карты независимо.
        self.assertEqual(by_instance, {
            "square": {(0, 0, 0): [0, 0, 0], (1, 0, 0): [1, 0, 0],
                       (0, 1, 0): [0, 1, 0], (1, 1, 0): [1, 1, 0]},
            "left": {(2, 0, 0): [0, 0, 0]},
            "right": {(3, 0, 0): [0, 0, 0]},
        })
        same_record = [edge["to"] for edge in graph["edges"]
                       if edge["relation"] == "references_mcd"
                       and placements[edge["from"]][1] == "object"]
        self.assertEqual(len(same_record), 8)
        self.assertEqual(len(set(same_record)), 1)
        self.assertEqual(len(placements), 16)
        unknown = {tuple(placements[item["from"]][0]) for item in graph["unknown"]
                   if item["relation"] == "member_of"
                   and placements[item["from"]][1] == "object"}
        self.assertEqual(unknown, {(2, 1, 0), (3, 1, 0)})
        guesses = [edge for edge in graph["edges"]
                   if edge["relation"] == "member_of" and edge["evidence"] == "hypothesis"]
        self.assertEqual(len(guesses), 2)
        self.assertTrue(all(edge["provenance"][0]["input_id"] == "assembly-witness"
                            for edge in guesses))
        for edge in graph["edges"]:
            self.assertIn(edge["from"], nodes)
            self.assertIn(edge["to"], nodes)
            self.assertTrue(edge["provenance"])
            self.assertTrue(all(item["input_id"] and item["locator"] and item["version"]
                                for item in edge["provenance"]))

    def test_time_slots_doors_and_frame_uncertainty(self):
        graph = self.graph()
        nodes = {node["id"]: node for node in graph["nodes"]}
        reference = next(edge["to"] for edge in graph["edges"]
                         if edge["relation"] == "references_mcd"
                         and nodes[edge["from"]]["part"] == "object")
        slots = {nodes[edge["to"]]["time_phase"]: edge["to"] for edge in graph["edges"]
                 if edge["relation"] == "has_observation" and edge["from"] == reference}
        self.assertEqual(sorted(slots), list(range(8)))
        self.assertTrue(all(nodes[node]["facing"] is None and
                            nodes[node]["camera_view"] is None for node in slots.values()))
        frames = {edge["from"]: nodes[edge["to"]]["frame"] for edge in graph["edges"]
                  if edge["relation"] == "references_frame"}
        self.assertEqual([frames[slots[phase]] for phase in range(8)], [3, 4, 3, 5, 5, 5, 3, 4])
        for relation, target in (("open_replacement_record", 0), ("destroyed_as", 1)):
            edge = next(edge for edge in graph["edges"]
                        if edge["from"] == reference and edge["relation"] == relation)
            self.assertEqual(nodes[edge["to"]]["record"], target)
            self.assertEqual(edge["evidence"], "derived")
        self.assertFalse(any(edge["relation"] == "opens_as" and edge["from"] == reference
                             for edge in graph["edges"]))
        target = next(node["id"] for node in graph["nodes"]
                      if node["kind"] == "mcd_record" and node["dataset"] == "second"
                      and node["record"] == 1)
        ufo_slots = {edge["to"]: nodes[edge["to"]]["time_phase"] for edge in graph["edges"]
                     if edge["relation"] == "has_observation" and edge["from"] == target}
        transitions = {(ufo_slots[edge["from"]], ufo_slots[edge["to"]], edge["event"])
                       for edge in graph["edges"] if edge["relation"] == "next_phase"
                       and edge["from"] in ufo_slots}
        self.assertEqual(transitions, {(0, 1, "open"), (1, 2, "tick"), (2, 7, "tick"),
                                       (3, 4, "tick"), (4, 5, "tick"), (5, 6, "tick"),
                                       (6, 7, "tick")} |
                         {(phase, 0, "close") for phase in range(1, 8)})
        self.assertTrue(all(edge["applicable_parts"] == ["floor", "west_wall", "north_wall"]
                            for edge in graph["edges"] if edge.get("event") == "close"))
        state_edges = {ufo_slots[edge["from"]]: nodes[edge["to"]]["name"]
                       for edge in graph["edges"] if edge["relation"] == "phase_state"
                       and edge["from"] in ufo_slots}
        self.assertEqual(state_edges, {0: "closed", 1: "opening", 2: "opening", 3: "opening",
                                      4: "opening", 5: "opening", 6: "opening", 7: "fully_open"})
        self.assertTrue(any(item["reason"] == "frame_not_in_inventory"
                            and nodes[item["from"]]["frame"] == 5 for item in graph["unknown"]))

    def test_actor_observations_keep_axes_parts_and_missing_evidence(self):
        graph = self.graph()
        nodes = {node["id"]: node for node in graph["nodes"]}
        observations = {node["input_id"]: node for node in nodes.values()
                        if node["kind"] == "observation" and "input_id" in node}
        north, west = observations["north"], observations["west"]
        self.assertEqual((north["camera_view"], north["facing"], north["time_phase"]),
                         (None, 0, 1))
        self.assertEqual((west["camera_view"], west["facing"], west["time_phase"]), (0, 6, 2))
        self.assertEqual((north["pose"], north["configuration"]), ("standing", "equipped"))
        parts = [nodes[edge["to"]]["role"] for edge in graph["edges"]
                 if edge["relation"] == "has_actor_part" and edge["from"] == north["id"]]
        self.assertEqual(parts, ["legs", "torso", "weapon"])
        self.assertTrue(any(item["reason"] == "actor_rule_missing" for item in graph["unknown"]))
        self.assertTrue(any(item["reason"] == "actor_frame_missing" for item in graph["unknown"]))
        frame_refs = [nodes[edge["to"]] for edge in graph["edges"]
                      if edge["relation"] == "references_frame"
                      and nodes[edge["from"]]["kind"] == "actor_part"
                      and nodes[edge["from"]]["role"] == "weapon"]
        self.assertEqual([(node["atlas"], node["frame"]) for node in frame_refs],
                         [("actor/item-sheet", 70)])

    def test_equipment_without_sheet_never_uses_armor_atlas(self):
        del self.manifest["actors"][0]["observations"][0]["parts"][2]["sprite_sheet"]
        graph = self.graph()
        weapon, = [node["id"] for node in graph["nodes"] if node.get("role") == "weapon"]
        self.assertFalse(any(edge["relation"] == "references_frame" and edge["from"] == weapon
                             for edge in graph["edges"]))
        self.assertTrue(any(item["reason"] == "actor_sheet_missing" and item["from"] == weapon
                            for item in graph["unknown"]))

    def test_large_actor_footprint_and_inherited_atlas_keep_armor_provenance(self):
        actor = self.manifest["actors"][0]
        actor["armor"]["size"] = 2
        actor["observations"][0]["parts"][0]["footprint_part"] = 3
        graph = self.graph()
        nodes = {node["id"]: node for node in graph["nodes"]}
        edge, = [edge for edge in graph["edges"] if edge["relation"] == "references_frame"
                 and nodes[edge["from"]].get("footprint_part") == 3]
        self.assertEqual(edge["evidence"], "derived")
        self.assertEqual(nodes[edge["to"]]["atlas"], "actor/unit-sheet")
        self.assertEqual({item["input_id"] for item in edge["provenance"]},
                         {"unit-trace", "armor-rule", "OpenXcom"})
        actor["observations"][0]["parts"][0]["footprint_part"] = 4
        self.assert_rejected("E_EVIDENCE_MANIFEST")

    def test_missing_armor_does_not_invent_unspecified_sheet(self):
        del self.manifest["actors"][0]["armor"]
        graph = self.graph()
        self.assertTrue(any(item["reason"] == "actor_sheet_missing"
                            for item in graph["unknown"]))

    def test_order_conflict_with_equally_sized_valid_datasets(self):
        self.assert_rejected("E_EVIDENCE_DATASET_ORDER", reverse=True)

    def test_missing_order_witness_is_rejected(self):
        del self.manifest["dataset_order_source"]
        self.assert_rejected("E_EVIDENCE_MANIFEST")

    def test_reject_wrong_map_and_dataset_digests(self):
        self.manifest["map"]["sha256"] = "1" * 64
        self.assert_rejected("E_EVIDENCE_INPUT_BINDING")
        self.manifest["map"]["sha256"] = digest(self.map)
        self.manifest["datasets"][0]["sha256"] = "2" * 64
        self.assert_rejected("E_EVIDENCE_INPUT_BINDING")

    def test_reject_conflicting_confirmations_and_wrong_record(self):
        self.manifest["assemblies"][2]["members"][0]["xyz"] = [2, 0, 0]
        self.assert_rejected("E_EVIDENCE_MEMBERSHIP_CONFLICT")
        self.manifest["assemblies"][2]["members"][0]["xyz"] = [3, 0, 0]
        self.manifest["assemblies"][2]["members"][0]["record"] = 1
        self.assert_rejected("E_EVIDENCE_MEMBER_BINDING")

    def test_reproducible_output_excludes_input_paths_bytes_and_digests(self):
        first = self.run_graph()
        second = self.run_graph()
        self.assertEqual(first.returncode, 0, first.stderr.decode())
        self.assertEqual(first.stdout, second.stdout)
        self.assertNotIn(b"private-", first.stdout)
        self.assertNotIn(b"raw_hex", first.stdout)
        self.assertNotIn(b"sha256", first.stdout)
        self.assertNotIn(digest(self.map).encode(), first.stdout)


    def verified_command(self, *, instance="square", witness_mutation=None,
                         frame_mutation=None, expected_sha=None):
        confirmed = next(x for x in self.manifest["assemblies"]
                         if x["instance"] == instance)
        witness = {
            "schema": "fgm-regenerator/membership-witness-v1",
            "source": "independent-local-witness",
            "instance": confirmed["instance"], "prototype": confirmed["prototype"],
            "anchor": list(confirmed["anchor"]),
            "members": json.loads(json.dumps(confirmed["members"]))
        }
        frames = {"schema": "fgm-regenerator/frame-source-witness-v1",
                  "inventories": json.loads(json.dumps(self.manifest["frame_inventories"]))}
        if witness_mutation:
            witness_mutation(witness)
        if frame_mutation:
            frame_mutation(frames)
        witness_file = self.write("private-witness.json", json.dumps(witness).encode())
        frame_file = self.write("private-frames.json", json.dumps(frames).encode())
        manifest_file = self.write("private-evidence.json",
                                   json.dumps(self.manifest).encode())
        result_file = self.root / "private-verified.json"
        command = [sys.executable, str(VERIFIER), "--facts-tool", str(R02),
                   "--r02-sha256", expected_sha if expected_sha is not None
                   else digest(R02.read_bytes()),
                   "--map", str(self.map_path), "--manifest", str(manifest_file),
                   "--witness", str(witness_file), "--frame-source", str(frame_file),
                   "--output", str(result_file)]
        for label, path in zip(("first", "second"), self.mcd_paths, strict=True):
            command.extend(["--mcd", f"{label}={path}"])
        return command, result_file

    def run_verified(self, **kwargs):
        command, result_file = self.verified_command(**kwargs)
        return subprocess.run(command, capture_output=True, check=False), result_file

    def test_verified_membership_local_receipt_is_deterministic(self):
        result, path = self.run_verified()
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, b"")
        proof = json.loads(path.read_text())
        self.assertEqual(proof["schema"], "fgm-regenerator/verified-membership-input-v1")
        self.assertEqual(proof["status"], "verified_explicit_membership")
        self.assertEqual((proof["instance"], proof["prototype"], proof["anchor_xyz"]),
                         ("square", "square-type", [0, 0, 0]))
        self.assertEqual([part["xyz"] for part in proof["cell_bindings"]],
                         [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]])
        self.assertEqual([part["local_xyz"] for part in proof["cell_bindings"]],
                         [part["xyz"] for part in proof["cell_bindings"]])
        self.assertTrue(all(part["dataset"] == "second" and part["record"] == 0
                            for part in proof["cell_bindings"]))
        self.assertEqual(proof["provenance"]["r02_sha256"], digest(R02.read_bytes()))
        self.assertNotIn("private-", path.read_text())
        snapshot = path.read_bytes()
        path.unlink()
        again, same = self.run_verified()
        self.assertEqual(again.returncode, 0, again.stderr.decode())
        self.assertEqual(snapshot, same.read_bytes())

    def test_verified_membership_separates_two_neighbors(self):
        for instance, xyz in (("left", [2, 0, 0]), ("right", [3, 0, 0])):
            result, path = self.run_verified(instance=instance)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            self.assertEqual(json.loads(path.read_text())["cell_bindings"][0]["xyz"], xyz)
            path.unlink()

    def test_verified_membership_rejects_hypothesis(self):
        result, path = self.run_verified(instance="maybe")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_MEMBERSHIP", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_changed_witness_and_duplicate(self):
        result, path = self.run_verified(
            witness_mutation=lambda w: w["members"][0].update(record=1))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_MEMBERSHIP", result.stderr)
        self.assertFalse(path.exists())
        result, path = self.run_verified(
            witness_mutation=lambda w: w["members"].append(w["members"][0].copy()))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_MEMBERSHIP", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_nonindependent_witness(self):
        result, path = self.run_verified(
            witness_mutation=lambda w: w.update(source="assembly-witness"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_WITNESS", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_wrong_r02_version(self):
        result, path = self.run_verified(expected_sha="0" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_R02_BINDING", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_frame_source_drift(self):
        result, path = self.run_verified(
            frame_mutation=lambda f: f["inventories"][0]["frames"].append(555))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_FRAME_BINDING", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_resource_limits_without_output(self):
        result, path = self.run_verified(
            witness_mutation=lambda w: w.update(source="x" * (1024 * 1024 + 1)))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_EVIDENCE_LIMIT", result.stderr)
        self.assertFalse(path.exists())
        self.map_path.write_bytes(b"!" * (8 * 1024 * 1024 + 1))
        result, path = self.run_verified()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_EVIDENCE_LIMIT", result.stderr)
        self.assertFalse(path.exists())

    def test_verified_membership_rejects_existing_output_and_no_private_errors(self):
        output = self.root / "private-verified.json"
        output.write_text("keep")
        result, path = self.run_verified(expected_sha="0" * 64)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"E_S2B_OUTPUT_EXISTS", result.stderr)
        self.assertEqual(path.read_text(), "keep")
        self.assertNotIn(b"private-", result.stderr)


    def test_p2_01_r02_stdout_cap_enforced_before_process_exits(self):
        # An adversarial child writes >64KiB and sleeps; the spool stays capped.
        recorded_writes = []
        original_temporary = evidence.tempfile.TemporaryFile

        class ObservedSpool:
            def __init__(self, file):
                self.file = file

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.file.close()

            def write(self, data):
                recorded_writes.append(len(data))
                return self.file.write(data)

            def __getattr__(self, name):
                return getattr(self.file, name)

        def observed_file(*args, **kwargs):
            return ObservedSpool(original_temporary(*args, **kwargs))

        code = ("import sys,time; sys.stdout.buffer.write(b'X'*65536); "
                "sys.stdout.buffer.flush(); time.sleep(4)")
        started = time.monotonic()
        with (mock.patch.object(evidence, "MAX_R02_BYTES", 1024),
              mock.patch.object(evidence.tempfile, "TemporaryFile",
                                side_effect=observed_file)):
            with self.assertRaisesRegex(evidence.EvidenceError, "^E_EVIDENCE_LIMIT$"):
                evidence.read_r02_json([sys.executable, "-c", code])
        self.assertLessEqual(sum(recorded_writes), 1024)
        self.assertLess(time.monotonic() - started, 3.5)

    def test_p2_01_r02_timeout_kills_and_reaps(self):
        started = time.monotonic()
        with mock.patch.object(evidence, "R02_TIMEOUT_SECONDS", 0.25):
            with self.assertRaisesRegex(evidence.EvidenceError, "^E_EVIDENCE_R02_TIMEOUT$"):
                evidence.read_r02_json([sys.executable, "-c",
                                        "import time; time.sleep(3)"])
        self.assertLess(time.monotonic() - started, 2.0)

    def test_p2_02_preexisting_target_created_in_publish_window(self):
        output = self.root / "private-race.json"
        actual_link = os.link

        def create_target_between_check_and_link(source, target):
            Path(target).write_bytes(b"do-not-overwrite")
            return actual_link(source, target)

        with mock.patch.object(verifier.os, "link",
                               side_effect=create_target_between_check_and_link):
            with self.assertRaisesRegex(evidence.EvidenceError, "^E_S2B_OUTPUT_EXISTS$"):
                verifier.publish_receipt(output, b"would-overwrite")
        self.assertEqual(output.read_bytes(), b"do-not-overwrite")
        self.assertEqual(list(self.root.glob(".verified-s2b-*")), [])

    def test_p2_02_concurrent_verifiers_one_wins_no_overwrite(self):
        command, output = self.verified_command()
        first = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        second = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        results = []
        for process in (first, second):
            stdout, stderr = process.communicate(timeout=30)
            results.append((process.returncode, stdout, stderr))
        self.assertEqual(sorted(row[0] for row in results), [0, 2], results)
        self.assertTrue(any(b"E_S2B_OUTPUT_EXISTS" in row[2]
                            for row in results if row[0] == 2))
        self.assertEqual(json.loads(output.read_bytes())["status"],
                         "verified_explicit_membership")
        self.assertEqual(list(self.root.glob(".verified-s2b-*")), [])

    def test_p2_03_swap_original_executable_after_pin_runs_checked_copy(self):
        original = self.root / ("private-r02.exe" if R02.suffix.lower() == ".exe"
                                else "private-r02")
        original.write_bytes(R02.read_bytes())
        expected = digest(original.read_bytes())
        with verifier.pinned_r02(original, expected) as (pinned, digest_result):
            self.assertEqual(digest_result, expected)
            original.write_bytes(b"invalid-replaced-binary")
            inputs = [f"{name}={path}" for name, path in
                      zip(("first", "second"), self.mcd_paths, strict=True)]
            facts = evidence.facts_snapshot(pinned, self.map_path, inputs)
            self.assertEqual(facts["schema"], "fgm-regenerator/map-mcd-facts-v1")
            self.assertEqual(digest(pinned.read_bytes()), expected)
        self.assertFalse(pinned.exists())
        self.assertNotEqual(digest(original.read_bytes()), expected)


if __name__ == "__main__":
    unittest.main()
