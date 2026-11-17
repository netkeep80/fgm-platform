"""Синтетические сквозные и негативные тесты локальной подготовки R07.

Используется настоящий нативный исполнитель R06/R04/R05/C05, без игровых байтов.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(sys.argv.pop(1)).resolve()
NATIVE = Path(sys.argv.pop(1)).resolve()
CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b"

module = importlib.util.spec_from_file_location("r07_local_observation", SCRIPT)
preflight = importlib.util.module_from_spec(module)
module.loader.exec_module(preflight)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build_fixture(root):
    # Те же полностью синтетические структуры, что в принятом test_studio_cell.mjs.
    source = {
        "map": bytes([1, 1, 1, 0, 1, 2, 2]),
        "loft": bytearray(64),
        "blanks": bytearray(124),
        "terrain": bytearray(62),
        "pck": bytes([0, 42, 255]),
        "tab": bytes(2),
        "palette": bytes(768),
    }
    for y in range(3, 6):
        struct.pack_into("<H", source["loft"], y * 2, 0x3800)
    source["blanks"][42] = 1
    source["blanks"][62 + 42] = 1
    source["terrain"][42] = 1
    source["terrain"][8:20] = bytes([0, *([1] * 11)])
    selection = {
        "schema": "fgmr-r07-local-selection/1",
        "object_key": "synthetic-possible-single-part",
        "membership": {"status": "hypothesis", "evidence_note": "Только одна синтетическая клетка."},
        "expected_source": {"dataset_label": "TERRAIN", "local_index": 0, "part": "object"},
        "files": {},
        "spec": {
            "algorithm": "r06-cell/1", "coreRevision": CORE, "budget": 6144,
            "sourceBindings": {
                "map": "map", "loft": "loft",
                "datasets": [{"id": "BLANKS", "file": "blanks"},
                             {"id": "TERRAIN", "file": "terrain"}],
                "sprite": {"dataset": "TERRAIN", "pck": "pck", "tab": "tab", "palette": "palette"}
            },
            "parameters": {"tile": [0, 0, 0], "part": "object", "material": "stone",
                           "frameSlot": 0, "tabBits": 16, "paletteIndex": 0},
        }
    }
    for name, payload in source.items():
        payload = bytes(payload)
        (root / name).write_bytes(payload)
        selection["files"][name] = {"path": name, "sha256": sha(payload)}
    return selection


class LocalR07Observation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fgmr-r07-local-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.selection = build_fixture(self.root)
        self.manifest = self.root / "selection.json"
        self.output = self.root / "private-result"

    def run_candidate(self, modified=None):
        document = modified if modified is not None else self.selection
        self.manifest.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        return subprocess.run([sys.executable, str(SCRIPT), "--native", str(NATIVE),
                               "--manifest", str(self.manifest), "--output", str(self.output)],
                              capture_output=True, text=True, timeout=120)

    def test_actual_native_synthetic_provenance_and_baseline(self):
        result = self.run_candidate()
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = json.loads(result.stdout)
        self.assertEqual(summary["stage_a"], "BASELINE_ONLY_NOT_FITTED")
        self.assertEqual(summary["object_identity"], "NOT_INDEPENDENTLY_ATTESTED")
        self.assertTrue(self.output.is_dir())
        receipt = json.loads((self.output / "stage-a-baseline-receipt.json").read_bytes())
        self.assertEqual(receipt["schema"], "fgmr-r07-source-baseline/1")
        self.assertEqual(receipt["c05"]["checked"], 6144)
        self.assertGreater(receipt["c05"]["occupied"], 0)
        self.assertEqual(receipt["source"]["dataset_label"], "TERRAIN")
        self.assertEqual(receipt["source"]["local_index"], 0)
        self.assertEqual(receipt["membership_status"], "hypothesis")
        self.assertEqual(receipt["r05_coordinate_frame"], "r05-ufo-dimetric/1")
        self.assertGreater(receipt["metrics"]["observed_only"] + receipt["metrics"]["common"], 0)
        self.assertIsInstance(receipt["metrics"]["silhouette_iou"], float)
        self.assertIsInstance(receipt["metrics"]["contour_l1"], int)
        self.assertEqual(set(receipt["source_digests"]), set(self.selection["files"]))
        self.assertNotIn(str(self.root), json.dumps(receipt))
        self.assertNotIn("indices_hex", json.dumps(receipt))
        for name, key in [("model.fgm.json", "model"), ("preview.obj", "preview"),
                          ("report.json", "report"), ("visual.json", "visual"),
                          ("proof.json", "proof")]:
            content = (self.output / name).read_bytes()
            self.assertEqual(receipt["artifacts_sha256"][key], sha(content))
        model = json.loads((self.output / "model.fgm.json").read_bytes())
        self.assertEqual(model["format"], "fgm-package/1")
        self.assertEqual(model["interpreter"], "fgm-0/1")
        self.assertEqual(len(model["model"]["contributions"]), 1)

    def test_repeated_local_run_is_reproducible(self):
        self.assertEqual(self.run_candidate().returncode, 0)
        before = {p.name: sha(p.read_bytes()) for p in self.output.iterdir()}
        self.output = self.root / "other-private-result"
        self.assertEqual(self.run_candidate().returncode, 0)
        after = {p.name: sha(p.read_bytes()) for p in self.output.iterdir()}
        self.assertEqual(before, after)

    def test_tampered_digest_and_source_identity_fail_closed(self):
        self.selection["files"]["pck"]["sha256"] = sha(b"not original")
        result = self.run_candidate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_SOURCE_DIGEST", result.stderr)
        self.assertFalse(self.output.exists())
        self.selection["files"]["pck"]["sha256"] = sha((self.root / "pck").read_bytes())
        self.selection["expected_source"]["local_index"] = 1
        result = self.run_candidate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_SOURCE_IDENTITY", result.stderr)
        self.assertFalse(self.output.exists())

    def test_bad_r04_and_wrong_binding_fail_closed(self):
        (self.root / "pck").write_bytes(bytes([0, 42, 0]))
        self.selection["files"]["pck"]["sha256"] = sha((self.root / "pck").read_bytes())
        result = self.run_candidate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_NATIVE_REJECTED", result.stderr)
        self.assertFalse(self.output.exists())
        self.selection["spec"]["sourceBindings"]["sprite"]["dataset"] = "BLANKS"
        result = self.run_candidate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_PARAMETERS", result.stderr)
        self.assertFalse(self.output.exists())

    def test_rejects_symlink_existing_output_and_missing_files(self):
        target = self.root / "pck"
        link = self.root / "linked"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("Платформа запрещает тестовые symlink")
        self.selection["files"]["pck"]["path"] = "linked"
        result = self.run_candidate()
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_R07_LOCAL_SOURCE_SYMLINK", result.stderr)
        self.assertFalse(self.output.exists())
        self.selection["files"]["pck"]["path"] = "pck"
        self.output.mkdir()
        self.assertIn("E_R07_LOCAL_OUTPUT_EXISTS", self.run_candidate().stderr)
        self.output.rmdir()
        target.unlink()
        self.assertIn("E_R07_LOCAL_INPUT_IO", self.run_candidate().stderr)

    def test_no_false_object_attestation_even_if_claimed_explicit(self):
        self.selection["membership"] = {"status": "explicit", "evidence_note": "Внешняя декларация"}
        self.assertEqual(self.run_candidate().returncode, 0)
        receipt = json.loads((self.output / "stage-a-baseline-receipt.json").read_bytes())
        self.assertEqual(receipt["membership_status"], "explicit")
        self.assertEqual(receipt["object_identity"], "NOT_INDEPENDENTLY_ATTESTED")
        self.assertEqual(receipt["stage_a"], "BASELINE_ONLY_NOT_FITTED")


if __name__ == "__main__":
    unittest.main()