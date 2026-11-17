"""Проверка подбора и жёстких ограничений на независимых ожиданиях."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT, FIT = map(Path, sys.argv[1:3])
sys.argv[1:3] = []


def experiment(path):
    return subprocess.run([sys.executable, SCRIPT, "--fit", FIT, "--output", path],
                          capture_output=True, timeout=90, check=False)


class PanelFit(unittest.TestCase):
    def test_search_and_views(self):
        with tempfile.TemporaryDirectory() as tmp:
            artifact = os.getenv("FGMR_R07_ARTIFACT")
            path = Path(artifact) if artifact else Path(tmp)/"result"
            result = experiment(path)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((path/"report.json").read_bytes())
            self.assertEqual(report["truth"], [-4, 5, 4])
            self.assertEqual(report["fit"], report["truth"])
            self.assertTrue(report["c05_verified"])
            self.assertEqual(len(report["starts"]), 3)
            for trace in report["starts"]:
                self.assertEqual(trace["final"], report["truth"])
                self.assertGreater(trace["before"]["mask_xor"], 0)
                self.assertGreater(trace["before"]["contour_l1"], 0)
                self.assertEqual(trace["after"], {"mask_xor": 0, "contour_l1": 0})
                self.assertLessEqual(trace["attempts"], report["attempt_budget"])
                self.assertEqual(trace["violations_final"], 0)
                self.assertGreater(trace["renders"], 0)
            self.assertGreater(sum(t["rejected_protected"] for t in report["starts"]), 0)
            for trace in report["starts"]:
                self.assertEqual(trace["rejected"], trace["rejected_range"] + trace["rejected_protected"])
            front = (path/"front.pgm").read_bytes()
            self.assertEqual(front[:13], b"P5\n96 32\n255\n")
            expected = []
            for row in range(32):
                v = (15.5-row)/8
                expected.append(bytes(255 if abs(u := (col-15.5)/8) < 1.5 and abs(v) < 1.5
                                      and not (-0.5 < u < 0.625 and -0.625 < v < 0.5)
                                      else 0 for col in range(32)))
            for row, line in enumerate(expected):
                start = 13 + row*96
                self.assertEqual(front[start:start+32], line)
                self.assertEqual(front[start+64:start+96], line)

            self.assertEqual(set(report["held_out"]), {"rear", "left_yaw", "right_yaw", "upper_pitch"})
            for view, row in report["held_out"].items():
                self.assertEqual(row["after"]["mask_xor"], 0)
                self.assertEqual(row["after"]["contour_l1"], 0)
                self.assertEqual(len((path/f"{view}.pgm").read_bytes()), 13 + 96*32)
            self.assertGreater(sum(row["before"]["mask_xor"] for row in report["held_out"].values()), 0)
            model = (path/"panel.fgm.json").read_bytes()
            self.assertEqual(model, json.dumps(json.loads(model), sort_keys=True,
                                             separators=(",", ":")).encode())
            for fit, document, error in [([-7, 5, 4], json.loads(model), b"E_R07_PROTECTED"),
                                          (report["fit"], json.loads(model), b"E_R07_C05")]:
                if error == b"E_R07_C05":
                    document["model"]["contributions"][0]["material"] = "wrong"
                rejected = subprocess.run([FIT, "--verify"], capture_output=True, check=False,
                                          input=json.dumps({"fit": fit,
                                                            "package": json.dumps(document)}).encode())
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn(error, rejected.stderr)
            for fit in ([-4.5, 5, 4], [-4, 5, 4, 0], [4294967292, 5, 4]):
                rejected = subprocess.run([FIT, "--verify"], capture_output=True, check=False,
                                          input=json.dumps({"fit": fit,
                                                            "package": model.decode("ascii")}).encode())
                self.assertNotEqual(rejected.returncode, 0)
                self.assertIn(b"E_R07_PARAMETERS", rejected.stderr)
            replay = Path(tmp)/"replay"
            result = experiment(replay)
            self.assertEqual(result.returncode, 0, result.stderr)
            other = json.loads((replay/"report.json").read_bytes())
            for trace in (*report["starts"], *other["starts"]):
                self.assertGreaterEqual(trace.pop("duration_us"), 0)
            self.assertEqual(report, other)
            for file in replay.glob("*.pgm"):
                self.assertEqual(file.read_bytes(), (path/file.name).read_bytes())
            self.assertEqual(model, (replay/"panel.fgm.json").read_bytes())

    def test_centered_opening_serializes_integer_zero(self):
        sys.path.insert(0, str(SCRIPT.parent))
        try:
            from run_r07 import fgm_pack
        finally:
            sys.path.pop(0)
        raw = fgm_pack([-4, 4, 5], "0")
        self.assertIn(b'"id":"hole_center","op":"constant","type":"vec3","value":[0,0,0]', raw)

    def test_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            marker = path/"keep"
            marker.write_text("untouched")
            self.assertNotEqual(experiment(path).returncode, 0)
            self.assertEqual(list(path.iterdir()), [marker])
            self.assertEqual(marker.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()
