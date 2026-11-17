"""Предметная проверка локального RV01-экспорта из R07 и офлайн-представления."""
import hashlib
import json
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

EXPORT, RUN_R07, FIT, VIEWER = map(Path, sys.argv[1:5])
sys.argv[1:5] = []


def execute(*args):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, timeout=90)


class RV01(unittest.TestCase):
    def test_export_and_integrity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "r07"
            self.assertEqual(execute(RUN_R07, "--fit", FIT, "--output", source).returncode, 0)
            exports = []
            for suffix in ("a", "b"):
                target = root / suffix
                result = execute(EXPORT, "--source", source, "--fit", FIT, "--output", target)
                self.assertEqual(result.returncode, 0, result.stderr)
                exports.append(target)
            for name in ("viewer-session.json", "baseline.obj", "reconstructed.obj",
                         "baseline.fgm.json", "reconstructed.fgm.json", "report.json"):
                self.assertEqual((exports[0] / name).read_bytes(), (exports[1] / name).read_bytes())
            doc = json.loads((exports[0] / "viewer-session.json").read_bytes())
            self.assertEqual(doc["schema"], "fgmr-view-session/1")
            self.assertEqual(doc["mesh_profile"], "r07_panel_diagnostic_obj/2")
            self.assertEqual(doc["coordinate_frame"]["unit"], "fgm-model")
            self.assertEqual(doc["camera"]["id"], "R07-synthetic-front")
            for name, checksum in doc["observation_sha256"].items():
                self.assertEqual(hashlib.sha256((exports[0] / name).read_bytes()).hexdigest(), checksum)
            self.assertEqual(doc["projection"], "R07-synthetic-front")
            self.assertEqual([m["role"] for m in doc["models"]], ["baseline", "reconstructed"])
            self.assertNotEqual(doc["models"][0]["sha256"], doc["models"][1]["sha256"])
            report = json.loads((exports[0] / "report.json").read_bytes())
            self.assertEqual(hashlib.sha256((exports[0] / "report.json").read_bytes()).hexdigest(),
                             doc["diagnostics_sha256"])
            self.assertEqual(doc["models"][0]["parameters"], report["starts"][0]["initial"])
            self.assertEqual(doc["models"][1]["parameters"], report["fit"])
            for m in doc["models"]:
                package = (exports[0] / m["fgm"]).read_bytes()
                self.assertEqual(hashlib.sha256(package).hexdigest(), m["sha256"])
                self.assertEqual(hashlib.sha256((exports[0] / m["mesh"]).read_bytes()).hexdigest(),
                                 m["mesh_sha256"])
                lines = (exports[0] / m["mesh"]).read_text().splitlines()
                self.assertEqual(sum(line.startswith("f ") for line in lines), 16)
                self.assertEqual(sum(line.startswith("v ") for line in lines), 64)
                self.assertEqual(sum(line.startswith("o ") for line in lines), 1)
                vertices = [tuple(float(v) for v in line.split()[1:])
                            for line in lines if line.startswith("v ")]
                faces = [tuple(int(v) - 1 for v in line.split()[1:])
                         for line in lines if line.startswith("f ")]
                def normal(face):
                    p, q, r = [vertices[k] for k in face[:3]]
                    a = [q[i] - p[i] for i in range(3)]
                    b = [r[i] - p[i] for i in range(3)]
                    return (a[1]*b[2]-a[2]*b[1],
                            a[2]*b[0]-a[0]*b[2],
                            a[0]*b[1]-a[1]*b[0])
                for i, face in enumerate(faces[:8]):
                    self.assertGreater(normal(face)[2] * (1 if i % 2 == 0 else -1), 0)
                for i, sign in enumerate((-1, 1, 1, -1)):
                    self.assertGreater(normal(faces[8 + i])[0] * sign, 0)
                for i, sign in enumerate((-1, 1, 1, -1)):
                    self.assertGreater(normal(faces[12 + i])[1] * sign, 0)
            self.assertEqual((exports[0] / "reconstructed.fgm.json").read_bytes(),
                             (source / "panel.fgm.json").read_bytes())
            self.assertNotEqual(execute(EXPORT, "--source", source, "--fit", FIT,
                                        "--output", exports[0]).returncode, 0)
            self.assertEqual((exports[0] / "reconstructed.fgm.json").read_bytes(),
                             (source / "panel.fgm.json").read_bytes())

    def test_reject_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            self.assertEqual(execute(RUN_R07, "--fit", FIT, "--output", source).returncode, 0)
            doc = json.loads((source / "report.json").read_bytes())
            doc["fit"] = [-4, 5, 7]
            (source / "report.json").write_text(json.dumps(doc))
            attempt = execute(EXPORT, "--source", source, "--fit", FIT, "--output", root / "bad")
            self.assertNotEqual(attempt.returncode, 0)
            self.assertIn(b"E_RV01_MISMATCH", attempt.stderr)
            self.assertFalse((root / "bad").exists())

    def test_viewer_offline_contract(self):
        html = VIEWER.read_text(encoding="utf-8")
        self.assertIn('id="viewport"', html)
        self.assertIn('type="file"', html)
        self.assertIn('getContext("webgl2"', html)
        self.assertIn("R05-UFO-dimetric", html)
        self.assertIn("R07-synthetic-front", html)
        self.assertIn("viewer-session.json", html)
        self.assertIn("m.mesh_sha256", html)
        self.assertIn("verifyR06Pack", html)
        self.assertIn("verifyR07Pack", html)
        self.assertIn("r07FrontMask", html)
        self.assertIn("pgmMasks", html)
        self.assertIn("E_RV01_R07_FRONT_SILHOUETTE", html)
        self.assertIn("E_RV01_R07_FRONT_METRICS", html)
        self.assertIn("spec.diagnostics_sha256", html)
        self.assertIn("loft.json", html)
        self.assertIn("baseline", html)
        self.assertIn("reconstructed", html)
        self.assertNotIn("fetch(", html)
        self.assertNotIn("XMLHttpRequest", html)
        self.assertNotIn("<script src=", html)
        self.assertNotIn("https://", html)
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node.js нужен для проверки синтаксиса браузерного скрипта")
        script = html.split("<script>", 1)[1].split("</script>", 1)[0]
        syntax = subprocess.run([node, "--check"], input=script.encode("utf-8"),
                                capture_output=True, timeout=15, check=False)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)


if __name__ == "__main__":
    unittest.main()
