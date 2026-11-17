"""Собственные PCK/TAB и палитра с оракулом по координатам пикселей."""
import itertools
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

EXE = str(Path(sys.argv.pop(1)).resolve())
SLOTS = [2, 0, 2, 1, 0, 1, 2, 0]
FRAMES = [
    bytes([1, 7, 0, 254, 31, 253, 255]),
    bytes([40, 255]),
    bytes([39, 254, 31, 1, 255]),
]
RGB = [(i % 64, (3 * i + 1) % 64, (5 * i + 2) % 64) for i in range(256)]
PALETTE = bytes(774) + bytes(itertools.chain.from_iterable(RGB))
EXPECTED = [{(0, 1): 7, (1, 2): 253}, {}, {(31, 39): 1}]


def table(frames, bits):
    starts = itertools.accumulate([0, *map(len, frames[:-1])])
    return b"".join(struct.pack("<H" if bits == 16 else "<I", start) for start in starts)


def save_comparison(path, actual, expected):
    """Два ряда кадров: результат декодера и независимый эталон."""
    scale = 4
    width, height = 3 * 32 * scale, 2 * 40 * scale
    raster = bytearray()
    for row in (actual, expected):
        for y in range(40):
            scan = bytearray([0])
            for frame in row:
                for index in frame[y * 32:(y + 1) * 32]:
                    pixel = bytes([*(4 * c for c in RGB[index]), 255 if index else 0])
                    scan.extend(pixel * scale)
            raster.extend(scan * scale)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
                           + chunk(b"IDAT", zlib.compress(raster)) + chunk(b"IEND", b""))


class TerrainSprites(unittest.TestCase):
    def inspect(self, *, frames=FRAMES, tab=None, bits=16, palette=PALETTE,
                slots=SLOTS, record="1", bank="1", mcd=None):
        with tempfile.TemporaryDirectory(prefix="fgmr-r04-") as temp:
            root = Path(temp) / "кадры-図形"
            root.mkdir()
            files = {
                "pck": b"".join(frames),
                "tab": table(frames, bits) if tab is None else tab,
                "palette": palette,
                "mcd": bytes(62) + bytes(slots) + bytes(54) if mcd is None else mcd,
            }
            args = [EXE, "--tab-bits", str(bits), "--palette-index", bank, "--record", record]
            for kind, payload in files.items():
                path = root / kind
                path.write_bytes(payload)
                args.extend((f"--{kind}", str(path)))
            return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", check=False)

    def test_all_pixels_and_slots(self):
        for bits in (16, 32):
            with self.subTest(bits=bits):
                result = self.inspect(bits=bits)
                self.assertEqual(result.returncode, 0, result.stderr)
                facts = json.loads(result.stdout)
                self.assertEqual(facts["schema"], "fgm-regenerator/sprite-facts-v1")
                self.assertEqual((facts["width"], facts["height"]), (32, 40))
                self.assertEqual(facts["palette_offset"], 774)
                self.assertEqual(facts["record"], 1)
                self.assertIsNone(facts["orientation"])
                self.assertEqual(facts["mcd_frame_slots"], SLOTS)
                self.assertEqual(facts["palette_rgb6"], [list(rgb) for rgb in RGB])
                self.assertEqual(facts["palette_rgb8"], [[4*c for c in rgb] for rgb in RGB])
                self.assertEqual([f["id"] for f in facts["frames"]], [2, 0, 1])
                actual, expected = {}, {}
                for f in facts["frames"]:
                    i = f["id"]
                    self.assertEqual(f["offset"], sum(map(len, FRAMES[:i])))
                    raster = bytes(EXPECTED[i].get((x, y), 0) for y in range(40) for x in range(32))
                    actual[i] = bytes.fromhex(f["indices_hex"])
                    expected[i] = raster
                    self.assertEqual(actual[i], raster)
                    self.assertEqual(bytes.fromhex(f["alpha_hex"]), bytes(255 if p else 0 for p in raster))

                if bits == 16 and (output := os.environ.get("FGMR_R04_COMPARISON")):
                    save_comparison(output, [actual[i] for i in range(3)],
                                    [expected[i] for i in range(3)])

    def test_one_frame_tab16_and_zero_run(self):
        result = self.inspect(frames=[b"\x00\xfe\x00\x05\xff"], slots=[0]*8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(bytes.fromhex(json.loads(result.stdout)["frames"][0]["indices_hex"]),
                         b"\x05" + bytes(1279))

    def test_transparent_padding_at_frame_boundary(self):
        padded = bytes([39, 17, 254, 35, 254, 2, 255])
        following = bytes([0, 23, 255])
        for bits in (16, 32):
            with self.subTest(bits=bits):
                result = self.inspect(frames=[padded, following], slots=[0, 1]*4, bits=bits)
                self.assertEqual(result.returncode, 0, result.stderr)
                facts = json.loads(result.stdout)
                expected = [bytes(39*32) + bytes([17]) + bytes(31), bytes([23]) + bytes(1279)]
                self.assertEqual(len(facts["frames"]), len(expected))
                for frame, raster in zip(facts["frames"], expected):
                    self.assertEqual(bytes.fromhex(frame["indices_hex"]), raster)
                    self.assertEqual(bytes.fromhex(frame["alpha_hex"]),
                                     bytes(255 if pixel else 0 for pixel in raster))
                self.assertEqual(facts["frames"][0]["end_offset"], len(padded))
                self.assertEqual(facts["frames"][1]["offset"], len(padded))

    def test_malformed_inputs(self):
        cases = [
            ("TAB_LENGTH", dict(tab=b"\0")),
            ("TAB_OFFSET", dict(tab=struct.pack("<3H", 1, 7, 9))),
            ("TAB_OFFSET", dict(tab=struct.pack("<3H", 0, 0, 9))),
            ("TAB_OFFSET", dict(tab=struct.pack("<3H", 0, 10, 9))),
            ("TAB_OFFSET", dict(tab=struct.pack("<3H", 0, 7, 14))),
            ("FRAME_TERMINATOR", dict(frames=[b"\0\x07", *FRAMES[1:]])),
            ("FRAME_RUN", dict(frames=[b"\0\xfe", *FRAMES[1:]])),
            ("FRAME_TRAILING", dict(frames=[b"\0\xff\x05", *FRAMES[1:]])),
            ("FRAME_BOUNDS", dict(frames=[b"\x29\xff", *FRAMES[1:]])),
            ("FRAME_BOUNDS", dict(frames=[b"\x28\x01\xff", *FRAMES[1:]])),
            ("FRAME_BOUNDS", dict(frames=[bytes([39, 254, 35, 1, 255]), *FRAMES[1:]])),
            ("FRAME_TERMINATOR", dict(frames=[bytes([39, 254, 35]), *FRAMES[1:]])),
            ("FRAME_TRAILING", dict(frames=[bytes([39, 254, 35, 255, 1]), *FRAMES[1:]])),
            ("FRAME_TERMINATOR", dict(frames=[b"\0\xfe\xff", *FRAMES[1:]])),
            ("FRAME_TERMINATOR", dict(frames=[FRAMES[0], b"\0\x07", FRAMES[2]],
                                      slots=[0]*8)),
            ("FRAME_INDEX", dict(slots=[0]*7+[3])),
            ("MCD_ALIGNMENT", dict(mcd=bytes(123))),
            ("MCD_RECORD", dict(record="2")),
            ("PALETTE_LENGTH", dict(palette=PALETTE[:-1])),
            ("PALETTE_LENGTH", dict(bank="99999999")),
            ("PALETTE_RGB6", dict(palette=PALETTE[:-1]+b"\x40")),
            ("ARGUMENTS", dict(bits=64, tab=b"\0\0")),
            ("ARGUMENTS", dict(record="-1")),
        ]
        for error, arguments in cases:
            with self.subTest(error=error, arguments=arguments.keys()):
                result = self.inspect(**arguments)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")
                self.assertIn(f"E_R04_{error}", result.stderr)


if __name__ == "__main__":
    unittest.main()
