"""R03: независимый oracle voxelCheck для собственных LOFT/MCD/MAP байтов."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

EXECUTABLE = str(Path(sys.argv.pop(1)).resolve()) if len(sys.argv) > 1 else ""

MAP = bytes((1, 1, 1, 1, 2, 3, 4))
PROFILES = [
    [0x8001 if y == 0 else 0x8000 if y == 15 else 0 for y in range(16)],
    [0x0001 if y == 0 else 0x00FF if y == 7 else 0 for y in range(16)],
    [0x8000 if y == 0 else 0xFFFF if y == 5 else 0 for y in range(16)],
    [0 for _ in range(16)],
]
LOFT = b"".join(value.to_bytes(2, "little")
                for profile in PROFILES for value in profile)
PART_NAMES = ("floor", "west_wall", "north_wall", "object")
WINNERS = "FWNO"
PART_LAYERS = ((0,) * 12, (0, 1) * 6, (2,) * 12, (3,) * 12)


def mcd(profile_ids):
    assert len(profile_ids) == 12
    raw = bytearray(62)
    raw[8:20] = bytes(profile_ids)
    raw[42] = 12
    raw[44] = raw[46] = 0
    raw[61] = 0xDB
    return bytes(raw)


def oracle(z, y, x, sources=PART_LAYERS, profiles=PROFILES):
    if x < 0 or x >= 16 or y < 0 or y >= 16 or z < 0 or z >= 24:
        return None
    return tuple(bool(profiles[ids[z // 2]][y] & (1 << (15 - x)))
                 if ids is not None else False for ids in sources)


class LoftTerrain(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fgmr-r03-")
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.map = root / "own.MAP"
        self.alpha = root / "ALPHA.MCD"
        self.beta = root / "BETA.MCD"
        self.loft = root / "OWN_LOFT.DAT"
        self.map.write_bytes(MAP)
        self.alpha.write_bytes(
            mcd((3,) * 12) + mcd(PART_LAYERS[0]) + mcd(PART_LAYERS[1])
        )
        self.beta.write_bytes(
            mcd(PART_LAYERS[2]) + mcd(PART_LAYERS[3])
        )
        self.loft.write_bytes(LOFT)

    def call(self, *options):
        args = [
            EXECUTABLE, "--map", str(self.map),
            "--mcd", f"ALPHA={self.alpha}",
            "--mcd", f"BETA={self.beta}",
            "--loft", str(self.loft)
        ]
        if "--tile" not in options:
            args.extend(("--tile", "0,0,0"))
        args.extend(options)
        return subprocess.run(
            args, capture_output=True, text=True,
            encoding="utf-8", timeout=35
        )

    def run_good(self, *options):
        r = self.call(*options)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(r.stderr)
        return json.loads(r.stdout)

    def rejects(self, code, *options):
        r = self.call(*options)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn(code, r.stderr)
        self.assertFalse(r.stdout)
        self.assertNotIn(str(self.map.parent), r.stderr)

    def test_metadata_and_selection(self):
        d = self.run_good()
        self.assertEqual(d["schema"], "fgm-regenerator/loft-terrain-v1")
        self.assertEqual(d["voxel_dimensions_xyz"], [16, 16, 24])
        self.assertTrue(d["terrain_only"])
        self.assertFalse(d["dynamic_doors_units_gravlift"])
        self.assertEqual(d["tile"]["xyz"], [0, 0, 0])
        self.assertEqual(d["tile"]["record_index"], 0)
        self.assertEqual(d["loft_profiles"], 4)

    def test_four_source_roles_and_global_dataset_boundary(self):
        src = self.run_good()["sources"]
        self.assertEqual([s["part"] for s in src], list(PART_NAMES))
        self.assertEqual([s["source_index"] for s in src], [1, 2, 3, 4])
        self.assertEqual([(s["dataset_label"], s["local_index"]) for s in src],
                         [("ALPHA", 1), ("ALPHA", 2), ("BETA", 0), ("BETA", 1)])
        self.assertEqual(src[1]["loft_ids"], list(PART_LAYERS[1]))

    def test_loft_id_zero_not_absence(self):
        d = self.run_good()
        self.assertEqual(d["sources"][0]["loft_ids"][0], 0)
        self.assertEqual(d["part_rows"][0][0][0], 0x8001)
        self.assertEqual(d["first_hit_rows"][0][0][0], "F")

    def test_byte_order_msb_left_and_lsb_right(self):
        d = self.run_good()
        self.assertEqual(d["part_rows"][0][0][0], 0x8001)
        self.assertEqual(d["first_hit_rows"][0][0][0], "F")
        self.assertEqual(d["first_hit_rows"][0][0][15], "F")
        self.assertEqual(d["first_hit_rows"][0][0][1], ".")

    def test_z_layer_pairs_and_extremes(self):
        d = self.run_good()
        west = d["part_rows"][1]
        self.assertEqual(west[0][7], 0)
        self.assertEqual(west[1][7], 0)
        self.assertEqual(west[2][7], 0x00FF)
        self.assertEqual(west[3][7], 0x00FF)
        self.assertEqual(west[22][7], 0x00FF)
        self.assertEqual(west[23][7], 0x00FF)
        self.assertEqual(d["part_rows"][0][23][15], 0x8000)

    def test_oracle_every_voxel_every_part_and_first_hit(self):
        d = self.run_good()
        self.assertEqual(len(d["first_hit_rows"]), 24)
        for z in range(24):
            self.assertEqual(len(d["first_hit_rows"][z]), 16)
            for y in range(16):
                self.assertEqual(len(d["first_hit_rows"][z][y]), 16)
                for x in range(16):
                    expected = oracle(z, y, x)
                    for part, bit in enumerate(expected):
                        row = d["part_rows"][part][z][y]
                        self.assertEqual(bool(row & (1 << (15 - x))), bit,
                                         (x, y, z, part))
                    self.assertEqual(bool(d["union_rows"][z][y] &
                                          (1 << (15 - x))), any(expected))
                    hit = next((WINNERS[p] for p in range(4) if expected[p]), ".")
                    self.assertEqual(d["first_hit_rows"][z][y][x], hit)

    def test_pinned_counts_independent_from_builder(self):
        d = self.run_good()
        self.assertEqual(d["counts"], {
            "parts": [72, 144, 408, 0], "union": 552,
        })

    def test_mask_first_hit_precedence_and_full_provenance(self):
        d = self.run_good("--voxel", "0,0,0")
        s = d["sample"]
        self.assertEqual(s["status"], "hit")
        self.assertEqual(s["first_part"], 0)
        self.assertEqual([w["part"] for w in s["witnesses"]],
                         ["floor", "west_wall", "north_wall"])
        self.assertEqual([(w["loft_id"], w["row"], w["bit"]) for w in s["witnesses"]],
                         [(0, 0, 15), (0, 0, 15), (2, 0, 15)])
        self.assertEqual(s["witnesses"][2]["dataset_label"], "BETA")
        self.assertEqual(s["witnesses"][2]["local_index"], 0)

    def test_west_only_hit_and_empty(self):
        west = self.run_good("--voxel", "8,7,2")["sample"]
        self.assertEqual(west["first_part"], 1)
        self.assertEqual([w["part"] for w in west["witnesses"]], ["west_wall"])
        empty = self.run_good("--voxel", "4,3,4")["sample"]
        self.assertEqual(empty["status"], "empty")
        self.assertEqual(empty["witnesses"], [])

    def test_y_edges_bit_order_and_height_23(self):
        edge = self.run_good("--voxel", "0,15,23")["sample"]
        self.assertEqual(edge["first_part"], 0)
        self.assertEqual(edge["witnesses"][0]["row"], 15)
        self.assertEqual(edge["witnesses"][0]["bit"], 15)
        last = self.run_good("--voxel", "15,7,23")["sample"]
        self.assertEqual(last["first_part"], 1)

    def test_negative_and_just_outside_voxel_coordinates(self):
        for coord in ("-1,0,0", "0,-1,0", "0,0,-1",
                      "16,0,0", "0,16,0", "0,0,24",
                      "-2147483648,0,0", "2147483647,0,0"):
            with self.subTest(point=coord):
                sample = self.run_good("--voxel", coord)["sample"]
                self.assertEqual(sample["status"], "out_of_bounds")
                self.assertNotIn("first_part", sample)
                self.assertNotIn("witnesses", sample)

    def test_repeated_json_bit_identical(self):
        a,b=self.call("--voxel","15,7,23"),self.call("--voxel","15,7,23")
        self.assertEqual(a.returncode,0)
        self.assertEqual(b.returncode,0)
        self.assertEqual(a.stdout.encode(),b.stdout.encode())

    def test_no_private_file_paths_or_time_data(self):
        raw=self.call()
        self.assertEqual(raw.returncode,0)
        self.assertNotIn(str(self.map.parent),raw.stdout)
        self.assertNotIn("OWN_LOFT.DAT",raw.stdout)
        self.assertNotIn("timestamp",raw.stdout)
        self.assertEqual(raw.stderr,"")

    def test_absent_map_parts_do_not_read_profile_zero(self):
        self.map.write_bytes(bytes((1,1,1,0,0,0,0)))
        d=self.run_good()
        self.assertEqual(d["counts"]["union"],0)
        self.assertEqual([s["present"] for s in d["sources"]],[False]*4)
        self.assertEqual(d["first_hit_rows"][0][0],"."*16)

    def test_object_hit_when_no_other_part(self):
        self.map.write_bytes(bytes((1,1,1,0,0,0,4)))
        b=bytearray(self.beta.read_bytes())
        b[62+8:62+20]=bytes((2,)*12)
        self.beta.write_bytes(b)
        d=self.run_good("--voxel","0,5,0")
        self.assertEqual(d["sample"]["first_part"],3)
        self.assertEqual(d["sample"]["witnesses"][0]["part"],"object")

    def test_north_wall_has_priority_over_object(self):
        self.map.write_bytes(bytes((1,1,1,0,0,3,4)))
        b=bytearray(self.beta.read_bytes())
        b[62+8:62+20]=bytes((2,)*12)
        self.beta.write_bytes(b)
        s=self.run_good("--voxel","0,5,1")["sample"]
        self.assertEqual([a["part"] for a in s["witnesses"]],
                         ["north_wall","object"])
        self.assertEqual(s["first_part"],2)

    def test_reject_malformed_loft_length(self):
        self.loft.write_bytes(LOFT[:-1])
        self.rejects("E_R03_LOFT_ALIGNMENT")

    def test_reject_empty_loft_file(self):
        self.loft.write_bytes(b"")
        self.rejects("E_R03_INPUT_LIMIT")

    def test_reject_missing_loft_profile_reference(self):
        bad=bytearray(self.alpha.read_bytes())
        bad[62+8]=4
        self.alpha.write_bytes(bad)
        self.rejects("E_R03_LOFT_REFERENCE")

    def test_reject_selected_tile_outside_map(self):
        for tile in ("-1,0,0", "0,-1,0", "0,0,-1",
                     "1,0,0", "0,1,0", "0,0,1"):
            with self.subTest(tile=tile):
                self.rejects("E_R03_TILE_BOUNDS","--tile",tile)

    def test_reject_duplicate_tile_argument(self):
        r=self.call("--tile","0,0,0","--tile","0,0,0")
        self.assertEqual(r.returncode,64)
        self.assertIn("E_R03_ARGUMENTS",r.stderr)
        self.assertFalse(r.stdout)

    def test_reject_invalid_coordinate_syntax(self):
        for value in ("0,0", "0,0,0,0", "1,,3", "a,0,0", "1.1,0,0",
                      "2147483648,0,0"):
            r=self.call("--voxel",value)
            self.assertEqual(r.returncode,64)
            self.assertIn("E_R03_COORDINATES",r.stderr)

    def test_reject_mcd_corruption_via_r02(self):
        data=bytearray(self.alpha.read_bytes())
        data[42]=0
        self.alpha.write_bytes(data)
        self.rejects("E_R02_MCD_ZERO_ARMOR")

    def test_reject_missing_global_mcd_index(self):
        self.map.write_bytes(bytes((1,1,1,0,0,0,5)))
        self.rejects("E_R02_MAP_INDEX_OUT_OF_RANGE")

    def test_reject_wrong_loft_bit_endianness_by_witness(self):
        data=bytearray(self.loft.read_bytes())
        data[0:2]=b"\x80\x00"
        self.loft.write_bytes(data)
        d=self.run_good()
        self.assertEqual(d["part_rows"][0][0][0],0x0080)
        # После изменения байтов пола северная стена по-прежнему занята.
        self.assertEqual(d["first_hit_rows"][0][0][0],"N")
        self.assertEqual(d["first_hit_rows"][0][0][8],"F")

    def test_255_loft_profile_id_is_addressable(self):
        profiles=bytearray(256*32)
        profiles[255*32]=0x01
        self.loft.write_bytes(profiles)
        a=bytearray(self.alpha.read_bytes())
        a[62+8:62+20]=bytes((255,)*12)
        self.alpha.write_bytes(a)
        self.map.write_bytes(bytes((1,1,1,1,0,0,0)))
        d=self.run_good("--voxel","15,0,0")
        self.assertEqual(d["loft_profiles"],256)
        self.assertEqual(d["sample"]["first_part"],0)
        self.assertEqual(d["sample"]["witnesses"][0]["loft_id"],255)

    def test_reject_257_profiles_as_unaddressable(self):
        self.loft.write_bytes(bytes(257*32))
        self.rejects("E_R03_INPUT_LIMIT")

    def test_select_nonorigin_tile_with_z_descending_and_source_identity(self):
        cells = [bytes((0, 0, 0, 0)) for _ in range(8)]
        cells[0] = bytes((1, 0, 0, 0))  # top Z=1, X=Y=0
        cells[7] = bytes((0, 0, 0, 3))  # bottom Z=0, X=Y=1
        self.map.write_bytes(bytes((2, 2, 2)) + b"".join(cells))
        top = self.run_good("--tile", "0,0,1", "--voxel", "0,0,0")
        self.assertEqual(top["tile"]["record_index"], 0)
        self.assertEqual(top["sample"]["first_part"], 0)
        last = self.run_good("--tile", "1,1,0", "--voxel", "0,5,0")
        self.assertEqual(last["tile"]["record_index"], 7)
        self.assertEqual(last["tile"]["xyz"], [1, 1, 0])
        self.assertEqual(last["sample"]["first_part"], 3)
        self.assertEqual(last["sample"]["witnesses"][0]["dataset_label"], "BETA")
        empty = self.run_good("--tile", "1,0,1")
        self.assertEqual(empty["counts"]["union"], 0)

    def test_aggregate_mcd_limit_fail_closed(self):
        # Each file is below 1 MiB, but five together exceed the 4 MiB cap.
        extra = []
        for n in range(5):
            path = self.map.parent / f"owned_extra_{n}.MCD"
            path.write_bytes(b"\x00" * (62 * 14000))
            extra += ["--mcd", f"MORE_{n}={path}"]
        self.rejects("E_R03_AGGREGATE_LIMIT", *extra)

    def test_reject_final_file_symlink_if_supported(self):
        alias = self.map.parent / "symlink_loft.DAT"
        try:
            alias.symlink_to(self.loft)
        except (OSError, NotImplementedError):
            self.skipTest("Текущая файловая система запрещает создание symlink")
        args = [
            EXECUTABLE, "--map", str(self.map),
            "--mcd", f"ALPHA={self.alpha}", "--mcd", f"BETA={self.beta}",
            "--loft", str(alias), "--tile", "0,0,0"
        ]
        r = subprocess.run(args, capture_output=True, text=True, timeout=35)
        self.assertEqual(r.returncode, 2, r.stderr)
        self.assertIn("E_R03_INPUT_TYPE", r.stderr)
        self.assertFalse(r.stdout)

    def test_invalid_mcd_set_name(self):
        r=self.call("--mcd",f"../BAD={self.alpha}")
        self.assertEqual(r.returncode,2)
        self.assertIn("E_R02_DATASET_NAME",r.stderr)
        self.assertFalse(r.stdout)


if __name__=="__main__":
    unittest.main(verbosity=2)
