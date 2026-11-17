"""R07-S1A: native FGM surface sensitivity, independent analytic oracle, and fail-closed gates.
Only original synthetic FGM programs are used; never publish local game assets.
"""
import hashlib
import json
import math
import subprocess
import sys
import unittest

BINARY = sys.argv.pop(1)
SCHEMA = "fgmr-r07-surface-request/1"


def enc(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha(payload):
    if isinstance(payload, str):
        payload = payload.encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def package(radius, *, hollow=False, empty=False, slab=False, tunnel=False):
    def vector(name, values):
        return {"id": name, "op": "constant", "type": "vec3", "value": values}
    nodes = [vector("extent", [radius, radius, 0.75 if slab else radius]),
             {"id": "outer", "op": "box", "halfSize": "extent"},
             vector("offset", [8, 8, 12]),
             {"id": "moved", "op": "translate", "field": "outer", "offset": "offset"}]
    root = "moved"
    if hollow or tunnel:
        nodes += [vector("hole_extent", [1.8, 1.8, 1.5] if tunnel else [1, 1, 1]),
                  {"id": "hole", "op": "box", "halfSize": "hole_extent"},
                  {"id": "moved_hole", "op": "translate", "field": "hole", "offset": "offset"},
                  {"id": "cutout", "op": "subtract", "left": "moved", "right": "moved_hole"}]
        root = "cutout"
    if empty:
        nodes.append({"id": "empty", "op": "subtract", "left": "moved", "right": "moved"})
        root = "empty"
    generation = {"algorithm": "r07_s1a_box_probe", "version": "1.0.0",
                  "parameters": {"radius": radius, "hollow": int(hollow), "empty": int(empty),
                                 "slab": int(slab), "tunnel": int(tunnel)},
                  "resources": {}}
    seed = sha(enc(["fgm:seed:1", {"generation": generation, "purpose": "model"}]))
    return enc({"format": "fgm-package/1", "interpreter": "fgm-0/1",
                "generation": generation,
                "model": {"seed": seed, "volumes": {},
                          "contributions": [{"id": "terrain", "material": "stone", "priority": 0,
                              "field": {"op": "program", "parameters": {},
                                        "program": {"version": "fgm-0",
                                                    "nodes": nodes, "root": root}}}]}})


def rows(radius, *, hollow=False, empty=False, slab=False, tunnel=False):
    result = [0] * 384
    for z in range(24):
        for y in range(16):
            for x in range(16):
                inside = (abs(x + 0.5 - 8) < radius and
                          abs(y + 0.5 - 8) < radius and
                          abs(z + 0.5 - 12) < (0.75 if slab else radius))
                hole_xy = 1.8 if tunnel else 1.0
                hole_z = 1.5 if tunnel else 1.0
                hole = (abs(x + 0.5 - 8) < hole_xy and
                        abs(y + 0.5 - 8) < hole_xy and
                        abs(z + 0.5 - 12) < hole_z)
                if inside and not empty and not ((hollow or tunnel) and hole):
                    result[z * 16 + y] |= 1 << (15-x)
    return result


def request(radius, *, hollow=False, empty=False, slab=False, tunnel=False,
            offset=(0, 0),
            tile=(0, 0, 0), p_level=0, right_half=False):
    model = package(radius, hollow=hollow, empty=empty, slab=slab, tunnel=tunnel)
    return {"schema": SCHEMA, "package": model, "package_sha256": sha(model),
            "reference_rows": rows(radius, hollow=hollow, empty=empty,
                                   slab=slab, tunnel=tunnel), "material": "stone",
            "tile": list(tile), "camera_offset": list(offset),
            "p_level": p_level, "right_half": right_half}


def run(request_document):
    result = subprocess.run([BINARY], input=enc(request_document), text=True,
                            capture_output=True, timeout=60)
    if result.returncode:
        raise AssertionError("native rejected: " + result.stderr)
    return json.loads(result.stdout)


def rejected(request_document, code):
    result = subprocess.run([BINARY], input=enc(request_document), text=True,
                            capture_output=True, timeout=60)
    assert result.returncode == 2, (result.returncode, result.stderr)
    assert code in result.stderr, result.stderr
    assert not result.stdout, "no successful sidecar on rejection"


def analytic_box_mask(radius):
    """Independent ray/axis-aligned-box slab intersection; does NOT call FGM or raster source."""
    result = set()
    for py in range(40):
        for px in range(32):
            # Screen pixel center; independent intersection of 6 box planes
            u, v = px + 0.5, py + 0.5
            d, h = u - 16.0, v - 20.0
            lo = max(0, d, d/2 + h, 8-radius, 8-radius+d,
                     12-radius+d/2+h)
            hi = min(16, 16+d, 24+d/2+h, 8+radius, 8+radius+d,
                     12+radius+d/2+h)
            if hi > lo + 1e-9:
                result.add((px, py))
    return result


def keys(value):
    return {tuple(pair) for pair in value["surface_pixels_xy"]}


class SurfaceS1A(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.small = run(request(3.51))
        cls.large = run(request(4.49))

    def test_nonconstant_surface_under_exact_equal_c05(self):
        a, b = self.small, self.large
        self.assertEqual(rows(3.51), rows(4.49), "identical 6144 occupancy centers")
        for value in (a, b):
            self.assertEqual(value["schema"], "fgmr-r07-surface-observation/1")
            self.assertEqual(value["c05"]["checked"], 6144)
            self.assertTrue(value["c05"]["match"])
            self.assertEqual(value["c05"]["scope"], "voxel_centers_only")
            self.assertEqual(value["raster"]["completeness"], "UNRESOLVED_THIN_FEATURES")
            self.assertEqual(value["surface_mask_sha256"], sha(enc(value["surface_pixels_xy"])))
        self.assertEqual(a["loft_mask_sha256"], b["loft_mask_sha256"])
        self.assertNotEqual(a["model_sha256"], b["model_sha256"])
        self.assertNotEqual(a["surface_mask_sha256"], b["surface_mask_sha256"],
                            "E_R07_NONCONSTANT: LOFT replacement mutant must fail")
        self.assertGreater(len(keys(b) ^ keys(a)), 0)

    def test_independent_analytic_polygon_oracle(self):
        for radius, observed in ((3.51, self.small), (4.49, self.large)):
            expected = analytic_box_mask(radius)
            self.assertEqual(keys(observed), expected)
        self.assertEqual(len(keys(self.small)), 148)
        self.assertEqual(len(keys(self.large)), 244)
        self.assertEqual(len(keys(self.large) ^ keys(self.small)), 96)

    def test_loft_replacement_mutant_is_detected(self):
        # Deliberate fake sidecar mutation: pretend each surface result is its unchanged LOFT mask.
        a = dict(self.small, surface_mask_sha256=self.small["loft_mask_sha256"])
        b = dict(self.large, surface_mask_sha256=self.large["loft_mask_sha256"])
        self.assertEqual(a["surface_mask_sha256"], b["surface_mask_sha256"])
        with self.assertRaisesRegex(AssertionError, "E_R07_NONCONSTANT"):
            self.assertNotEqual(a["surface_mask_sha256"], b["surface_mask_sha256"],
                                "E_R07_NONCONSTANT")

    def test_repeatability_and_camera_translation(self):
        self.assertEqual(self.small, run(request(3.51)))
        offset = (13, -7)
        moved = run(request(3.51, offset=offset))
        self.assertEqual(keys(moved), {(x + offset[0], y + offset[1])
                                      for x, y in keys(self.small)})
        self.assertEqual(moved["camera"]["tile_anchor"], [13, -7])
        self.assertEqual(moved["raster"]["pixel_center"], [0.5, 0.5])
        self.assertEqual(moved["raster"]["algorithm"], "r07-r05-center-rays/1")
        anchored = run(request(3.51, tile=(3, 2, 1), offset=(101, -43), p_level=2))
        self.assertEqual(anchored["camera"]["tile_anchor"], [117, -27])
        self.assertEqual(anchored["camera"]["sprite_anchor"], [117, -29])
        # C++ R05 uses integer truncation: (40+1-46)/2 = -2; continuous = -2.5.
        self.assertEqual(math.trunc((40+1-46)/2), -2)
        self.assertEqual((40+1-46)/2, -2.5)

    def test_right_half_plevel_and_occluded_hole(self):
        cut = run(request(4.49, right_half=True, p_level=20))
        anchor = cut["camera"]["sprite_anchor"]
        self.assertEqual(anchor, [0, -20])
        self.assertTrue(keys(cut))
        self.assertTrue(all(anchor[0]+16 <= x < anchor[0]+32 and
                            anchor[1] <= y < anchor[1]+40 for x, y in keys(cut)))
        self.assertEqual(keys(cut), {p for p in keys(self.large)
                                     if 16 <= p[0] < 32 and -20 <= p[1] < 20})
        shell = run(request(4.49, hollow=True))
        self.assertNotEqual(shell["reference_rows_sha256"], self.large["reference_rows_sha256"])
        # The hollow cavity is occluded by outer walls from this viewing direction.
        self.assertEqual(keys(shell), keys(self.large))
        empty = run(request(4.49, empty=True))
        self.assertEqual(empty["surface_pixels"], 0)
        self.assertEqual(empty["loft_pixels"], 0)


    def test_real_through_hole_changes_silhouette(self):
        # Thin XY slab; subtract a deeper opening so the R05 ray sees true background.
        solid = run(request(4.49, slab=True))
        open_panel = run(request(4.49, slab=True, tunnel=True))
        self.assertTrue(solid["c05"]["match"] and open_panel["c05"]["match"])
        self.assertEqual(solid["surface_pixels"], 100)
        self.assertEqual(open_panel["surface_pixels"], 96)
        self.assertEqual(len(keys(solid) - keys(open_panel)), 4)
        self.assertEqual(keys(open_panel) - keys(solid), set())
        self.assertNotEqual(solid["reference_rows_sha256"],
                            open_panel["reference_rows_sha256"])

    def test_fail_closed_digest_source_rows_limits(self):
        spec = request(3.51)
        spec["package_sha256"] = "0" * 64
        rejected(spec, "E_S1A_PACKAGE_SHA")
        spec = request(3.51)
        spec["reference_rows"][0] = 3
        rejected(spec, "E_S1A_C05_LOFT_MISMATCH")
        spec = request(3.51)
        spec["camera_offset"] = [0, 10000]
        rejected(spec, "E_S1A_RANGE")
        spec = request(3.51)
        spec["right_half"] = "false"
        rejected(spec, "E_S1A_RIGHT_HALF")
        spec = request(3.51)
        spec["reference_rows"] = [0]
        rejected(spec, "E_S1A_LOFT_ROWS")
        spec = request(3.51)
        spec["extra_untrusted"] = True
        rejected(spec, "E_S1A_REQUEST")


if __name__ == "__main__":
    unittest.main(verbosity=2)
