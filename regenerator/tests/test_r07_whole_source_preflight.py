"""R07-S1B1A synthetic-only source/membership cross-binding regression.

No original UFO files, screenshots, models, private paths or derived assets.
B1 witness is a handmade *synthetic* sample, not an attested real-world object.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import runpy
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PREFLIGHT, STUDIO, R03, SOURCE_FIT, BUILDER, SURFACE = map(Path, sys.argv[1:7])
del sys.argv[1:7]

CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def analytic_pixel_mask(expansion=(0, 0, 0), shift=(0, 0, 0)):
    # Independently constructed ray-box mask, not a FGM Evaluator output.
    pixels = set()
    dx, dy, dz = shift
    ex, ey, ez = expansion
    for py in range(40):
        for px in range(32):
            d, h = px + 0.5 - 16, py + 0.5 - 20
            lo = max(0, d, d / 2 + h, 2 + dx - ex, 3 + dy + d - ey,
                     dz + d / 2 + h - ez)
            hi = min(16, 16 + d, 24 + d / 2 + h,
                     5 + dx + ex, 6 + dy + d + ey, 2 + dz + d / 2 + h + ez)
            if hi > lo + 1e-9:
                pixels.add((px, py))
    return bytes(1 if (x, y) in pixels else 0
                 for y in range(40) for x in range(32))


class WholeSourcePreflight(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="fgmr-s1b1a-test-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.manifest = self.root / "selection.json"
        self.verified_path = self.root / "verified.json"
        self.output = self.root / "private-preflight.json"
        # MAP 2×1×1 with two separate TilePart placements. Adjacency and
        # equal terrain MCD alone do NOT establish membership; B1 supplies it.
        map_raw = bytes([1, 2, 1, 0, 1, 2, 2, 0, 1, 2, 2])
        loft = bytearray(64)
        for y in range(3, 6):
            struct.pack_into("<H", loft, y * 2, 0x3800)
        blanks = bytearray(124)
        blanks[42] = blanks[62 + 42] = 1
        terrain = bytearray(62)
        terrain[42] = 1
        terrain[8:20] = bytes([0] + [1] * 11)
        self.blobs = {"map": map_raw, "loft": bytes(loft),
                      "blanks": bytes(blanks), "terrain": bytes(terrain),
                      "tab": bytes(2), "palette": bytes(768),
                      "pck": bytes([0, *analytic_pixel_mask(), 255])}
        self.selection = {
            "schema": "fgmr-r07-local-selection/1",
            "object_key": "synthetic-two-tile-witness",
            "membership": {"status": "explicit",
                           "evidence_note": "B1 provided independently as a local witness"},
            "expected_source": {"dataset_label": "TERRAIN",
                                "local_index": 0, "part": "object"},
            "files": {},
            "spec": {
                "algorithm": "r06-cell/1", "coreRevision": CORE,
                "budget": 6144,
                "sourceBindings": {
                    "map": "map", "loft": "loft",
                    "datasets": [{"id": "BLANKS", "file": "blanks"},
                                 {"id": "TERRAIN", "file": "terrain"}],
                    "sprite": {"dataset": "TERRAIN", "pck": "pck",
                               "tab": "tab", "palette": "palette"}},
                "parameters": {"tile": [0, 0, 0], "part": "object",
                               "material": "stone", "frameSlot": 0,
                               "tabBits": 16, "paletteIndex": 0}
            }}
        for key, blob in self.blobs.items():
            (self.root / key).write_bytes(blob)
            self.selection["files"][key] = {"path": key, "sha256": digest(blob)}
        self.verified = {
            "schema": "fgm-regenerator/verified-membership-input-v1",
            "status": "verified_explicit_membership",
            "instance": "synthetic-instance",
            "prototype": "synthetic-prototype",
            "anchor_xyz": [0, 0, 0],
            "cell_bindings": [
                {"xyz": [x, 0, 0], "local_xyz": [x, 0, 0],
                 "part": "object", "dataset": "TERRAIN",
                 "record": 0, "map_record": x}
                for x in range(2)],
            "provenance": {
                "r02_sha256": digest(b"synthetic-r02"),
                "map_sha256": digest(map_raw),
                "datasets": [
                    {"id": "BLANKS", "sha256": digest(bytes(blanks))},
                    {"id": "TERRAIN", "sha256": digest(bytes(terrain))}],
                "manifest_sha256": digest(b"synthetic-entity-manifest"),
                "membership_witness_sha256": digest(b"synthetic-second-source"),
                "frame_source_sha256": digest(b"synthetic-frame-source"),
                "graph_sha256": digest(b"synthetic-graph")
            }}
        self.studio_hash = digest(STUDIO.read_bytes())
        self.r03_hash = digest(R03.read_bytes())

    def invoke(self, *, receipt_hash=None, r03_hash=None, studio_hash=None):
        self.manifest.write_bytes(canonical(self.selection))
        self.verified_path.write_bytes(canonical(self.verified))
        command = [sys.executable, str(PREFLIGHT),
                   "--manifest", str(self.manifest),
                   "--verified", str(self.verified_path),
                   "--verified-sha256", receipt_hash or digest(
                       self.verified_path.read_bytes()),
                   "--studio-native", str(STUDIO),
                   "--studio-sha256", studio_hash or self.studio_hash,
                   "--r03-native", str(R03),
                   "--r03-sha256", r03_hash or self.r03_hash,
                   "--output", str(self.output)]
        return subprocess.run(command, capture_output=True, text=True, timeout=120)

    def assert_fail(self, code):
        run = self.invoke()
        self.assertEqual(run.returncode, 2, run.stderr)
        self.assertIn(code, run.stderr)
        self.assertFalse(self.output.exists())
        self.assertNotIn(str(self.root), run.stderr)
        self.assertNotIn("source_index", run.stderr)

    def test_direct_r03_can_read_each_synthetic_tile(self):
        # Synthetic-only direct native diagnostic also guards MAP tile layout.
        for tile in (0, 1):
            cmd = [str(R03), "--map", str(self.root / "map"),
                   "--loft", str(self.root / "loft"),
                   "--mcd", "BLANKS=" + str(self.root / "blanks"),
                   "--mcd", "TERRAIN=" + str(self.root / "terrain"),
                   "--tile", f"{tile},0,0"]
            response = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            self.assertEqual(response.returncode, 0,
                             f"tile {tile}, native R03: {response.stderr}")
            data = json.loads(response.stdout)
            self.assertEqual(data["tile"]["xyz"], [tile, 0, 0])

    def test_native_two_member_preflight_passes_without_stage_a_claim(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(self.output.read_bytes())
        self.assertEqual(receipt["schema"], "fgmr-r07-whole-source-preflight/1")
        self.assertEqual(receipt["status"], "LOCAL_MEMBERSHIP_AND_SOURCE_CROSS_BOUND")
        self.assertEqual(receipt["stage_a"], "NOT_ACCEPTED")
        self.assertEqual(receipt["object_identity"],
                         "CONDITIONAL_ON_B1_WITNESS_NOT_AUTHENTICATED")
        self.assertEqual(receipt["checked_r03_rows"], 768)
        self.assertEqual(len(receipt["members"]), 2)
        self.assertEqual({x["map_record"] for x in receipt["members"]}, {0, 1})
        self.assertEqual({x["record"] for x in receipt["members"]}, {0})
        self.assertEqual({x["checked_rows"] for x in receipt["members"]}, {384})
        self.assertEqual({len(x["loft_ids"]) for x in receipt["members"]}, {12})
        self.assertEqual(receipt["native_sha256"]["r03"], self.r03_hash)
        self.assertEqual(receipt["native_sha256"]["studio"], self.studio_hash)
        self.assertNotIn(str(self.root), json.dumps(receipt))
        self.assertNotIn("indices_hex", json.dumps(receipt))
        self.assertNotIn("surface_pixels_xy", json.dumps(receipt))
        self.assertNotIn("stage_a_fit", json.dumps(receipt))

    def source_fit_command(self, *, second_x=1, preflight_sha=None, stale_preflight=False, axis_fit=False):
        self.assertEqual(self.invoke().returncode, 0)
        if stale_preflight:
            old = json.loads(self.output.read_bytes())
            old["members"][1]["loft_rows_sha256"] = "0" * 64
            self.output.write_bytes(canonical(old) + b"\n")
        second = copy.deepcopy(self.selection)
        second["spec"]["parameters"]["tile"][0] = second_x
        other = self.root / "second-selection.json"
        other.write_bytes(canonical(second))
        output = self.root / "source-fit"
        command = [sys.executable, str(SOURCE_FIT), "--manifest", str(self.manifest),
                   "--manifest", str(other), "--verified", str(self.verified_path),
                   "--verified-sha256", digest(self.verified_path.read_bytes()),
                   "--preflight", str(self.output), "--preflight-sha256",
                   preflight_sha or digest(self.output.read_bytes()), "--output", str(output)]
        for name, program in (("studio", STUDIO), ("r03", R03), ("whole-build", BUILDER),
                              ("surface", SURFACE)):
            command += [f"--{name}-native", str(program), f"--{name}-sha256",
                        digest(program.read_bytes())]
        if axis_fit:
            command.append("--axis-fit")
        return command, output

    def run_source_fit(self, **options):
        command, output = self.source_fit_command(**options)
        result = subprocess.run(command, capture_output=True, text=True, timeout=180)
        return result, output

    def test_source_fit_replays_preflight_and_uses_both_native_observations(self):
        sprite = bytes([0, *analytic_pixel_mask(expansion=(0.49,) * 3), 255])
        (self.root / "pck").write_bytes(sprite)
        self.selection["files"]["pck"]["sha256"] = digest(sprite)
        result, output = self.run_source_fit()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((output / "joint-fit-receipt.json").read_bytes())
        self.assertEqual(receipt["source"], "LOCAL_SOURCE_CHAIN_REPLAYED")
        self.assertEqual(receipt["stage_a"], "NOT_ACCEPTED")
        self.assertEqual(receipt["preflight_sha256"], digest(self.output.read_bytes()))
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)
        self.assertEqual(receipt["observed_parts"], 2)
        self.assertTrue(receipt["strictly_improved"], receipt["trace"])
        self.assertEqual(receipt["best_delta"], 0.49)
        self.assertEqual(receipt["winner_loss"]["micro"]["common"],
                         receipt["winner_loss"]["micro"]["union"])
        self.assertEqual([x["tile"] for x in receipt["observations"]], [[0, 0, 0], [1, 0, 0]])
        self.assertEqual(len({x["studio_proof_sha256"] for x in receipt["observations"]}), 2)
        model = json.loads((output / "whole-baseline.fgm.json").read_bytes())
        self.assertEqual(model["generation"]["algorithm"], "r06_multicell_loft_boxes")
        # Both FGM files and the receipt layout are frozen to accepted PR #63.
        # These three receipt fields depend on the platform's native binaries.
        self.assertEqual(receipt["native_sha256"], digest(SURFACE.read_bytes()))
        self.assertEqual(receipt["source_native_sha256"],
                         {"studio": digest(STUDIO.read_bytes()), "r03": digest(R03.read_bytes()),
                          "whole_build": digest(BUILDER.read_bytes())})
        raw = (output / "joint-fit-receipt.json").read_bytes()
        for key in ("native_sha256", "source_native_sha256", "preflight_sha256"):
            field = canonical({key: receipt[key]})[1:-1] + b","
            self.assertEqual(raw.count(field), 1)
            raw = raw.replace(field, b"")
        self.assertEqual(digest(raw), "a2318942862bb7c41da0d02549bc4ed03d699e330767e860c423cfb5d0f17992")
        self.assertEqual(digest((output / "whole-baseline.fgm.json").read_bytes()),
                         "fec273d778681c52c64e692276e11f2bb2e8d06a5ec0813413e303976e7d7a6d")
        self.assertEqual(digest((output / "whole-candidate.fgm.json").read_bytes()),
                         "522b9afccbf423414ac1cd546a57b23c7120ede688f30fd3c3f7d6a09bc392fd")
        # The local source path exports the EXACT inputs used to build this baseline.
        # Replay the new import through the real native Studio, without a second parser.
        commands = [{"v": 1, "action": "clear"}]
        def stage(name, path):
            data = path.read_bytes()
            for offset in range(0, len(data), 16384):
                commands.append({"v": 1, "action": "append", "file": name, "offset": offset,
                                 "hex": data[offset:offset+16384].hex()})
            return {"file": name, "sha256": digest(data)}
        bindings = {"receipt": stage("receipt", output / "receipt.json"),
                    "lofts": [stage("loft"+str(i), output / f"loft-{i}.json") for i in range(2)],
                    "fitted": stage("fitted", output / "fit-preview.json")}
        commands += [{"v": 1, "action": "start", "spec": {
            "algorithm": "r07-whole-preview/1", "coreRevision": "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b",
            "budget": 12288, "sourceBindings": bindings, "parameters": {"material": "stone"}}},
            {"v": 1, "action": "step", "runId": 1}, {"v": 1, "action": "finalize", "runId": 1}]
        replay = subprocess.run([str(STUDIO)], input=b"\n".join(canonical(c) for c in commands)+b"\n",
                                capture_output=True, timeout=60)
        self.assertEqual(replay.returncode, 0, replay.stderr)
        replies = [json.loads(line) for line in replay.stdout.splitlines()]
        self.assertTrue(all("error" not in r for r in replies), replies[-3:])
        self.assertEqual(replies[-1]["result"]["build"]["artifacts"][0]["sha256"], receipt["winner_sha256"])

    def test_axis_fit_moves_one_whole_model_without_changing_c05(self):
        sprite = bytes([0, *analytic_pixel_mask(shift=(0, 0.49, -0.49)), 255])
        (self.root / "pck").write_bytes(sprite)
        self.selection["files"]["pck"]["sha256"] = digest(sprite)
        result, output = self.run_source_fit(axis_fit=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((output / "joint-fit-receipt.json").read_bytes())
        self.assertEqual(receipt["schema"], "fgmr-r07-whole-source-fit-receipt/2")
        self.assertEqual(receipt["stage_a"], "NOT_ACCEPTED")
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)
        self.assertTrue(receipt["strictly_improved"])
        self.assertEqual(receipt["winner_transform"]["kind"], "axis_translation")
        for before, after in zip(receipt["baseline_loss"]["cells"],
                                 receipt["winner_loss"]["cells"], strict=True):
            self.assertGreater(after["common"] * before["union"],
                               before["common"] * after["union"])
        self.assertEqual(len(receipt["trace"]), 55)
        baseline = json.loads((output / "whole-baseline.fgm.json").read_bytes())
        model = json.loads((output / "whole-candidate.fgm.json").read_bytes())
        shift = receipt["winner_transform"]["delta"]
        self.assertEqual(model["generation"]["parameters"]["offset_xyz"], shift)
        before = baseline["model"]["contributions"][0]["field"]["program"]["nodes"]
        after = model["model"]["contributions"][0]["field"]["program"]["nodes"]
        offsets = [i for i, node in enumerate(before) if node["id"].startswith("offset_")]
        self.assertEqual(len(offsets), 2)
        for i in offsets:
            expected = [round(v + d, 3) for v, d in zip(before[i]["value"], shift, strict=True)]
            self.assertEqual(after[i]["value"], expected)
        self.assertEqual([n for i, n in enumerate(after) if i not in offsets],
                         [n for i, n in enumerate(before) if i not in offsets])

    def test_axis_fit_can_adjust_half_extents_independently(self):
        sprite = bytes([0, *analytic_pixel_mask(expansion=(0.49, -0.49, 0.49)), 255])
        (self.root / "pck").write_bytes(sprite)
        self.selection["files"]["pck"]["sha256"] = digest(sprite)
        result, output = self.run_source_fit(axis_fit=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((output / "joint-fit-receipt.json").read_bytes())
        self.assertTrue(receipt["strictly_improved"])
        self.assertEqual(receipt["winner_transform"]["kind"], "axis_extent")
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)
        loss = receipt["winner_loss"]["micro"]
        self.assertEqual(loss["common"], loss["union"])

    def test_axis_fit_output_bytes_repeat_on_same_native_build(self):
        command, output = self.source_fit_command(axis_fit=True)
        other = self.root / "other-output"
        command_other = [str(other) if arg == str(output) else arg for arg in command]
        for cmd in (command, command_other):
            run = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
            self.assertEqual(run.returncode, 0, run.stderr)
        for name in ("whole-baseline.fgm.json", "whole-candidate.fgm.json", "joint-fit-receipt.json"):
            self.assertEqual((output / name).read_bytes(), (other / name).read_bytes(), name)

    def test_axis_fit_candidate_native_fault_after_real_baseline_never_publishes(self):
        command, output = self.source_fit_command(axis_fit=True)
        with mock.patch.object(sys, "path", [str(SOURCE_FIT.resolve().parent), *sys.path]):
            main = runpy.run_path(str(SOURCE_FIT))["main"]
        run = subprocess.run
        for failure in ("exit", "timeout", "malformed"):
            with self.subTest(failure=failure):
                calls = 0

                def inject(args, **kwargs):
                    nonlocal calls
                    if not Path(args[0]).parent.name.startswith(".r07-joint-native-"):
                        return run(args, **kwargs)
                    calls += 1
                    if calls == 1:
                        result = run(args, **kwargs)
                        self.assertEqual(result.returncode, 0, result.stderr)
                        return result
                    if failure == "timeout":
                        raise subprocess.TimeoutExpired(args, kwargs["timeout"])
                    if failure == "malformed":
                        return subprocess.CompletedProcess(args, 0, b"{", b"")
                    return subprocess.CompletedProcess(args, 9, b"", b"unexpected native exit")

                stderr, stdout = io.StringIO(), io.StringIO()
                with (mock.patch.object(sys, "argv", command[1:]),
                      mock.patch.object(subprocess, "run", side_effect=inject),
                      mock.patch.object(sys, "stderr", stderr),
                      mock.patch.object(sys, "stdout", stdout)):
                    self.assertEqual(main(), 2)
                code = {"exit": "E_B1_NATIVE_FAILURE", "timeout": "E_B1_NATIVE_UNAVAILABLE",
                        "malformed": "E_B1_NATIVE_JSON"}[failure]
                self.assertEqual(stderr.getvalue(), f"R07-S1B1B1B: {code}\n")
                self.assertEqual(stdout.getvalue(), "")
                self.assertEqual(calls, 2)
                self.assertFalse(output.exists())

    def test_source_fit_requires_exact_preflight_and_distinct_members(self):
        for options, code in (({"preflight_sha": "0" * 64}, "E_SOURCE_PREFLIGHT_SHA"),
                              ({"stale_preflight": True}, "E_SOURCE_PREFLIGHT_REPLAY"),
                              ({"second_x": 0}, "E_SOURCE_DUPLICATE_MEMBER")):
            with self.subTest(code=code):
                if self.output.exists():
                    self.output.unlink()
                result, output = self.run_source_fit(**options)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertIn(code, result.stderr)
                self.assertFalse(output.exists())

    def test_repeated_runs_identical_private_receipt(self):
        self.assertEqual(self.invoke().returncode, 0)
        original = self.output.read_bytes()
        self.output = self.root / "new-private-receipt.json"
        self.assertEqual(self.invoke().returncode, 0)
        self.assertEqual(original, self.output.read_bytes())

    def test_external_receipt_sha_is_required(self):
        result = self.invoke(receipt_hash=digest(b"stale"))
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_S1B1A_RECEIPT_SHA", result.stderr)
        self.assertFalse(self.output.exists())

    def test_original_map_sha_mismatch_against_b1(self):
        self.verified["provenance"]["map_sha256"] = digest(b"old-map")
        self.assert_fail("E_S1B1A_MAP_SHA")

    def test_dataset_order_and_sha_are_exact(self):
        self.verified["provenance"]["datasets"].reverse()
        self.assert_fail("E_S1B1A_DATASET_ORDER_OR_SHA")
        self.verified["provenance"]["datasets"].reverse()
        self.verified["provenance"]["datasets"][1]["sha256"] = digest(b"stale")
        self.assert_fail("E_S1B1A_DATASET_ORDER_OR_SHA")

    def test_wrong_map_record_rejected_by_native_r03(self):
        self.verified["cell_bindings"][1]["map_record"] = 0
        self.assert_fail("E_S1B1A_R03_MAP_RECORD")

    def test_wrong_mcd_source_rejected_by_native_r03(self):
        self.verified["cell_bindings"][1]["record"] = 1
        self.assert_fail("E_S1B1A_R03_SOURCE")

    def test_wrong_local_transform_is_not_silently_shifted(self):
        self.verified["cell_bindings"][1]["local_xyz"] = [0, 0, 0]
        self.assert_fail("E_S1B1A_LOCAL_TRANSFORM")

    def test_selected_part_must_belong_to_exact_B1_instance(self):
        self.verified["cell_bindings"] = [self.verified["cell_bindings"][1]]
        self.assert_fail("E_S1B1A_SELECTED_MEMBER")

    def test_duplicate_tile_part_is_not_collapsed(self):
        self.verified["cell_bindings"].append(
            copy.deepcopy(self.verified["cell_bindings"][1]))
        self.assert_fail("E_S1B1A_DUPLICATE_TILE")

    def test_hypothetical_membership_is_never_promoted(self):
        self.verified["status"] = "hypothesis"
        self.assert_fail("E_S1B1A_MEMBERSHIP")

    def test_unrecognized_source_dataset_is_not_admitted(self):
        self.verified["cell_bindings"][1]["dataset"] = "UNBOUND"
        self.assert_fail("E_S1B1A_BINDING")

    def test_modified_original_byte_is_detected_by_source_hash(self):
        (self.root / "map").write_bytes(self.blobs["map"] + b"x")
        self.assert_fail("E_R07_LOCAL_SOURCE_DIGEST")

    def test_untrusted_native_binary_sha_fails_without_receipt(self):
        for key in ("studio_hash", "r03_hash"):
            result = self.invoke(**{key: digest(b"untrusted")})
            self.assertEqual(result.returncode, 2)
            self.assertFalse(self.output.exists())
            self.assertNotIn(str(self.root), result.stderr)

    def test_existing_receipt_is_never_replaced(self):
        self.output.write_text("do-not-clobber")
        result = self.invoke()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_S1B1A_OUTPUT_EXISTS", result.stderr)
        self.assertEqual(self.output.read_text(), "do-not-clobber")


if __name__ == "__main__":
    unittest.main(verbosity=2)
