"""Независимые синтетические тесты R07-S1B1B1A: единая модель, общий C05.

Ни FGM интерпретатор, ни native R05 не используются в аналитическом
oracle ожиданий. Оригинальные игровые материалы не требуются.
"""
import copy
from concurrent.futures import ThreadPoolExecutor
from fractions import Fraction
import importlib.util
import hashlib
import json
from itertools import product
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

FIT = Path(sys.argv.pop(1))
BINARY = Path(sys.argv.pop(1))


def load_joint():
    spec = importlib.util.spec_from_file_location("whole_joint_fit_test", FIT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enc(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value):
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def box_model(radius=4.0):
    nodes = []
    roots = []
    for i in range(2):
        nodes.extend([
            {"id": f"extent_{i}", "op": "constant", "type": "vec3",
             "value": [radius, radius, radius]},
            {"id": f"offset_{i}", "op": "constant", "type": "vec3",
             "value": [8 + i*16, 8, 12]},
            {"id": f"box_{i}", "op": "box", "halfSize": f"extent_{i}"},
            {"id": f"move_{i}", "op": "translate",
             "field": f"box_{i}", "offset": f"offset_{i}"}
        ])
        roots.append(f"move_{i}")
    nodes.append({"id": "union_0", "op": "union",
                  "left": roots[0], "right": roots[1]})
    generation = {
        "algorithm": "r06_multicell_loft_boxes", "version": "0.1.0",
        "parameters": {"cell_xyz": [16, 16, 24]},
        "resources": {"membership": "1"*64,
                      "loft_observations": "2"*64,
                      "material_sha256": digest(enc("stone"))}
    }
    seed = digest(enc(["fgm:seed:1", {"generation": generation,
                                      "purpose": "model"}]))
    return enc({"format": "fgm-package/1", "interpreter": "fgm-0/1",
                "generation": generation,
                "model": {"seed": seed, "volumes": {},
                          "contributions": [{
                              "id": "whole_object", "priority": 0,
                              "material": "stone",
                              "field": {"op": "program", "parameters": {},
                                        "program": {"version": "fgm-0",
                                                    "nodes": nodes,
                                                    "root": "union_0"}}
                          }]}})


def voxel_rows():
    rows = [0] * 384
    for z in range(24):
        for y in range(16):
            for x in range(16):
                # Independent analytic box slab occupancy, radius=4.0/4.49.
                if abs(x + .5 - 8) < 4 and abs(y + .5 - 8) < 4 and \
                        abs(z + .5 - 12) < 4:
                    rows[z*16+y] |= 1 << (15-x)
    return rows


def analytic_pixels(radius, tile, *, p_level=0, right_half=False):
    result = []
    for py in range(40):
        for px in range(16 if right_half else 0, 32):
            d, h = px + .5 - 16, py + .5 - p_level - 20
            lo = max(0, d, d/2 + h, 8-radius, 8-radius+d,
                     12-radius+d/2+h)
            hi = min(16, 16+d, 24+d/2+h, 8+radius, 8+radius+d,
                     12+radius+d/2+h)
            if hi > lo+1e-9:
                result.append([px + 16*tile, py + 8*tile - p_level])
    return sorted(result)


def request(first_radius=4.49, second_radius=4.49, *,
            second_observation=True, p_level=0, right_half=False):
    model = box_model()
    rows = voxel_rows()
    cells = []
    for i, radius in enumerate((first_radius, second_radius)):
        observed = analytic_pixels(radius, i, p_level=p_level,
                                   right_half=right_half) if \
            (i == 0 or second_observation) else None
        cells.append({
            "tile": [i, 0, 0], "local_xyz": [i, 0, 0],
            "reference_rows": rows.copy(), "reference_rows_sha256": digest(enc(rows)),
            "p_level": p_level, "right_half": right_half,
            "observed_pixels_xy": observed,
            "observed_sha256": digest(enc(observed)) if observed is not None else None
        })
    return {"schema": "fgmr-r07-whole-joint-synthetic-request/1",
            "synthetic_only": True, "baseline_package": model,
            "baseline_sha256": digest(model), "membership_sha256": "1"*64,
            "material": "stone", "cells": cells}


def sampled_box_pixels(extent, shift, tile):
    """Solve for the first sample in the open box interval using 1/200 voxel units."""
    center = [1600 + 2*shift[0], 1600 + 2*shift[1], 2400 + 2*shift[2]]
    low = [v - 2*e for v, e in zip(center, extent, strict=True)]
    high = [v + 2*e for v, e in zip(center, extent, strict=True)]
    pixels = set()
    for py in range(40):
        for px in range(32):
            d, z = 200*px - 3100, 100*px + 200*py - 5450
            ray_start, ray_end = max(0, d, z), min(3200, 3200+d, 4800+z)
            enter, leave = max(low[0], low[1]+d, low[2]+z), min(high[0], high[1]+d, high[2]+z)
            sample = ray_start + 25*max(0, (enter-ray_start)//25 + 1)
            if ray_start < ray_end and sample <= ray_end and sample < leave:
                pixels.add((px + 16*tile, py + 8*tile))
    return pixels


class JointFit(unittest.TestCase):
    def setUp(self):
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        self.path = Path(holder.name)
        self.sha = digest(BINARY.read_bytes())

    def fit_command(self, payload, output, native=None, native_sha=None):
        manifest = self.path / "request.json"
        manifest.write_text(enc(payload), encoding="utf-8")
        return [sys.executable, str(FIT), "--request", str(manifest),
                "--native", str(native or BINARY), "--native-sha256", native_sha or self.sha,
                "--output", str(output)]

    def run_fit(self, payload, out="output", *, native=None, native_sha=None):
        output = self.path / out
        command = self.fit_command(payload, output, native, native_sha)
        result = subprocess.run(command, capture_output=True, text=True,
                                timeout=180)
        return result, output

    def success(self, payload):
        result, output = self.run_fit(payload)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(output.is_dir())
        receipt = json.loads((output / "joint-fit-receipt.json").read_text())
        return receipt, output

    def rejected(self, payload, code, **opts):
        result, output = self.run_fit(payload, **opts)
        self.assertEqual(result.returncode, 2, (result.stdout, result.stderr))
        self.assertIn(code, result.stderr)
        self.assertFalse(output.exists(), "failed run must not publish output")

    def test_two_analytic_observations_joint_improve_one_model(self):
        receipt, output = self.success(request())
        self.assertEqual(receipt["status"], "PARAMETERS_IMPROVED_SYNTHETIC_ONLY")
        self.assertEqual(receipt["stage_a"], "NOT_ACCEPTED")
        self.assertEqual(receipt["observed_parts"], 2)
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)
        self.assertEqual(receipt["best_delta"], .49)
        self.assertTrue(receipt["strictly_improved"])
        self.assertEqual(receipt["winner_loss"]["micro"]["common"], 488)
        self.assertEqual(receipt["winner_loss"]["micro"]["union"], 488)
        self.assertEqual(receipt["baseline_loss"]["micro"]["common"], 384)
        self.assertEqual(receipt["baseline_loss"]["micro"]["union"], 488)
        self.assertEqual(len(receipt["trace"]), 5)
        self.assertEqual([x["gate"] for x in receipt["trace"]].count("C05_REJECTED"), 2)
        self.assertEqual(receipt["source"], "SYNTHETIC_ONLY_NOT_UFO_SOURCE_BOUND")
        candidate = json.loads((output / "whole-candidate.fgm.json").read_bytes())
        nodes = candidate["model"]["contributions"][0]["field"]["program"]["nodes"]
        self.assertEqual(nodes[0]["value"], [4.49]*3)
        self.assertEqual(nodes[4]["value"], [4.49]*3)
        self.assertEqual(candidate["generation"]["algorithm"],
                         "r07_s1b1b1a_joint_extent")

    def test_strict_per_observation_guard_prevents_one_cell_regression(self):
        # One cell wants to shrink, the other wants to expand.
        receipt, _ = self.success(request(first_radius=3.51, second_radius=4.49))
        self.assertEqual(receipt["status"], "UNRESOLVED_NO_IMPROVEMENT")
        self.assertEqual(receipt["best_delta"], 0.0)
        self.assertFalse(receipt["strictly_improved"])
        self.assertTrue(any(x.get("per_observation_guard") is False
                            for x in receipt["trace"]))

    def test_minimum_half_extent_skips_negative_deltas_and_continues(self):
        payload = request()
        model = json.loads(payload["baseline_package"])
        nodes = model["model"]["contributions"][0]["field"]["program"]["nodes"]
        nodes[0]["value"] = [0.5, 4, 4]
        nodes[1]["value"][0] = 8.5
        payload["baseline_package"] = enc(model)
        payload["baseline_sha256"] = digest(payload["baseline_package"])
        # The first slab occupies exactly x=8 at all its original y/z centers.
        cell = payload["cells"][0]
        rows = [(1 << 7) if 8 <= z < 16 and 4 <= y < 12 else 0
                for z in range(24) for y in range(16)]
        cell["reference_rows"] = rows
        cell["reference_rows_sha256"] = digest(enc(rows))

        receipt, _ = self.success(payload)
        self.assertEqual({entry["delta"]: entry["gate"] for entry in receipt["trace"]}, {
            0.0: "C05_PASS", -0.98: "OUT_OF_DOMAIN_CANDIDATE_REJECTED",
            -0.49: "OUT_OF_DOMAIN_CANDIDATE_REJECTED", 0.49: "C05_PASS",
            0.98: "C05_REJECTED",
        })

    def test_right_half_and_p_level_still_fit(self):
        receipt, _ = self.success(request(p_level=5, right_half=True))
        self.assertEqual(receipt["best_delta"], 0.49)
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)

    def test_original_evidence_not_silently_accepted(self):
        forged = request()
        forged["synthetic_only"] = False
        self.rejected(forged, "E_B1_SYNTHETIC_ONLY")
        forged = request(second_observation=False)
        self.rejected(forged, "E_B1_INSUFFICIENT_OBSERVATIONS")

    def test_every_reference_cell_participates_in_C05(self):
        payload = request()
        for i in (0, 1):
            wrong = copy.deepcopy(payload)
            wrong["cells"][i]["reference_rows"][0] ^= 1
            wrong["cells"][i]["reference_rows_sha256"] = digest(
                enc(wrong["cells"][i]["reference_rows"]))
            self.rejected(wrong, "E_B1_NATIVE_FAILURE")

    def test_provenance_and_model_grammar_fail_closed(self):
        bad = request()
        bad["baseline_sha256"] = "0"*64
        self.rejected(bad, "E_B1_BASELINE_SHA")
        bad = request()
        bad["membership_sha256"] = "0"*64
        self.rejected(bad, "E_B1_PROVENANCE")
        bad = request()
        model = json.loads(bad["baseline_package"])
        model["model"]["contributions"][0]["field"]["program"]["nodes"][-1][
            "right"] = "move_0"
        bad["baseline_package"] = enc(model)
        bad["baseline_sha256"] = digest(bad["baseline_package"])
        self.rejected(bad, "E_B1_GRAMMAR")
        bad = request()
        bad["baseline_package"] = json.dumps(json.loads(bad["baseline_package"]),
                                             indent=1)
        bad["baseline_sha256"] = digest(bad["baseline_package"])
        self.rejected(bad, "E_B1_MODEL_NOT_CANONICAL")

    def test_observation_digest_camera_and_rows_guard(self):
        bad = request()
        bad["cells"][1]["observed_sha256"] = "0"*64
        self.rejected(bad, "E_B1_OBSERVATION")
        bad = request()
        bad["cells"][0]["reference_rows_sha256"] = "0"*64
        self.rejected(bad, "E_B1_ROWS")
        bad = request()
        bad["cells"][1]["tile"] = [2, 0, 0]
        self.rejected(bad, "E_B1_ANCHOR")
        bad = request()
        bad["cells"][1]["right_half"] = "false"
        self.rejected(bad, "E_B1_CAMERA")

    def test_native_sha_pinned_and_existing_output_protected(self):
        self.rejected(request(), "E_B1_NATIVE_SHA", native_sha="0"*64)
        output = self.path / "output"
        output.mkdir()
        result, _ = self.run_fit(request())
        self.assertEqual(result.returncode, 2)
        self.assertIn("E_B1_OUTPUT_EXISTS", result.stderr)

    def test_empty_output_created_after_check_is_preserved(self):
        joint = load_joint()
        output = self.path / "output"
        check = joint.check_output

        def create_after_check(path):
            check(path)
            path.mkdir()

        with mock.patch.object(joint, "check_output", side_effect=create_after_check):
            with self.assertRaisesRegex(joint.FitError, "^E_B1_OUTPUT_EXISTS$"):
                joint.publish(output, b"baseline", b"winner", {})
        self.assertEqual(list(self.path.iterdir()), [output])
        self.assertEqual(list(output.iterdir()), [])

    def test_parallel_processes_publish_once_to_same_output(self):
        output = self.path / "output"
        command = self.fit_command(request(), output)

        def launch(_):
            return subprocess.run(command, capture_output=True, text=True, timeout=180)

        with ThreadPoolExecutor(max_workers=2) as workers:
            results = list(workers.map(launch, range(2)))
        self.assertCountEqual([r.returncode for r in results], [0, 2])
        loser = next(r for r in results if r.returncode == 2)
        self.assertEqual(loser.stdout, "")
        self.assertIn("E_B1_OUTPUT_EXISTS", loser.stderr)
        self.assertEqual({p.name for p in output.iterdir()},
                         {"whole-baseline.fgm.json", "whole-candidate.fgm.json",
                          "joint-fit-receipt.json"})
        self.assertEqual({p.name for p in self.path.iterdir()}, {"output", "request.json"})

    def test_native_c05_exact_lf_or_crlf_and_no_other_failure(self):
        module = load_joint()
        sample = request()
        model = sample["baseline_package"].encode()
        cells = sample["cells"]
        prefix = b"R07-S1B1B0: E_B0_C05_ALL_CELLS_MISMATCH"
        for suffix in (b"\n", b"\r\n"):
            native = subprocess.CompletedProcess(["native"], 2, b"", prefix + suffix)
            with mock.patch.object(module.subprocess, "run", return_value=native):
                self.assertIsNone(module.native_observe(BINARY, model, "stone", cells, .49))
                with self.assertRaises(module.FitError):
                    module.native_observe(BINARY, model, "stone", cells, 0)
        # Reject success-looking stderr, partial stdout, or incorrect error bytes.
        for code, out, err in (
            (2, b"partial", prefix + b"\n"),
            (2, b"", prefix + b"\n\n"),
            (2, b"", prefix),
            (1, b"", prefix + b"\r\n"),
            (0, b"", prefix + b"\n")
        ):
            native = subprocess.CompletedProcess(["native"], code, out, err)
            with mock.patch.object(module.subprocess, "run", return_value=native):
                with self.assertRaises(module.FitError):
                    module.native_observe(BINARY, model, "stone", cells, .49)

    def test_repeatability_across_independent_runs(self):
        payload = request()
        a, first = self.run_fit(payload, "first")
        b, second = self.run_fit(payload, "second")
        self.assertEqual(a.returncode, 0, a.stderr)
        self.assertEqual(b.returncode, 0, b.stderr)
        for item in ("whole-baseline.fgm.json", "whole-candidate.fgm.json",
                     "joint-fit-receipt.json"):
            self.assertEqual((first / item).read_bytes(), (second / item).read_bytes())

    def test_legacy_scalar_artifact_bytes_match_accepted_snapshot(self):
        _, output = self.success(request())
        expected = {
            "whole-baseline.fgm.json": "bb3de8be3cf007121498dd3f6273c4990486f5e49a302ea08d1f01c9a27c116c",
            "whole-candidate.fgm.json": "e982e1160cc7fe2c6386727daef3dde98f8edb242f8870f10f35e8e2049eaabf",
            "joint-fit-receipt.json": "cb8af0057ea538c955b0b200e4e3fd7c944b322b3c95db2077a61ed5caf07791",
        }
        # Native executable bytes vary by platform. The receipt must carry
        # this build's SHA, and every other byte must match accepted PR #63.
        native_field = f'"native_sha256":"{self.sha}",'.encode()
        for name, sha in expected.items():
            data = (output / name).read_bytes()
            if name == "joint-fit-receipt.json":
                self.assertEqual(data.count(native_field), 1)
                data = data.replace(native_field, b"")
            self.assertEqual(digest(data), sha, name)

    def test_all_55_axis_candidates_against_integer_oracle(self):
        joint = load_joint()
        payload = request(first_radius=4.49, second_radius=3.51)
        package, material, membership, cells = joint.inspect_request(payload)
        _, receipt = joint.fit(package, material, membership, cells, BINARY, self.sha,
                               self.path, axis_fit=True)
        zero = (0, 0, 0)
        combinations = list(product((-49, 0, 49), repeat=3))
        cases = [("isotropic_extent", n, (n,)*3, zero) for n in (0, -98, -49, 49, 98)]
        cases += [("axis_extent", v, v, zero) for v in combinations if not v[0] == v[1] == v[2]]
        cases += [("axis_translation", v, zero, v) for v in combinations if v != zero]
        self.assertEqual(len(receipt["trace"]), 55)
        self.assertEqual(receipt["c05_checked_per_candidate"], 12288)
        observed = [{tuple(p) for p in cell["observed_pixels_xy"]} for cell in cells]
        original_masks = [sampled_box_pixels((400,)*3, zero, tile) for tile in range(2)]
        baseline = [Fraction(len(a & b), len(a | b))
                    for a, b in zip(original_masks, observed, strict=True)]
        for item, (kind, change, size, shift) in zip(receipt["trace"], cases, strict=True):
            with self.subTest(kind=kind, change=change):
                self.assertEqual(item["kind"], kind)
                self.assertEqual(item["delta"], tuple(n/100 for n in change)
                                 if isinstance(change, tuple) else change/100)
                extent = tuple(400 + adjustment for adjustment in size)
                occupied = [[n for n in range(-8, 8) if abs(100*n + 50 - offset) < e]
                            for offset, e in zip(shift, extent, strict=True)]
                if occupied != [list(range(-4, 4))] * 3:
                    self.assertEqual(item["gate"], "C05_REJECTED")
                    self.assertNotIn("loss", item)
                    continue
                self.assertEqual(item["gate"], "C05_PASS")
                predicted = [sampled_box_pixels(extent, shift, tile) for tile in range(2)]
                scores = [(len(a & b), len(a | b)) for a, b in zip(predicted, observed, strict=True)]
                self.assertEqual(item["loss"]["cells"],
                                 [{"common": hit, "union": total, "predicted": len(mask),
                                   "observed": len(sprite)}
                                  for (hit, total), mask, sprite in zip(scores, predicted, observed, strict=True)])
                self.assertEqual(item["loss"]["micro"],
                                 {"common": sum(hit for hit, _ in scores),
                                  "union": sum(total for _, total in scores)})
                if change != 0:
                    allowed = all(Fraction(*score) >= base for score, base in zip(scores, baseline, strict=True))
                    self.assertEqual(item["per_observation_guard"], allowed)

    def test_axis_translation_rejected_on_real_c05_occupancy_change(self):
        joint = load_joint()
        payload = request()
        payload["baseline_package"] = box_model(3.75)
        payload["baseline_sha256"] = digest(payload["baseline_package"])
        package, material, membership, cells = joint.inspect_request(payload)
        _, receipt = joint.fit(package, material, membership, cells, BINARY, self.sha,
                               self.path, axis_fit=True)
        shift = next(item for item in receipt["trace"]
                     if item["kind"] == "axis_translation" and item["delta"] == (0.49, 0, 0))
        self.assertEqual(shift["gate"], "C05_REJECTED")
        self.assertNotIn("loss", shift)


if __name__ == "__main__":
    unittest.main(verbosity=2)
