"""R02: синтетические MAP/MCD, независимые индексы и round-trip фактов."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BINARY = str(Path(sys.argv[1]).resolve()) if len(sys.argv) > 1 else ""
if len(sys.argv) > 1:
    del sys.argv[1]

PARTS = ("floor", "west_wall", "north_wall", "object")
# Независимо закодированный порядок: X быстрее Y, Z сверху вниз;
# MAP header именно (Y, X, Z), а не (X, Y, Z).
RAW_SLOTS = [
    (1, 2, 3, 4), (0, 1, 0, 2), (3, 4, 1, 2),
    (1, 0, 0, 0), (4, 3, 2, 1), (0, 0, 0, 0),
    (2, 1, 4, 3), (4, 0, 0, 1), (3, 2, 0, 0),
    (0, 0, 1, 0), (1, 2, 3, 4), (2, 0, 0, 3),
]
HEADER = bytes((2, 3, 2))
MAP_BYTES = HEADER + bytes(v for row in RAW_SLOTS for v in row)


def record(index, armor=12, die=0, alt=0):
    raw = bytearray(62)
    raw[:8] = bytes((index * 8 + i) % 256 for i in range(8))
    raw[8:20] = bytes((30 + index * 12 + i) % 256 for i in range(12))
    raw[20:22] = bytes((0x34, 0x12))
    raw[30:38] = bytes((1, 1, 0, 4, 0, 1, 0, 1))
    raw[39:47] = bytes((8, 7, 6, armor, 32, die, 11, alt))
    raw[48] = (-4) & 255
    raw[49] = 5
    raw[51:61] = bytes((7, 3, 3, 2, 9, 8, 4, 1, 6, 0))
    raw[61] = 0xDA  # неизвестный байт не должен теряться или трактоваться
    return bytes(raw)


class R02Facts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="fgmr-r02-")
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.map = self.dir / "synthetic.MAP"
        self.a = self.dir / "alpha.MCD"
        self.b = self.dir / "beta.MCD"
        self.map.write_bytes(MAP_BYTES)
        self.a.write_bytes(b"".join(record(i, die=i, alt=0) for i in range(3)))
        self.b.write_bytes(b"".join(record(i, die=i, alt=0) for i in range(2)))

    def execute(self, *args):
        return subprocess.run(
            [BINARY, *map(str, args)], capture_output=True, text=True,
            encoding="utf-8", timeout=30
        )

    def run_decoder(self, order=None):
        order = order or (("ALPHA", self.a), ("BETA", self.b))
        args = ["--map", self.map]
        for name, path in order:
            args.extend(("--mcd", f"{name}={path}"))
        return self.execute(*args)

    def facts(self):
        process = self.run_decoder()
        self.assertEqual(process.returncode, 0, process.stderr)
        return json.loads(process.stdout)

    def assert_failure(self, expected, *args):
        process = self.execute(*args)
        self.assertEqual(process.returncode, 2, process.stderr)
        self.assertIn(expected, process.stderr)
        self.assertFalse(process.stdout)
        self.assertNotIn(str(self.dir), process.stderr)

    def test_primary_exact_header_and_dimensions(self):
        obj = self.facts()
        self.assertEqual(obj["schema"], "fgm-regenerator/map-mcd-facts-v1")
        self.assertEqual(obj["map"]["header_yxz"], [2, 3, 2])
        self.assertEqual(obj["map"]["dimensions_xyz"], [3, 2, 2])

    def test_order_and_axes_all_record_indices(self):
        tiles = self.facts()["map"]["tiles"]
        self.assertEqual(len(tiles), 12)
        for i, tile in enumerate(tiles):
            self.assertEqual(tile["record_index"], i)
            self.assertEqual((tile["x"], tile["y"], tile["z"]),
                             (i % 3, (i // 3) % 2, 1 - i // 6))
            self.assertEqual(tuple(part["kind"] for part in tile["parts"]), PARTS)
            self.assertEqual([part["source_index"] for part in tile["parts"]],
                             list(RAW_SLOTS[i]))

    def test_zero_part_is_absent_and_no_local_index(self):
        tiles = self.facts()["map"]["tiles"]
        empty = tiles[5]["parts"]
        self.assertEqual([x["present"] for x in empty], [False] * 4)
        for entry in empty:
            self.assertNotIn("dataset", entry)
            self.assertNotIn("local_index", entry)

    def test_exact_multiset_mapping_no_decrement(self):
        first = self.facts()["map"]["tiles"][0]["parts"]
        self.assertEqual([(part["dataset"], part["local_index"]) for part in first],
                         [("ALPHA", 1), ("ALPHA", 2), ("BETA", 0), ("BETA", 1)])
        self.assertEqual([p["source_index"] for p in first], [1, 2, 3, 4])

    def test_order_of_datasets_is_part_of_identity(self):
        first = self.facts()["map"]["tiles"][0]["parts"]
        swapped = self.run_decoder((("BETA", self.b), ("ALPHA", self.a)))
        self.assertEqual(swapped.returncode, 0, swapped.stderr)
        after = json.loads(swapped.stdout)["map"]["tiles"][0]["parts"]
        self.assertNotEqual([(x["dataset"], x["local_index"]) for x in first],
                            [(x["dataset"], x["local_index"]) for x in after])

    def test_exact_mcd_offsets_and_signed_terrain_level(self):
        rec = self.facts()["datasets"][0]["records"][1]
        self.assertEqual(rec["index"], 1)
        self.assertEqual(rec["frame"], list(range(8, 16)))
        self.assertEqual(rec["loft"], list(range(42, 54)))
        self.assertEqual(rec["scan_g"], 0x1234)
        self.assertEqual(rec["ufo_door"], 1)
        self.assertEqual(rec["stop_los"], 1)
        self.assertEqual(rec["big_wall"], 4)
        self.assertEqual(rec["door"], 1)
        self.assertEqual((rec["tu_walk"], rec["tu_slide"], rec["tu_fly"]), (8, 7, 6))
        self.assertEqual(rec["armor"], 12)
        self.assertEqual(rec["die_mcd"], 1)
        self.assertEqual(rec["alt_mcd"], 0)
        self.assertEqual(rec["terrain_level"], -4)
        self.assertEqual(rec["p_level"], 5)
        self.assertEqual(rec["tile_type"], 3)

    def test_roundtrip_serialized_map_facts_bit_exact(self):
        facts = self.facts()
        reconstructed = bytes(facts["map"]["header_yxz"])
        for tile in facts["map"]["tiles"]:
            reconstructed += bytes(p["source_index"] for p in tile["parts"])
        self.assertEqual(reconstructed, MAP_BYTES)

    def test_roundtrip_serialized_mcd_facts_unknown_bytes(self):
        facts = self.facts()
        datasets = [(self.a, facts["datasets"][0]), (self.b, facts["datasets"][1])]
        for path, set_info in datasets:
            observed = b"".join(bytes.fromhex(record["raw_hex"])
                                for record in set_info["records"])
            self.assertEqual(observed, path.read_bytes())
            self.assertTrue(all(bytes.fromhex(record["raw_hex"])[61] == 0xDA
                                for record in set_info["records"]))

    def test_output_contains_no_private_paths(self):
        process = self.run_decoder()
        self.assertEqual(process.returncode, 0)
        self.assertNotIn(str(self.dir), process.stdout)
        self.assertNotIn("synthetic.MAP", process.stdout)

    def test_repeatability_without_dynamic_timestamps(self):
        p1, p2 = self.run_decoder(), self.run_decoder()
        self.assertEqual(p1.returncode, 0)
        self.assertEqual(p2.returncode, 0)
        self.assertEqual(p1.stdout.encode(), p2.stdout.encode())

    def test_invalid_zero_dimension(self):
        self.map.write_bytes(bytes((2, 0, 2)))
        self.assert_failure("E_R02_MAP_DIMENSION", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}")

    def test_invalid_short_header(self):
        self.map.write_bytes(bytes((2, 3)))
        self.assert_failure("E_R02_MAP_HEADER", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}")

    def test_invalid_truncated_map(self):
        self.map.write_bytes(MAP_BYTES[:-1])
        self.assert_failure("E_R02_MAP_LENGTH", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_invalid_extra_map_byte(self):
        self.map.write_bytes(MAP_BYTES + b"\x99")
        self.assert_failure("E_R02_MAP_LENGTH", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_missing_ordered_dataset_is_error(self):
        self.assert_failure("E_R02_MAP_INDEX_OUT_OF_RANGE", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}")

    def test_invalid_mcd_alignment(self):
        self.a.write_bytes(self.a.read_bytes()[:-1])
        self.assert_failure("E_R02_MCD_ALIGNMENT", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_invalid_die_mcd_local_reference(self):
        source = bytearray(self.a.read_bytes())
        source[44] = 4
        self.a.write_bytes(source)
        self.assert_failure("E_R02_MCD_LOCAL_REFERENCE", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_invalid_alt_mcd_local_reference(self):
        source = bytearray(self.a.read_bytes())
        source[46] = 3
        self.a.write_bytes(source)
        self.assert_failure("E_R02_MCD_LOCAL_REFERENCE", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_invalid_armor_fails_instead_of_silent_patch(self):
        source = bytearray(self.a.read_bytes())
        source[42] = 0
        self.a.write_bytes(source)
        self.assert_failure("E_R02_MCD_ZERO_ARMOR", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"BETA={self.b}")

    def test_duplicate_dataset_identity(self):
        self.assert_failure("E_R02_DUPLICATE_DATASET", "--map", self.map,
                            "--mcd", f"ALPHA={self.a}", "--mcd", f"ALPHA={self.b}")

    def test_bad_dataset_identity_is_error(self):
        self.assert_failure("E_R02_DATASET_NAME", "--map", self.map,
                            "--mcd", f"../PRIVATE={self.a}")

    def test_nonexistent_explicit_resource(self):
        self.assert_failure("E_R02_INPUT_TYPE", "--map", self.map,
                            "--mcd", f"ALPHA={self.dir / 'absent.MCD'}")

    def test_invalid_flag_rejected_without_file_output(self):
        p = self.execute("--map", self.map, "--unknown")
        self.assertEqual(p.returncode, 64)
        self.assertIn("E_R02_ARGUMENTS", p.stderr)
        self.assertEqual(p.stdout, "")


if __name__ == "__main__":
    unittest.main(verbosity=2)
