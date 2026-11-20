"""Synthetic source → native fit replay → original-neighbour inventory/Core halo.

Reuse the accepted binary-format fixture, not a new MAP/MCD/LOFT decoder.
No proprietary resources are used or exported.
"""
import json
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest import mock

SCRIPT, R02, R03, STUDIO, BUILDER, SURFACE, SAMPLER = map(lambda p: Path(p).resolve(), sys.argv[1:8])
del sys.argv[1:8]
sys.path.insert(0, str(SCRIPT.parent))
import r07_whole_boundary_audit as audit
import r07_whole_joint_fit as joint

TESTS = SCRIPT.parent.parent / "tests"
PREFLIGHT = SCRIPT.parent / "r07_whole_source_preflight.py"
SOURCE_FIT = SCRIPT.parent / "r07_whole_source_fit.py"
with mock.patch.object(sys, "argv", [str(TESTS/"test_r07_whole_source_preflight.py"),
        *map(str, (PREFLIGHT, STUDIO, R03, SOURCE_FIT, BUILDER, SURFACE))]):
    prior = runpy.run_path(str(TESTS/"test_r07_whole_source_preflight.py"))


class ObjectBoundary(unittest.TestCase):
    def setUp(self):
        self.fixture = prior["WholeSourcePreflight"]("runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        f = self.fixture
        self.root = f.root
        # Third cell is a separate source placement, deliberately the SAME MCD/LOFT.
        # The B1 declaration contains only cells0,1. It must not absorb cell2.
        data = bytes([1, 3, 1])+bytes([0, 1, 2, 2])*3
        (self.root/"map").write_bytes(data)
        f.selection["files"]["map"]["sha256"] = joint.sha(data)
        f.verified["provenance"]["map_sha256"] = joint.sha(data)
        f.verified["provenance"]["r02_sha256"] = joint.sha(R02.read_bytes())
        sprite = bytes([0, *prior["analytic_pixel_mask"](expansion=(.49,)*3), 255])
        (self.root/"pck").write_bytes(sprite)
        f.selection["files"]["pck"]["sha256"] = joint.sha(sprite)
        self.fit_command, self.fit_output = f.source_fit_command()
        run = subprocess.run(self.fit_command, capture_output=True, timeout=180)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.fit_receipt = self.fit_output/"joint-fit-receipt.json"
        self.expected_sha = joint.sha(self.fit_receipt.read_bytes())
        self.output = self.root/"boundary"

    def command(self, output=None):
        command = self.fit_command.copy()
        command[1] = str(SCRIPT)
        command[command.index("--output")+1] = str(output or self.output)
        command += ["--fit-receipt", str(self.fit_receipt), "--fit-receipt-sha256", self.expected_sha,
                    "--r02-native", str(R02), "--r02-sha256", joint.sha(R02.read_bytes()),
                    "--sampler-native", str(SAMPLER), "--sampler-sha256", joint.sha(SAMPLER.read_bytes()),
                    "--hypothesis-version", "1"]
        return command

    def invoke(self, command=None):
        return subprocess.run(command or self.command(), capture_output=True, timeout=180)

    def rejected(self, code, command=None):
        run = self.invoke(command)
        self.assertEqual(run.returncode, 2, (run.stdout, run.stderr))
        self.assertIn(code.encode(), run.stderr)
        self.assertEqual(run.stdout, b"")
        self.assertFalse(self.output.exists())
        self.assertNotIn(str(self.root).encode(), run.stderr)

    def test_native_source_replay_excludes_identical_independent_neighbour(self):
        run = self.invoke()
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual({p.name for p in self.output.iterdir()},
                         {"object-boundary.private.json", "object-boundary.public.json"})
        private = json.loads((self.output/"object-boundary.private.json").read_bytes())
        public = json.loads((self.output/"object-boundary.public.json").read_bytes())
        self.assertEqual(public, json.loads(run.stdout))
        self.assertEqual(public["private_card_sha256"], joint.sha((self.output/"object-boundary.private.json").read_bytes()))
        self.assertEqual(private["status"], "GEOMETRIC_BOUNDARY_PASS")
        self.assertEqual(private["hypothesis"]["version"], 1)
        self.assertEqual(private["hypothesis"]["identity"], "CONDITIONAL_ON_B1_WITNESS_NOT_AUTHENTICATED")
        self.assertEqual(private["selected_c05_centers"], 12288)
        self.assertEqual(public["halo_cells"], 34)  # 4×3×3 minus the two selected cells
        self.assertEqual(public["halo_checked_centers"], {"baseline": 208896, "winner": 208896})
        self.assertEqual(public["halo_occupied_centers"], {"baseline": 0, "winner": 0})
        self.assertEqual(public["stage_a"], "NOT_ACCEPTED")
        self.assertEqual(public["private_acceptance"], "PENDING")
        self.assertEqual(public["membership_semantics"], "NOT_AUTHENTICATED")
        cells = private["source_neighbourhood"]
        self.assertEqual(sum(c["source_status"] == "OUTSIDE_MAP" for c in cells), 33)
        target = next(c for c in cells if c["xyz"] == [1, 0, 0])
        neighbour = next(c for c in cells if c["xyz"] == [2, 0, 0])
        a = next(p for p in target["parts"] if p["part"] == "object")
        b = next(p for p in neighbour["parts"] if p["part"] == "object")
        self.assertEqual((a["dataset"], a["record"], a["loft_rows_sha256"]),
                         (b["dataset"], b["record"], b["loft_rows_sha256"]))
        self.assertEqual(a["membership"], "DECLARED_MEMBER")
        self.assertEqual(b["membership"], "EXCLUDED_FROM_TARGET_DECLARATION")
        self.assertTrue(all(p["semantic_identity"] == "UNRESOLVED" for c in cells for p in c["parts"]))
        self.assertEqual(sum(p["membership"] == "DECLARED_MEMBER" for c in cells for p in c["parts"]), 2)
        self.assertEqual(sum(len(c["parts"]) for c in cells), 9)
        before, after = private["before_loss"]["micro"], private["after_loss"]["micro"]
        self.assertGreater(after["common"]*before["union"], before["common"]*after["union"])
        print("R07_OBJECT_BOUNDARY_NATIVE_PASS", joint.canonical(public).decode())

    def test_public_summary_is_allowlisted_not_a_redacted_private_document(self):
        run = self.invoke()
        self.assertEqual(run.returncode, 0, run.stderr)
        card = json.loads((self.output/"object-boundary.private.json").read_bytes())
        card["hypothesis"]["object_key"] = "PRIVATE-NAME-CANARY"
        card["hypothesis"]["members"][0]["xyz"] = [123, 234, 45]
        card["source_neighbourhood"][0]["private_path"] = "SECRET-PATH-CANARY"
        card["new_unreviewed_field"] = {"pixels": "PIXELS-CANARY", "model": "FGM-CANARY"}
        encoded = joint.canonical(audit.public_summary(card))
        for canary in (b"PRIVATE-NAME-CANARY", b"SECRET-PATH-CANARY", b"PIXELS-CANARY", b"FGM-CANARY", b"[123,234,45]"):
            self.assertNotIn(canary, encoded)
        keys = set(json.loads(encoded))
        self.assertEqual(keys, {"schema", "status", "object_hypothesis_sha256", "private_card_sha256",
            "fit_receipt_sha256", "source_snapshot_sha256", "native_sha256", "model_sha256", "selected_cells", "selected_c05_centers", "halo_cells",
            "halo_checked_centers", "halo_occupied_centers", "membership_semantics", "native_origin",
            "stage_a", "private_acceptance"})

    def test_same_inputs_are_deterministic_and_existing_output_is_untouched(self):
        self.assertEqual(self.invoke().returncode, 0)
        files = {p.name: p.read_bytes() for p in self.output.iterdir()}
        other = self.root/"second-boundary"
        self.assertEqual(self.invoke(self.command(other)).returncode, 0)
        self.assertEqual(files, {p.name: p.read_bytes() for p in other.iterdir()})
        run = self.invoke()
        self.assertEqual(run.returncode, 2)
        self.assertIn(b"E_B1_OUTPUT_EXISTS", run.stderr)
        self.assertEqual(files, {p.name: p.read_bytes() for p in self.output.iterdir()})

    def test_wrong_receipt_sha(self):
        command = self.command()
        command[command.index("--fit-receipt-sha256")+1] = "0"*64
        self.rejected("E_BOUNDARY_FIT_RECEIPT_SHA", command)

    def test_rehashed_false_winner_receipt_is_not_a_source_replay(self):
        receipt = json.loads(self.fit_receipt.read_bytes())
        receipt["winner_sha256"] = "0"*64
        self.fit_receipt.write_bytes(joint.canonical(receipt)+b"\n")
        self.expected_sha = joint.sha(self.fit_receipt.read_bytes())
        self.rejected("E_BOUNDARY_FIT_REPLAY")

    def test_changed_original_source_rejects_without_dossier(self):
        (self.root/"pck").write_bytes(b"changed")
        self.rejected("E_R07_LOCAL_SOURCE_DIGEST")

    def test_wrong_b1_preflight_binary_and_mode_bindings(self):
        cases = (("--verified-sha256", "E_BOUNDARY_B1_SHA"),
                 ("--preflight-sha256", "E_BOUNDARY_PREFLIGHT_SHA"),
                 ("--sampler-sha256", "E_S2B_R02_BINDING"),
                 ("--r02-sha256", "E_BOUNDARY_B1_R02_SHA"))
        for field, code in cases:
            with self.subTest(field=field):
                command = self.command()
                command[command.index(field)+1] = "0"*64
                self.rejected(code, command)
        self.rejected("E_BOUNDARY_FIT_MODE", self.command()+["--axis-fit"])

    def test_invalid_version(self):
        command = self.command()
        command[command.index("--hypothesis-version")+1] = "0"
        self.rejected("E_BOUNDARY_VERSION", command)

    def test_halo_scope_is_not_silently_clipped(self):
        self.assertEqual(max(p[0] for p in audit.halo_of([
            {"local_xyz": [14, 0, 0]}, {"local_xyz": [15, 0, 0]}])), 16)
        with self.assertRaisesRegex(Exception, "E_BOUNDARY_HALO_SCOPE"):
            audit.halo_of([{"local_xyz": [15, 0, 0]}, {"local_xyz": [16, 0, 0]}])

    def test_native_core_exposes_leak_not_detected_by_selected_cell_c05(self):
        # A separate complete-cell solid: +.98 can retain every selected center
        # while adding centers outside the declared cells. No new evaluator.
        f = self.fixture
        f.output.unlink()
        self.fit_output.rename(self.root/"previous-fit")
        loft = bytes([255])*64
        (self.root/"loft").write_bytes(loft)
        f.selection["files"]["loft"]["sha256"] = joint.sha(loft)
        command, output = f.source_fit_command()
        result = subprocess.run(command, capture_output=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr)
        preview = json.loads((output/"fit-preview.json").read_bytes())
        package = (output/"whole-baseline.fgm.json").read_bytes().removesuffix(b"\n")
        model, count = joint.inspect_model(package, "stone", preview["membership_sha256"])
        candidate = joint.candidate(model, count, .98, package)
        checked = joint.native_observe(SURFACE, candidate, "stone", preview["cells"], .98)
        self.assertIsNotNone(checked)  # Existing hard all-cell C05 PASSES.
        halo = audit.halo_of(f.verified["cell_bindings"])
        baseline = audit.sample_halo(SAMPLER, package, "stone", halo, self.root, "full-baseline")
        leaked = audit.sample_halo(SAMPLER, candidate, "stone", halo, self.root, "full-expanded")
        self.assertEqual(baseline["occupied_centers"], 0)
        self.assertGreater(leaked["occupied_centers"], 0)
        self.assertEqual(leaked["occupied_centers"], 34*18*26-32*16*24)
        self.assertEqual(leaked["checked_centers"], 208896)
        self.assertEqual(audit.boundary_status(baseline, leaked), "REJECTED_HALO_OCCUPANCY")
        print("R07_OBJECT_BOUNDARY_SELECTED_C05_INSUFFICIENT", leaked["occupied_centers"])

    def test_sampler_corruption_is_not_boundary_success(self):
        package = (self.fit_output/"whole-baseline.fgm.json").read_bytes().removesuffix(b"\n")
        halo = audit.halo_of(self.fixture.verified["cell_bindings"])
        for cells in ([], [{"local_xyz": [0, 0, 0], "mask": "0"*6144}]*8):
            with self.subTest(cells=len(cells)), mock.patch.object(audit.local, "run", return_value={
                    "schema": "fgm-regenerator/whole-object-sampling-v1", "cells": cells}):
                with self.assertRaisesRegex(Exception, "E_BOUNDARY_SAMPLER_PROTOCOL"):
                    audit.sample_halo(SAMPLER, package, "stone", halo, self.root, "corrupted")


if __name__ == "__main__":
    unittest.main()
