"""R07-S1B1B0: independent analytic two-cell C05 and continuous R05 surfaces.

Synthetic FGM only. The analytic ray-box oracle does not invoke FGM,
the C++ rasterizer, R03, or original UFO source bytes.
"""
import copy
import hashlib
import json
import subprocess
import sys
import unittest

BINARY = sys.argv.pop(1)
REQUEST_SCHEMA = "fgmr-r07-whole-surface-request/1"


def enc(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def whole(radius, *, moved=False, empty_second=False):
    nodes = []
    roots = []
    for i in range(2):
        center = [8 + i * 16 + (1 if moved and i == 1 else 0), 8, 12]
        nodes.extend([
            {"id": f"extent_{i}", "op": "constant", "type": "vec3",
             "value": [radius, radius, radius]},
            {"id": f"box_{i}", "op": "box", "halfSize": f"extent_{i}"},
            {"id": f"offset_{i}", "op": "constant", "type": "vec3", "value": center},
            {"id": f"move_{i}", "op": "translate",
             "field": f"box_{i}", "offset": f"offset_{i}"}])
        roots.append(f"move_{i}")
    if empty_second:
        nodes.append({"id": "empty_1", "op": "subtract",
                      "left": roots[1], "right": roots[1]})
        roots[1] = "empty_1"
    nodes.append({"id": "union", "op": "union",
                  "left": roots[0], "right": roots[1]})
    generation = {"algorithm": "r07_whole_synthetic_boxes", "version": "0.1.0",
                  "parameters": {"radius": radius, "moved": int(moved),
                                 "empty_second": int(empty_second)},
                  "resources": {}}
    seed = digest(enc(["fgm:seed:1", {"generation": generation, "purpose": "model"}]))
    return enc({"format": "fgm-package/1", "interpreter": "fgm-0/1",
                "generation": generation,
                "model": {"seed": seed, "volumes": {},
                          "contributions": [
                              {"id": "whole_object", "material": "stone",
                               "priority": 0, "field": {
                                   "op": "program", "parameters": {},
                                   "program": {"version": "fgm-0",
                                               "nodes": nodes, "root": "union"}}}]}})


def center_rows(radius):
    """6144 analytic voxel-center samples, no FGM interpreter involved."""
    out = [0] * 384
    for z in range(24):
        for y in range(16):
            for x in range(16):
                if all(abs(coord - origin) < radius
                       for coord, origin in ((x + 0.5, 8),
                                             (y + 0.5, 8),
                                             (z + 0.5, 12))):
                    out[z * 16 + y] |= 1 << (15-x)
    return out


def analytic_rays(radius, tile=0, *, right_half=False, p_level=0):
    """Intersect six slab planes with affine R05 pixel-center ray exactly."""
    points = set()
    for py in range(40):
        for px in range(16 if right_half else 0, 32):
            d = px + 0.5 - 16
            # R05 spriteAnchor moves the pixel *window* by p_level; it does
            # NOT translate the sampled FGM geometry or the tile anchor.
            h = py + 0.5 - p_level - 20
            lo = max(0, d, d / 2 + h, 8-radius, 8-radius+d,
                     12-radius+d/2+h)
            hi = min(16, 16+d, 24+d/2+h, 8+radius, 8+radius+d,
                     12+radius+d/2+h)
            if hi > lo + 1e-9:
                points.add((px + 16*tile, py + 8*tile - p_level))
    return points


def request(radius=3.51, *, right_half=False, p_level=0):
    model = whole(radius)
    return {"schema": REQUEST_SCHEMA, "package": model,
            "package_sha256": digest(model), "material": "stone",
            "cells": [{"tile": [i, 0, 0], "local_xyz": [i, 0, 0],
                       "reference_rows": center_rows(3.51),
                       "p_level": p_level,
                       "right_half": right_half} for i in range(2)]}


def run(payload):
    return subprocess.run([BINARY], input=enc(payload), text=True,
                          capture_output=True, timeout=60)


def accepted(payload):
    value = run(payload)
    if value.returncode:
        raise AssertionError(value.stderr)
    return json.loads(value.stdout)


def points(cell):
    return set(map(tuple, cell["surface_pixels_xy"]))


class WholeSurfaceB0(unittest.TestCase):
    def test_real_native_matches_independent_analytic_two_cell_oracle(self):
        small = accepted(request(3.51))
        large = accepted(request(4.49))
        self.assertNotEqual(small["model_sha256"], large["model_sha256"])
        for sidecar, radius in ((small, 3.51), (large, 4.49)):
            self.assertEqual(sidecar["schema"], "fgmr-r07-whole-surface-observation/1")
            self.assertEqual(sidecar["c05"], {"checked": 12288, "match": True,
                                               "scope": "voxel_centers_only"})
            self.assertEqual(sidecar["raster"]["algorithm"],
                             "r07-whole-cell-center-rays/1")
            for i, cell in enumerate(sidecar["cells"]):
                self.assertEqual(cell["tile"], [i, 0, 0])
                self.assertEqual(cell["local_xyz"], [i, 0, 0])
                self.assertEqual(cell["reference_rows_sha256"],
                                 digest(enc(center_rows(3.51))))
                self.assertEqual(cell["c05_checked"], 6144)
                self.assertEqual(points(cell), analytic_rays(radius, i))
                self.assertEqual(cell["surface_mask_sha256"],
                                 digest(enc(cell["surface_pixels_xy"])))
                self.assertEqual(len(points(cell)), 148 if radius == 3.51 else 244)
        self.assertEqual(
            [x["surface_mask_sha256"] for x in small["cells"]] !=
            [x["surface_mask_sha256"] for x in large["cells"]], True,
            "a constant LOFT-based projection is an invalid mutant")
        self.assertEqual(center_rows(3.51), center_rows(4.49))

    def test_native_is_deterministic_for_identical_package_and_views(self):
        payload = request(3.51)
        a, b = run(payload), run(payload)
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(a.stdout, b.stdout)

    def test_second_cell_global_offset_cannot_be_silently_ignored(self):
        payload = request()
        # Even if both world and local coordinates are translated together
        # (thus preserving a common anchor), C05 must reject the absent cell.
        payload["cells"][1]["local_xyz"] = [2, 0, 0]
        payload["cells"][1]["tile"] = [2, 0, 0]
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertEqual(value.stdout, "")
        self.assertIn("E_B0_C05_ALL_CELLS_MISMATCH", value.stderr)

    def test_wrong_reference_on_each_cell_blocks_entire_result(self):
        for idx in (0, 1):
            payload = request()
            payload["cells"][idx]["reference_rows"][0] ^= 1
            value = run(payload)
            self.assertEqual(value.returncode, 2)
            self.assertEqual(value.stdout, "", "no partial pixels permitted")
            self.assertEqual(value.stderr,
                             "R07-S1B1B0: E_B0_C05_ALL_CELLS_MISMATCH\n")

    def test_wrong_geometry_in_second_cell_rejected_globally(self):
        model = whole(3.51, empty_second=True)
        payload = request()
        payload["package"] = model
        payload["package_sha256"] = digest(model)
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertEqual(value.stdout, "")
        self.assertIn("E_B0_C05_ALL_CELLS_MISMATCH", value.stderr)

    def test_moved_geometry_cannot_pass_original_reference_center_grid(self):
        model = whole(3.51, moved=True)
        payload = request()
        payload["package"] = model
        payload["package_sha256"] = digest(model)
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertIn("E_B0_C05_ALL_CELLS_MISMATCH", value.stderr)

    def test_right_half_and_p_level_affect_only_projection(self):
        normal = accepted(request(3.51, right_half=True, p_level=5))
        for i, cell in enumerate(normal["cells"]):
            self.assertEqual(points(cell), analytic_rays(3.51, i, right_half=True,
                                                         p_level=5))
            self.assertEqual(cell["c05_checked"], 6144)
        self.assertEqual(normal["c05"]["checked"], 12288)

    def test_bad_package_sha_is_fail_closed(self):
        payload = request()
        payload["package_sha256"] = digest(b"not package")
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertEqual(value.stdout, "")
        self.assertIn("E_B0_PACKAGE_SHA", value.stderr)

    def test_duplicate_local_or_world_tile_is_forbidden(self):
        for key in ("tile", "local_xyz"):
            payload = request()
            payload["cells"][1][key] = copy.deepcopy(payload["cells"][0][key])
            value = run(payload)
            self.assertEqual(value.returncode, 2)
            self.assertEqual(value.stdout, "")
            self.assertIn("E_B0_DUPLICATE_CELL", value.stderr)

    def test_missing_extra_bad_rows_rejected(self):
        for mutation in ("short", "wide", "negative", "float"):
            payload = request()
            rows = payload["cells"][1]["reference_rows"]
            if mutation == "short":
                rows.pop()
            if mutation == "wide":
                rows.append(0)
            if mutation == "negative":
                rows[0] = -1
            if mutation == "float":
                rows[0] = 0.5
            value = run(payload)
            self.assertEqual(value.returncode, 2, mutation)
            self.assertEqual(value.stdout, "", mutation)

    def test_cell_count_and_malformed_protocol_fail_closed(self):
        for mutation in ("one", "nine", "wrong_schema", "unknown_field", "bad_material"):
            payload = request()
            if mutation == "one":
                payload["cells"].pop()
            if mutation == "nine":
                payload["cells"] *= 5
            if mutation == "wrong_schema":
                payload["schema"] = "invalid"
            if mutation == "unknown_field":
                payload["cells"][0]["invented"] = 1
            if mutation == "bad_material":
                payload["material"] = "UNTRUSTED"
            value = run(payload)
            self.assertEqual(value.returncode, 2, mutation)
            self.assertEqual(value.stdout, "", mutation)

    def test_local_shift_with_same_world_tile_changes_only_model_binding(self):
        payload = request()
        payload["cells"][1]["local_xyz"] = [-1, 0, 0]
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertIn("E_B0_INCONSISTENT_ANCHOR", value.stderr)

    def test_world_tile_mutation_cannot_change_the_instance_anchor(self):
        payload = request()
        payload["cells"][1]["tile"] = [7, 0, 0]
        value = run(payload)
        self.assertEqual(value.returncode, 2)
        self.assertEqual(value.stdout, "")
        self.assertIn("E_B0_INCONSISTENT_ANCHOR", value.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
