"""R07-S1B0: source-backed native R03/R04/R05/C05 fit with analytic synthetic target."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

PILOT, STUDIO, R03, SURFACE = map(Path, sys.argv[1:5])
del sys.argv[1:5]
CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b"

# Import the actual pilot for deterministic injection *after* an actual native
# S0/R03/S1A baseline call; no stand-in FGM evaluator or fake successful fit.
sys.path.insert(0, str(PILOT.parent.resolve()))
spec = importlib.util.spec_from_file_location("r07_local_fit", PILOT)
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def analytic_box(delta):
    """Six independent slab planes; synthetic LOFT profile zero occupies z in [0,2]."""
    pixels = set()
    for py in range(40):
        for px in range(32):
            d = px + 0.5 - 16
            h = py + 0.5 - 20
            lo = max(0, d, d/2+h,
                     2-delta, 3-delta+d, 0-delta+d/2+h)
            hi = min(16, 16+d, 24+d/2+h,
                     5+delta, 6+delta+d, 2+delta+d/2+h)
            if hi > lo + 1e-9:
                pixels.add((px, py))
    return pixels


def fixture(root, target_delta):
    map_raw = bytes([1, 1, 1, 0, 1, 2, 2])
    loft = bytearray(64)
    blank = bytearray(124)
    terrain = bytearray(62)
    for y in range(3, 6):
        struct.pack_into("<H", loft, y * 2, 0x3800)
    blank[42] = blank[62+42] = 1
    terrain[42] = 1
    terrain[8:20] = bytes([0] + [1] * 11)
    source = {"map": map_raw, "loft": bytes(loft), "blanks": bytes(blank),
              "terrain": bytes(terrain), "tab": bytes(2), "palette": bytes(768)}
    oracle = analytic_box(0.0 if target_delta is None else target_delta)
    raster = [1 if (x, y) in oracle else 0
              for y in range(40) for x in range(32)]
    source["pck"] = bytes([0, *raster, 255])
    selection = {
        "schema": "fgmr-r07-local-selection/1",
        "object_key": "synthetic-source-linked-part",
        "membership": {"status": "hypothesis",
                       "evidence_note": "No independently attested ObjectDefinition"},
        "expected_source": {"dataset_label": "TERRAIN", "local_index": 0, "part": "object"},
        "files": {},
        "spec": {
            "algorithm": "r06-cell/1", "coreRevision": CORE, "budget": 6144,
            "sourceBindings": {
                "map": "map", "loft": "loft",
                "datasets": [{"id": "BLANKS", "file": "blanks"},
                             {"id": "TERRAIN", "file": "terrain"}],
                "sprite": {"dataset": "TERRAIN", "pck": "pck",
                           "tab": "tab", "palette": "palette"},
            },
            "parameters": {"tile": [0, 0, 0], "part": "object", "material": "stone",
                           "frameSlot": 0, "tabBits": 16, "paletteIndex": 0}
        }
    }
    for name, raw in source.items():
        (root / name).write_bytes(raw)
        selection["files"][name] = {"path": name, "sha256": sha(raw)}
    return selection


class LocalFitPilot(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fgmr-s1b0-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest = self.root / "selection.json"
        self.output = self.root / "private-result"

    def invoke(self, document):
        self.manifest.write_text(json.dumps(document), encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(PILOT), "--manifest", str(self.manifest),
             "--studio-native", str(STUDIO), "--r03-native", str(R03),
             "--surface-native", str(SURFACE), "--output", str(self.output)],
            capture_output=True, text=True, timeout=180)

    def test_original_synthetic_sprite_constrained_improvement(self):
        selection = fixture(self.root, target_delta=0.375)
        run = self.invoke(selection)
        self.assertEqual(run.returncode, 0, run.stderr)
        receipt = json.loads((self.output / "stage-a-fit-pilot-receipt.json").read_text())
        self.assertEqual(receipt["stage_a"], "PARAMETERS_IMPROVED_IDENTITY_UNRESOLVED")
        self.assertEqual(receipt["object_identity"], "NOT_INDEPENDENTLY_ATTESTED")
        self.assertTrue(receipt["loss"]["strictly_improved"])
        self.assertNotEqual(receipt["best_delta"], 0)
        self.assertEqual(receipt["r03_source"]["loft_ids"], [0] + [1]*11)
        self.assertEqual(receipt["c05"]["checked"], 6144)
        self.assertEqual(receipt["loss"]["best"]["iou"], 1.0)
        accepted = [x for x in receipt["candidates"] if x["gate"] == "C05_PASS"]
        self.assertGreaterEqual(len(accepted), 2)
        self.assertEqual(accepted[0]["delta"], 0)
        self.assertEqual(len({x["surface_sha256"] for x in accepted}) > 1, True)
        self.assertEqual(len({x["model_sha256"] for x in accepted}) > 1, True)
        for name in ("model-baseline.fgm.json", "model-candidate.fgm.json",
                     "surface-baseline.json", "surface-candidate.json"):
            self.assertTrue((self.output / name).is_file())
        self.assertNotIn(str(self.root), json.dumps(receipt))
        self.assertNotIn("indices_hex", json.dumps(receipt))
        self.assertNotIn("surface_pixels_xy", json.dumps(receipt))
        fit_model = json.loads((self.output / "model-candidate.fgm.json").read_text())
        self.assertEqual(fit_model["format"], "fgm-package/1")
        self.assertEqual(fit_model["generation"]["algorithm"], "r07_s1b_uniform_extent")

    def test_no_false_fit_for_exact_baseline_frame(self):
        selection = fixture(self.root, target_delta=None)
        result = self.invoke(selection)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads((self.output / "stage-a-fit-pilot-receipt.json").read_text())
        self.assertEqual(receipt["stage_a"], "UNRESOLVED_NO_IMPROVEMENT")
        self.assertFalse(receipt["loss"]["strictly_improved"])

    def test_reject_tampered_source(self):
        selection = fixture(self.root, target_delta=0.375)
        selection["files"]["pck"]["sha256"] = "0" * 64
        result = self.invoke(selection)
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_SOURCE_DIGEST", result.stderr)
        self.assertFalse(self.output.exists())

    def test_reject_wrong_source_identity(self):
        selection = fixture(self.root, target_delta=0.375)
        selection["expected_source"]["local_index"] = 1
        result = self.invoke(selection)
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_SOURCE_IDENTITY", result.stderr)
        self.assertFalse(self.output.exists())

    def test_reject_repeat_output(self):
        selection = fixture(self.root, target_delta=0.375)
        self.assertEqual(self.invoke(selection).returncode, 0)
        second = self.invoke(selection)
        self.assertEqual(second.returncode, 2)
        self.assertIn("E_S1B_OUTPUT_EXISTS", second.stderr)

    def test_reject_non_native_executor(self):
        selection = fixture(self.root, target_delta=0.375)
        self.manifest.write_text(json.dumps(selection), encoding="utf-8")
        result = subprocess.run([
            sys.executable, str(PILOT), "--manifest", str(self.manifest),
            "--studio-native", str(STUDIO), "--r03-native", str(R03),
            "--surface-native", str(self.root / "no-executable"),
            "--output", str(self.output)],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_S1B_NATIVE_UNAVAILABLE", result.stderr)
        self.assertFalse(self.output.exists())


    def injected_second_surface(self, *, returncode=None, stdout=b"",
                                stderr=b"", exception=None):
        """Real native baseline, then one simulated native fault (or C05 result)."""
        selection = fixture(self.root, target_delta=0.375)
        self.manifest.write_text(json.dumps(selection), encoding="utf-8")
        actual_run = subprocess.run
        surface_calls = [0]

        def dispatch(command, **kwargs):
            if Path(command[0]).resolve() == SURFACE.resolve():
                surface_calls[0] += 1
                if surface_calls[0] == 2:
                    if exception is not None:
                        raise exception
                    return subprocess.CompletedProcess(
                        command, returncode, stdout, stderr)
            return actual_run(command, **kwargs)

        with mock.patch.object(pilot.subprocess, "run", side_effect=dispatch):
            try:
                pilot.execute(self.manifest.resolve(), STUDIO.resolve(), R03.resolve(),
                              SURFACE.resolve(), self.output.absolute())
                outcome = None
            except pilot.s0.EvidenceError as error:
                outcome = str(error)
        self.assertGreaterEqual(surface_calls[0], 2,
                                "fault was not injected after successful baseline")
        return outcome

    def test_native_crash_after_baseline_aborts_entire_fit(self):
        error = self.injected_second_surface(
            returncode=2, stderr=b"R07-S1A: E_S1A_INVALID_MODEL_OR_INPUT\n")
        self.assertEqual(error, "E_S1B_NATIVE_REJECTED")
        self.assertFalse(self.output.exists())

    def test_native_timeout_after_baseline_aborts_entire_fit(self):
        error = self.injected_second_surface(
            exception=subprocess.TimeoutExpired([str(SURFACE)], 60))
        self.assertEqual(error, "E_S1B_NATIVE_UNAVAILABLE")
        self.assertFalse(self.output.exists())

    def test_malformed_json_after_baseline_aborts_entire_fit(self):
        error = self.injected_second_surface(returncode=0, stdout=b"{bad_json")
        self.assertEqual(error, "E_S1B_JSON")
        self.assertFalse(self.output.exists())

    def test_broken_json_protocol_after_baseline_aborts_entire_fit(self):
        error = self.injected_second_surface(
            returncode=0,
            stdout=b'{"schema":"fgmr-r07-surface-observation/1"}\n')
        self.assertEqual(error, "E_S1B_SURFACE_PROTOCOL")
        self.assertFalse(self.output.exists())

    def test_spoofed_c05_with_stdout_is_execution_failure(self):
        error = self.injected_second_surface(
            returncode=2, stdout=b"unexpected payload",
            stderr=b"R07-S1A: E_S1A_C05_LOFT_MISMATCH\n")
        self.assertEqual(error, "E_S1B_NATIVE_REJECTED")
        self.assertFalse(self.output.exists())

    def test_spoofed_c05_with_wrong_exit_is_execution_failure(self):
        error = self.injected_second_surface(
            returncode=1, stderr=b"R07-S1A: E_S1A_C05_LOFT_MISMATCH\n")
        self.assertEqual(error, "E_S1B_NATIVE_REJECTED")
        self.assertFalse(self.output.exists())

    def test_actual_native_c05_mismatch_allows_other_valid_candidates(self):
        # No mocked S1A response here: genuine FGM Evaluation rejects a huge
        # expansion at C05, while other deltas remain eligible for fitting.
        selection = fixture(self.root, target_delta=0.375)
        self.manifest.write_text(json.dumps(selection), encoding="utf-8")
        with mock.patch.object(pilot, "DELTAS", (-0.125, 3.0, 0.0, 0.375)):
            receipt = pilot.execute(self.manifest.resolve(), STUDIO.resolve(),
                                    R03.resolve(), SURFACE.resolve(),
                                    self.output.absolute())
        self.assertEqual(receipt["stage_a"],
                         "PARAMETERS_IMPROVED_IDENTITY_UNRESOLVED")
        by_delta = {entry["delta"]: entry for entry in receipt["candidates"]}
        self.assertEqual(by_delta[3.0]["gate"], "C05_REJECTED")
        self.assertEqual(by_delta[3.0]["reason"], "E_S1A_C05_LOFT_MISMATCH")
        self.assertEqual(by_delta[0.375]["gate"], "C05_PASS")
        self.assertEqual(receipt["loss"]["best"]["iou"], 1.0)

    def test_exact_c05_mismatch_is_candidate_rejection(self):
        selection = fixture(self.root, target_delta=0.375)
        self.manifest.write_text(json.dumps(selection), encoding="utf-8")
        actual_run = subprocess.run
        calls = [0]

        def reject_only_candidates(command, **kwargs):
            if Path(command[0]).resolve() == SURFACE.resolve():
                calls[0] += 1
                if calls[0] > 1:
                    return subprocess.CompletedProcess(
                        command, 2, b"", b"R07-S1A: E_S1A_C05_LOFT_MISMATCH\n")
            return actual_run(command, **kwargs)

        with mock.patch.object(pilot.subprocess, "run",
                               side_effect=reject_only_candidates):
            receipt = pilot.execute(self.manifest.resolve(), STUDIO.resolve(),
                                    R03.resolve(), SURFACE.resolve(),
                                    self.output.absolute())
        self.assertEqual(calls[0], 7)
        self.assertEqual(receipt["stage_a"], "UNRESOLVED_NO_IMPROVEMENT")
        self.assertEqual(receipt["best_delta"], 0.0)
        self.assertFalse(receipt["loss"]["strictly_improved"])
        self.assertEqual(len(receipt["candidates"]), 7)
        self.assertEqual([x["gate"] for x in receipt["candidates"][1:]],
                         ["C05_REJECTED"] * 6)
        self.assertEqual({x["reason"] for x in receipt["candidates"][1:]},
                         {"E_S1A_C05_LOFT_MISMATCH"})

    def test_crlf_c05_mismatch_is_candidate_rejection(self):
        error = self.injected_second_surface(
            returncode=2, stderr=b"R07-S1A: E_S1A_C05_LOFT_MISMATCH\r\n")
        self.assertIsNone(error)
        receipt = json.loads((self.output / "stage-a-fit-pilot-receipt.json").read_text())
        self.assertEqual(receipt["candidates"][1]["gate"], "C05_REJECTED")



if __name__ == "__main__":
    unittest.main(verbosity=2)
