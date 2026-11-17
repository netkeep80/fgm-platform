"""R06-S2B2 synthetic whole-object FGM + C05, no original game resources."""

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT, SAMPLER = map(Path, sys.argv[1:3])
del sys.argv[1:3]

SCHEMA = "fgm-regenerator/verified-membership-input-v1"
PARTS = ("floor", "west_wall", "north_wall", "object")


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def make_loft(xyz, index, local_occupied, *, record=1, dataset="SYNTH"):
    rows = [[[0] * 16 for _ in range(24)] for _ in range(4)]
    for x, y, z in local_occupied:
        rows[3][z][y] |= 1 << (15 - x)
    sources = []
    for part in PARTS:
        s = {"part": part, "source_index": 0, "present": False}
        if part == "object":
            s = {"part": part, "source_index": record + 1, "present": True,
                 "dataset_label": dataset, "local_index": record,
                 "loft_ids": [0] * 12}
        sources.append(s)
    return {"schema": "fgm-regenerator/loft-terrain-v1",
            "voxel_dimensions_xyz": [16, 16, 24], "terrain_only": True,
            "tile": {"xyz": list(xyz), "record_index": index},
            "sources": sources, "part_rows": rows}


def make_binding(xyz, index):
    return {"xyz": list(xyz), "local_xyz": list(xyz), "part": "object",
            "dataset": "SYNTH", "record": 1, "map_record": index}


def face_count(whole):
    adjacent = [(1, 0, 0), (-1, 0, 0), (0, 1, 0),
                (0, -1, 0), (0, 0, 1), (0, 0, -1)]
    return sum((x+dx, y+dy, z+dz) not in whole for (x, y, z) in whole
               for dx, dy, dz in adjacent)


class WholeObject(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def sources(self, world, *, anchor=(0, 0, 0)):
        tiles = sorted({(x // 16, y // 16, z // 24) for x, y, z in world})
        assert 2 <= len(tiles) <= 8
        bindings = []
        loft_files = []
        for i, tile in enumerate(tiles):
            occupied = {(x % 16, y % 16, z % 24) for x, y, z in world
                        if (x//16, y//16, z//24) == tile}
            xyz = tuple(x + a for x, a in zip(tile, anchor, strict=True))
            path = self.root / f"loft-{i}.json"
            path.write_bytes(canonical(make_loft(xyz, i, occupied)))
            loft_files.append(path)
            binding = make_binding(xyz, i)
            binding["local_xyz"] = list(tile)
            bindings.append(binding)
        receipt = {"schema": SCHEMA, "status": "verified_explicit_membership",
                   "instance": "synthetic-structure", "prototype": "synthetic-type",
                   "anchor_xyz": list(anchor), "cell_bindings": bindings,
                   "provenance": {"witness": "synthetic-only"}}
        receipt_path = self.root / "verified.json"
        receipt_data = canonical(receipt)
        receipt_path.write_bytes(receipt_data)
        return receipt_path, digest(receipt_data), loft_files

    def command(self, source, sha, lofts, output, *, material="stone", sampler_sha=None):
        command = [sys.executable, str(SCRIPT), "--verified", str(source),
                   "--verified-sha256", sha, "--sampler", str(SAMPLER),
                   "--sampler-sha256", (digest(SAMPLER.read_bytes()) if sampler_sha is None else sampler_sha),
                   "--material", material, "--output", str(output)]
        for file in lofts:
            command.extend(["--loft", str(file)])
        return command

    def execute(self, world, *, anchor=(0, 0, 0)):
        receipt, sha, lofts = self.sources(world, anchor=anchor)
        output = self.root / "whole"
        cmd = self.command(receipt, sha, lofts, output)
        proc = subprocess.run(cmd, capture_output=True, check=False, timeout=90)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return output, cmd

    def assert_mesh(self, output, world):
        mesh = (output / "preview.obj").read_text().splitlines()
        self.assertEqual(sum(line.startswith("f ") for line in mesh),
                         face_count(world))
        report = json.loads((output / "report.json").read_bytes())
        self.assertEqual(report["occupied"], len(world))
        self.assertEqual(report["checked_centers"], 6144 * len(report["cell_bindings"]))
        self.assertEqual(report["surface"], "global_voxel_boundary_no_internal_faces")
        pkg = json.loads((output / "model.fgm.json").read_bytes())
        self.assertEqual(len(pkg["model"]["contributions"]), 1)
        self.assertEqual(pkg["model"]["contributions"][0]["id"], "whole_object")
        self.assertEqual(pkg["generation"]["algorithm"], "r06_multicell_loft_boxes")
        return report

    def test_two_adjacent_cells_one_volume_no_internal_seam(self):
        world = {(15, 6, 4), (16, 6, 4)}
        output, cmd = self.execute(world)
        self.assert_mesh(output, world)
        self.assertEqual(face_count(world), 10)
        slices = json.loads((output / "slices.json").read_bytes())["cells"]
        self.assertEqual([s["occupied"] for s in slices], [1, 1])
        self.assertEqual(slices[0]["rows"][4][6], 1)
        self.assertEqual(slices[1]["rows"][4][6], 1 << 15)
        first = {p.name: p.read_bytes() for p in output.iterdir()}
        output.rename(self.root / "saved")
        again = subprocess.run(cmd, capture_output=True, check=False, timeout=90)
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(first, {p.name: p.read_bytes() for p in output.iterdir()})

    def test_two_by_two_ring_has_real_hole_and_no_merged_seams(self):
        world = {(x, y, 3) for x in (14, 15, 16) for y in (14, 15, 16)
                 if (x, y) != (15, 15)}
        output, _ = self.execute(world)
        self.assertEqual(len(world), 8)
        self.assert_mesh(output, world)
        slices = json.loads((output / "slices.json").read_bytes())["cells"]
        self.assertEqual(len(slices), 4)
        # Hole at the global 15,15 point is empty in the lower-left tile.
        self.assertEqual(slices[0]["rows"][3][15] & 1, 0)

    def test_multifloor_z_boundary_and_nonzero_anchor(self):
        world = {(2, 2, 23), (2, 2, 24)}
        output, _ = self.execute(world, anchor=(3, 5, 7))
        self.assertEqual(face_count(world), 10)
        self.assert_mesh(output, world)
        slices = json.loads((output / "slices.json").read_bytes())["cells"]
        self.assertEqual([s["xyz"] for s in slices], [[3, 5, 7], [3, 5, 8]])
        self.assertEqual([s["local_xyz"] for s in slices], [[0, 0, 0], [0, 0, 1]])

    def test_material_participates_in_seed_and_sampler_sha_is_pinned(self):
        world = {(15, 6, 4), (16, 6, 4)}
        receipt, sha, lofts = self.sources(world)
        bad_out = self.root / "bad-sampler"
        bad = subprocess.run(self.command(receipt, sha, lofts, bad_out,
                                          sampler_sha="0" * 64),
                             capture_output=True, check=False, timeout=90)
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse(bad_out.exists())
        first, second = self.root / "stone", self.root / "brick"
        for material, target in (("stone", first), ("brick", second)):
            result = subprocess.run(self.command(receipt, sha, lofts, target,
                                                 material=material),
                                    capture_output=True, check=False, timeout=90)
            self.assertEqual(result.returncode, 0, result.stderr)
        stone = json.loads((first / "model.fgm.json").read_bytes())
        brick = json.loads((second / "model.fgm.json").read_bytes())
        self.assertNotEqual(stone["model"]["seed"], brick["model"]["seed"])
        self.assertEqual(stone["generation"]["resources"]["material_sha256"],
                         digest(canonical("stone")))
        self.assertEqual(brick["generation"]["resources"]["material_sha256"],
                         digest(canonical("brick")))

    def test_extra_independent_neighbor_not_implicitly_grouped(self):
        world = {(15, 6, 4), (16, 6, 4)}
        receipt, sha, lofts = self.sources(world)
        extra = self.root / "unrelated.json"
        extra.write_bytes(canonical(make_loft((2, 0, 0), 2, {(0, 6, 4)})))
        cmd = self.command(receipt, sha, [*lofts, extra], self.root / "no-model")
        result = subprocess.run(cmd, capture_output=True, timeout=90)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "no-model").exists())

    def test_wrong_receipt_hash_and_source_binding_rejected(self):
        world = {(15, 6, 4), (16, 6, 4)}
        receipt, sha, lofts = self.sources(world)
        out = self.root / "reject"
        bad = subprocess.run(self.command(receipt, "0"*64, lofts, out),
                             capture_output=True, timeout=90)
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse(out.exists())
        wrong = json.loads(lofts[0].read_bytes())
        wrong["sources"][3]["local_index"] = 42
        lofts[0].write_bytes(canonical(wrong))
        bad = subprocess.run(self.command(receipt, sha, lofts, out),
                             capture_output=True, timeout=90)
        self.assertNotEqual(bad.returncode, 0)
        self.assertFalse(out.exists())

    def test_native_material_length_compatibility_49_to_80(self):
        # Accepted B2 must continue to construct and C05-sample long identifiers.
        world = {(15, 6, 4), (16, 6, 4)}
        receipt, sha, lofts = self.sources(world)
        for length in (49, 60, 80):
            with self.subTest(length=length):
                material = "m" + "a" * (length - 1)
                output = self.root / f"material-{length}"
                result = subprocess.run(
                    self.command(receipt, sha, lofts, output, material=material),
                    capture_output=True, check=False, timeout=90)
                self.assertEqual(result.returncode, 0, result.stderr)
                package = json.loads((output / "model.fgm.json").read_bytes())
                self.assertEqual(package["model"]["contributions"][0]["material"], material)
                report = json.loads((output / "report.json").read_bytes())
                self.assertEqual(report["checked_centers"], 2 * 6144)
        too_long = "m" + "a" * 80
        rejected = self.root / "material-81"
        result = subprocess.run(
            self.command(receipt, sha, lofts, rejected, material=too_long),
            capture_output=True, check=False, timeout=90)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(rejected.exists())

    def test_existing_output_preserved(self):
        world = {(15, 6, 4), (16, 6, 4)}
        receipt, sha, lofts = self.sources(world)
        out = self.root / "whole"
        out.mkdir()
        (out / "preserve").write_bytes(b"untouched")
        result = subprocess.run(self.command(receipt, sha, lofts, out),
                                capture_output=True, timeout=90)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((out / "preserve").read_bytes(), b"untouched")


if __name__ == "__main__":
    unittest.main()
