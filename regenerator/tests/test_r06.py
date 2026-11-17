"""Сквозные проверки из самостоятельно созданных MAP/MCD/LOFT/PCK/TAB."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT, SAMPLE, LOFT, SPRITE = map(Path, sys.argv[1:5])
sys.argv[1:5] = []
MATERIALS = {"slab": "concrete", "arch": "brick", "boulder": "stone"}


def run(*args):
    return subprocess.run(args, capture_output=True, check=False)


def opaque(z, y, x, kind):
    if kind == "empty":
        return False
    if kind == "slab":
        return 2 <= x < 14 and 3 <= y < 13 and z < 2
    if kind == "arch":
        return 3 <= x < 13 and 6 <= y < 10 and z < 14 and (x < 5 or x >= 11 or z >= 10)
    layer = z // 2
    return ((x - 8)**2 + 2*(y - 7)**2 + 5*(layer - 3)**2 <= 28
            and not (x >= 10 and y < 7 and layer >= 3))


def input_files(root, kind):
    occupied = {(x, y, z) for z in range(24) for y in range(16)
                for x in range(16) if opaque(z, y, x, kind)}
    # Независимая формула и наблюдение: добавляем один специально искажённый пиксель.
    expected = {(16 + x - y, int(20 + (x + y) / 2 - z)) for x, y, z in occupied}
    assert all(0 <= x < 32 and 0 <= y < 40 for x, y in expected)
    record = bytearray(62)
    record[42] = 12
    source = record.copy()
    source[8:20] = bytes(range(12))
    profiles = b"".join(struct.pack("<H", sum(1 << (15-x) for x in range(16)
                                             if (x, y, z) in occupied))
                        for z in range(0, 24, 2) for y in range(16))
    pck = bytes([0]) + bytes(7 if (x, y) in expected or (x, y) == (0, 0) else 0
                             for y in range(40) for x in range(32)) + bytes([255])
    inputs = {"map": b"\1\1\1\0\0\0\1", "mcd": record + source, "loft": profiles,
              "pck": pck, "tab": bytes(2), "palette": bytes(768)}
    for name, data in inputs.items():
        (root / name).write_bytes(data)
    loft = run(LOFT, "--map", root/"map", "--mcd", f"SYNTH={root/'mcd'}",
               "--loft", root/"loft", "--tile", "0,0,0")
    sprite = run(SPRITE, "--pck", root/"pck", "--tab", root/"tab", "--tab-bits", "16",
                 "--palette", root/"palette", "--palette-index", "0", "--mcd", root/"mcd", "--record", "1")
    for process, name in [(loft, "loft.json"), (sprite, "sprite.json")]:
        if process.returncode:
            raise RuntimeError(process.stderr)
        (root / name).write_bytes(process.stdout)
    return occupied, expected


def generate(root, kind, target, p_level="0"):
    return run(sys.executable, SCRIPT, "--sampler", SAMPLE, "--loft", root/"loft.json",
               "--sprite", root/"sprite.json", "--part", "object", "--material", MATERIALS[kind],
               "--slot", "0", "--p-level", p_level, "--output", target)


class Reconstruction(unittest.TestCase):
    def test_pipeline(self):
        artifact = os.getenv("FGMR_R06_ARTIFACT")
        if artifact:
            Path(artifact).mkdir(parents=True, exist_ok=True)
        for kind in MATERIALS:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                occupied, projected = input_files(root, kind)
                first, second = root/"first", root/"second"
                for target in (first, second):
                    result = generate(root, kind, target)
                    self.assertEqual(result.returncode, 0, result.stderr)
                for name in ("model.fgm.json", "preview.obj", "report.json", "viewer-proof.json"):
                    self.assertEqual((first/name).read_bytes(), (second/name).read_bytes())
                package = (first/"model.fgm.json").read_bytes()
                self.assertEqual(package, json.dumps(json.loads(package), sort_keys=True,
                                                      separators=(",", ":")).encode())
                model = json.loads(package)
                self.assertEqual(model["model"]["contributions"][0]["material"], MATERIALS[kind])
                seed_input = ["fgm:seed:1", {"generation": model["generation"], "purpose": "model"}]
                seed = hashlib.sha256(json.dumps(seed_input, sort_keys=True, separators=(",", ":")).encode())
                self.assertEqual(model["model"]["seed"], seed.hexdigest())
                proof = json.loads((first/"viewer-proof.json").read_bytes())
                self.assertEqual(proof["schema"], "fgmr-r06-view-proof/1")
                self.assertEqual(proof["mesh_sha256"], hashlib.sha256((first/"preview.obj").read_bytes()).hexdigest())
                self.assertEqual(proof["model_sha256"], hashlib.sha256(package).hexdigest())
                self.assertEqual(proof["report_sha256"], hashlib.sha256((first/"report.json").read_bytes()).hexdigest())
                report = json.loads((first/"report.json").read_bytes())
                self.assertEqual(report["occupied"], len(occupied))
                self.assertEqual(report["silhouette"], {"common":len(projected),
                                                         "predicted_only":0, "observed_only":1})
                self.assertIsNone(report["hidden_surface_confidence"])
                self.assertEqual(report["source"]["local_index"], 1)
                obj = (first/"preview.obj").read_text().splitlines()
                neighbors = [(1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)]
                face_count = sum((x+dx,y+dy,z+dz) not in occupied for x,y,z in occupied
                                 for dx,dy,dz in neighbors)
                self.assertEqual(sum(line.startswith("f ") for line in obj), face_count)
                if artifact:
                    shutil.copytree(first, Path(artifact)/kind, dirs_exist_ok=True)

    def test_visual_evidence_keeps_semantic_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_files(root, "slab")
            first, second = root/"first", root/"second"
            result = generate(root, "slab", first)
            self.assertEqual(result.returncode, 0, result.stderr)
            path = root/"sprite.json"
            sprite = json.loads(path.read_bytes())
            sprite["frames"][0]["indices_hex"] = "00" * 1280
            sprite["frames"][0]["alpha_hex"] = "00" * 1280
            path.write_text(json.dumps(sprite))
            result = generate(root, "slab", second, p_level="7")
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in ("model.fgm.json", "preview.obj"):
                self.assertEqual((first/name).read_bytes(), (second/name).read_bytes())
            report = json.loads((second/"report.json").read_bytes())
            self.assertEqual(report["silhouette"],
                             {"common": 0, "predicted_only": 141, "observed_only": 0})
            self.assertEqual(report["p_level"], 7)

    def test_present_part_with_empty_collision_mask(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_files(root, "empty")
            target = root/"result"
            result = generate(root, "slab", target)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((target/"report.json").read_bytes())
            self.assertEqual((report["occupied"], report["boxes"]), (0, 0))
            self.assertEqual(report["silhouette"],
                             {"common": 0, "predicted_only": 0, "observed_only": 1})
            self.assertEqual((target/"preview.obj").read_text(), "o terrain\n")
            self.assertEqual(json.loads((target/"viewer-proof.json").read_bytes())["occupied"], 0)

    def test_wrong_source_and_existing_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_files(root, "slab")
            path = root/"sprite.json"
            sprite = json.loads(path.read_bytes())
            sprite["record"] = 0
            path.write_text(json.dumps(sprite))
            target = root/"result"
            result = generate(root, "slab", target)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"E_R06_SOURCE", result.stderr)
            self.assertFalse(target.exists())
            target.mkdir()
            (target/"untouched").write_text("keep")
            sprite["record"] = 1
            path.write_text(json.dumps(sprite))
            result = generate(root, "slab", target)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((target/"untouched").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
