"""Сравнение общего C++20 сборщика с принятым Python B2."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BUILDER = Path(sys.argv.pop(3))
import test_r06_multicell as oracle


class WholeBuild(unittest.TestCase):
    sources = oracle.WholeObject.sources
    command = oracle.WholeObject.command

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)

    def native(self, receipt, sha, lofts, out, *, material="stone", source_hashes=None):
        command = [str(BUILDER), str(receipt), sha, material, str(out)]
        for index, path in enumerate(lofts):
            expected = oracle.digest(path.read_bytes()) if source_hashes is None else source_hashes[index]
            command.extend((str(path), expected))
        return subprocess.run(command, capture_output=True, check=False, timeout=90)

    def test_native_parity(self):
        shapes = [
            ({(15, 6, 4), (16, 6, 4)}, (0, 0, 0)),
            ({(x, y, 3) for x in range(14, 18) for y in range(14, 18)
              if x in (14, 17) or y in (14, 17)}, (0, 0, 0)),
            ({(-1, 0, 23), (-1, 0, 24), (0, 0, 24)}, (2, 3, 4)),
        ]
        for number, (world, anchor) in enumerate(shapes):
            with self.subTest(number=number):
                receipt, sha, lofts = self.sources(world, anchor=anchor)
                if number == 2:
                    named = json.loads(receipt.read_bytes())
                    named["instance"] = "многоэтажный 🛰"
                    receipt.write_bytes(oracle.canonical(named))
                    sha = oracle.digest(receipt.read_bytes())
                expected, actual = self.root / f"py-{number}", self.root / f"cpp-{number}"
                material = "m" + "a" * 79 if number == 2 else "stone"
                py = subprocess.run(self.command(receipt, sha, lofts, expected, material=material),
                                    capture_output=True, check=False, timeout=90)
                self.assertEqual(py.returncode, 0, py.stderr)
                cpp = self.native(receipt, sha, list(reversed(lofts)), actual, material=material)
                self.assertEqual(cpp.returncode, 0, cpp.stderr)
                for filename in ("model.fgm.json", "slices.json", "preview.obj", "report.json"):
                    self.assertEqual((expected / filename).read_bytes(), (actual / filename).read_bytes(),
                                     filename)
                proof = json.loads((actual / "input-proof.json").read_bytes())
                self.assertEqual(proof["receipt_sha256"], sha)
                self.assertEqual(proof["verification_scope"], "transport_integrity_binding_c05")
                self.assertFalse(proof["reran_b1"])
                self.assertFalse(proof["rederived_r03"])
                self.assertEqual([cell["sha256"] for cell in proof["source_hashes"]],
                                 [oracle.digest(p.read_bytes()) for p in lofts])

    def test_input_rejections(self):
        receipt, sha, lofts = self.sources({(15, 6, 4), (16, 6, 4)})
        out = self.root / "reject"
        def rejects(code, **options):
            result = self.native(receipt, options.pop("sha", sha), options.pop("lofts", lofts),
                                 out, **options)
            self.assertEqual(result.returncode, 2, result.stderr)
            self.assertIn(code.encode(), result.stderr)
            self.assertFalse(out.exists())
        rejects("E_S43_BUILD_RECEIPT_SHA", sha="0" * 64)
        rejects("E_S43_BUILD_LOFT_SHA", source_hashes=["0" * 64, oracle.digest(lofts[1].read_bytes())])
        rejects("E_S43_BUILD_MATERIAL", material="A")
        rejects("E_S43_BUILD_MATERIAL", material="m" * 81)
        rejects("E_S43_BUILD_LOFT_SET", lofts=[lofts[0], lofts[0]])
        extra = self.root / "extra.json"
        extra.write_bytes(oracle.canonical(oracle.make_loft((2, 0, 0), 2, {(0, 6, 4)})))
        rejects("E_S43_BUILD_LOFT_SET", lofts=[*lofts, extra])
        initial = receipt.read_bytes()
        receipt.write_bytes(initial[:-1] + b',"status":"verified_explicit_membership"}')
        rejects("E_S43_BUILD_JSON", sha=oracle.digest(receipt.read_bytes()))
        receipt.write_bytes(initial + b"\0suffix")
        rejects("E_S43_BUILD_JSON", sha=oracle.digest(receipt.read_bytes()))
        receipt.write_bytes(b" " * (1024 * 1024 + 1))
        rejects("E_S43_BUILD_LIMIT", sha=oracle.digest(receipt.read_bytes()))
        changed = json.loads(initial)
        changed["status"] = "hypothesis"
        receipt.write_bytes(oracle.canonical(changed))
        rejects("E_S43_BUILD_MEMBERSHIP", sha=oracle.digest(receipt.read_bytes()))
        receipt.write_bytes(initial)
        changed = json.loads(initial)
        changed["cell_bindings"][0]["local_xyz"][0] = 1
        receipt.write_bytes(oracle.canonical(changed))
        rejects("E_S43_BUILD_BINDING", sha=oracle.digest(receipt.read_bytes()))
        receipt.write_bytes(initial)
        initial_loft = lofts[0].read_bytes()
        invalid = json.loads(initial_loft)
        invalid["part_rows"][3][0][0] = True
        lofts[0].write_bytes(oracle.canonical(invalid))
        rejects("E_S43_BUILD_LOFT_ROWS")
        for section, field, value in (
            ("tile", "record_index", 42),
            ("sources", "local_index", 42),
            ("sources", "dataset_label", "OTHER"),
            ("sources", "part", "floor"),
        ):
            with self.subTest(field=field):
                changed = json.loads(initial_loft)
                target = changed[section] if section == "tile" else changed[section][3]
                target[field] = value
                lofts[0].write_bytes(oracle.canonical(changed))
                rejects("E_S43_BUILD_LOFT_BINDING")

    def test_missing_cell_and_box_budget(self):
        world = {(x, y, z) for x in range(48) for y in range(16) for z in range(24)
                 if (x + y + z) % 2 == 0}
        receipt, sha, lofts = self.sources(world)
        out = self.root / "overbudget"
        missing = self.native(receipt, sha, lofts[:-1], out)
        self.assertEqual(missing.returncode, 2, missing.stderr)
        self.assertIn(b"E_S43_BUILD_LOFT_SET", missing.stderr)
        rejected = self.native(receipt, sha, lofts, out)
        self.assertEqual(rejected.returncode, 2, rejected.stderr)
        self.assertIn(b"E_S43_BUILD_LIMIT", rejected.stderr)
        self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
