"""Выполняемые положительные и отрицательные проверки корпуса R01."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from generate_r01 import CorpusError, IDENTIFIERS, generate
from verify_r01 import verify


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fgm-r01-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "corpus"
        generate(self.root)

    def test_three_classes_and_twelve_resources(self):
        report = verify(self.root)
        self.assertTrue(report["ok"])
        self.assertEqual(report["datasets"], 3)
        self.assertEqual(report["artifacts"], 12)
        self.assertEqual(tuple(IDENTIFIERS), ("slab", "arch", "boulder"))

    def test_every_asset_has_its_own_verified_digest_and_rights(self):
        manifest = json.loads((self.root / "manifest.json").read_text("utf-8"))
        for item in manifest["datasets"]:
            self.assertEqual(item["license"], "Unlicense")
            self.assertEqual(item["origin"], "authored_synthetic")
            self.assertEqual(len(item["artifacts"]), 4)
            for asset in item["artifacts"]:
                from hashlib import sha256
                b = (self.root / asset["path"]).read_bytes()
                self.assertEqual(asset["size"], len(b))
                self.assertEqual(asset["sha256"], sha256(b).hexdigest())

    def test_mask_and_projected_sprite_agree(self):
        for kind in IDENTIFIERS:
            mask = (self.root / kind / "volume.mask").read_bytes()
            pgm = (self.root / kind / "sprite.pgm").read_bytes()
            meta = json.loads((self.root / kind / "metadata.json").read_text("utf-8"))
            self.assertEqual(len(mask), 4096)
            self.assertTrue(set(mask) <= {0, 1})
            self.assertEqual(sum(mask), meta["occupancy_count"])
            self.assertTrue(pgm.startswith(b"P5\n16 16\n255\n"))
            pixels = pgm[len(b"P5\n16 16\n255\n"):]
            self.assertEqual(len(pixels), 256)
            for row in range(16):
                z = 15 - row
                for x in range(16):
                    reference = 255 if any(mask[z * 256 + y * 16 + x] for y in range(16)) else 0
                    self.assertEqual(pixels[row * 16 + x], reference)

    def test_reference_has_open_arch_and_flat_slab(self):
        def voxel(kind, x, y, z):
            return (self.root / kind / "volume.mask").read_bytes()[z * 256 + y * 16 + x]
        self.assertEqual(voxel("arch", 8, 8, 4), 0)
        self.assertEqual(voxel("arch", 3, 8, 4), 1)
        self.assertEqual(voxel("arch", 8, 8, 11), 1)
        self.assertEqual(voxel("slab", 8, 8, 2), 1)
        self.assertEqual(voxel("slab", 8, 8, 4), 0)

    def test_repeated_generation_identical(self):
        another = Path(self.temp.name) / "other"
        generate(another)
        for p in self.root.rglob("*"):
            if p.is_file():
                other = another / p.relative_to(self.root)
                self.assertEqual(p.read_bytes(), other.read_bytes())

    def test_existing_destination_never_overwritten(self):
        before = (self.root / "manifest.json").read_bytes()
        with self.assertRaisesRegex(CorpusError, "E_R01_OUTPUT_EXISTS"):
            generate(self.root)
        self.assertEqual(before, (self.root / "manifest.json").read_bytes())

    def test_rejects_modified_mask(self):
        path = self.root / "arch" / "volume.mask"
        raw = bytearray(path.read_bytes())
        raw[8] ^= 1
        path.write_bytes(raw)
        with self.assertRaisesRegex(CorpusError, "E_R01_BYTE_PARITY"):
            verify(self.root)

    def test_rejects_forged_origin(self):
        path = self.root / "manifest.json"
        obj = json.loads(path.read_text("utf-8"))
        obj["datasets"][0]["origin"] = "user_imported_private"
        path.write_text(json.dumps(obj), encoding="utf-8")
        with self.assertRaisesRegex(CorpusError, "E_R01_BYTE_PARITY"):
            verify(self.root)

    def test_rejects_changed_license(self):
        path = self.root / "manifest.json"
        obj = json.loads(path.read_text("utf-8"))
        obj["datasets"][0]["license"] = "unknown"
        path.write_text(json.dumps(obj), encoding="utf-8")
        with self.assertRaisesRegex(CorpusError, "E_R01_BYTE_PARITY"):
            verify(self.root)

    def test_rejects_modified_digest(self):
        path = self.root / "manifest.json"
        obj = json.loads(path.read_text("utf-8"))
        obj["datasets"][0]["artifacts"][0]["sha256"] = "0" * 64
        path.write_text(json.dumps(obj), encoding="utf-8")
        with self.assertRaisesRegex(CorpusError, "E_R01_BYTE_PARITY"):
            verify(self.root)

    def test_rejects_missing_resource(self):
        (self.root / "slab" / "sprite.pgm").unlink()
        with self.assertRaisesRegex(CorpusError, "E_R01_FILE_SET"):
            verify(self.root)

    def test_rejects_extra_source_file_even_with_safe_extension(self):
        (self.root / "arch" / "extra.json").write_text('{"extra": true}', encoding="utf-8")
        with self.assertRaisesRegex(CorpusError, "E_R01_FILE_SET"):
            verify(self.root)

    def test_rejects_hidden_artifacts(self):
        (self.root / ".hidden").write_bytes(b"forbidden")
        with self.assertRaisesRegex(CorpusError, "E_R01_HIDDEN_FILE"):
            verify(self.root)

    def test_rejects_symlink_to_external_source_when_supported(self):
        source = Path(self.temp.name) / "original-source"
        source.write_bytes(b"private")
        link = self.root / "slab" / "bad.link"
        try:
            link.symlink_to(source)
        except (OSError, NotImplementedError):
            self.skipTest("Создание символьных ссылок запрещено на этой машине")
        with self.assertRaisesRegex(CorpusError, "E_R01_SYMLINK"):
            verify(self.root)

    def test_rejects_extra_empty_directory_at_root(self):
        (self.root / "unexpected_empty").mkdir()
        with self.assertRaisesRegex(CorpusError, "E_R01_FILE_SET"):
            verify(self.root)

    def test_rejects_nested_empty_directory(self):
        (self.root / "boulder" / "unexpected_empty").mkdir()
        with self.assertRaisesRegex(CorpusError, "E_R01_FILE_SET"):
            verify(self.root)

    def test_pinned_geometry_counts_independent_of_generator(self):
        # Константы получены отдельно из заданной геометрии; не вызываем occupied().
        expected = {
            "slab": (200, 20),
            "arch": (360, 90),
            "boulder": (366, 71),
        }
        for kind, (volume_count, projected_count) in expected.items():
            with self.subTest(kind=kind):
                mask = (self.root / kind / "volume.mask").read_bytes()
                pgm = (self.root / kind / "sprite.pgm").read_bytes()
                self.assertEqual(sum(mask), volume_count)
                pixels = pgm[len(b"P5\n16 16\n255\n"):]
                self.assertEqual(pixels.count(255), projected_count)
                self.assertTrue(set(pixels) <= {0, 255})
                meta = json.loads((self.root / kind / "metadata.json").read_text("utf-8"))
                self.assertEqual(meta["occupancy_count"], volume_count)

    def test_boulder_independent_asymmetric_witness_points(self):
        mask = (self.root / "boulder" / "volume.mask").read_bytes()
        # Конкретные проверенные точки задают асимметричный вырез по +X/-Y/+Z.
        anchors = [
            ((8, 8, 6), 1), ((5, 6, 8), 1),
            ((10, 6, 8), 1), ((11, 6, 8), 0),
            ((11, 8, 8), 1), ((8, 8, 13), 0),
        ]
        for (x, y, z), expected in anchors:
            with self.subTest(x=x, y=y, z=z):
                self.assertEqual(mask[z * 256 + y * 16 + x], expected)

    @unittest.skipUnless(os.name == "nt", "NTFS junction проверяется на Windows")
    def test_rejects_windows_junction_child(self):
        target = Path(self.temp.name) / "external-data"
        target.mkdir()
        (target / "sentinel.bin").write_bytes(b"NOT A CORPUS FILE")
        junction = self.root / "arch" / "unexpected_junction"
        self._make_windows_junction(junction, target)
        try:
            with self.assertRaisesRegex(CorpusError, "E_R01_REPARSE"):
                verify(self.root)
        finally:
            # rmdir удаляет только сам junction, а не его целевой каталог.
            os.rmdir(junction)
        self.assertTrue((target / "sentinel.bin").exists())

    @unittest.skipUnless(os.name == "nt", "NTFS junction проверяется на Windows")
    def test_rejects_windows_junction_as_root(self):
        junction = Path(self.temp.name) / "junction-root"
        self._make_windows_junction(junction, self.root)
        try:
            with self.assertRaisesRegex(CorpusError, "E_R01_REPARSE"):
                verify(junction)
        finally:
            os.rmdir(junction)
        self.assertTrue((self.root / "manifest.json").exists())

    def _make_windows_junction(self, junction, target):
        # PowerShell New-Item -ItemType Junction устраняет неоднозначную
        # вложенную кавычку cmd.exe /c mklink в Python subprocess.
        # Неудача создания НА WINDOWS — FAIL, а не ложный SKIP: CI обязан
        # подтвердить, что обе проверки NTFS действительно исполнены.
        def ps_literal(path):
            return "'" + str(path).replace("'", "''") + "'"

        command = (
            "$ErrorActionPreference='Stop'; "
            "New-Item -ItemType Junction -Path " + ps_literal(junction) +
            " -Target " + ps_literal(target) + " | Out-Null"
        )
        attempt = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, text=True, check=False
        )
        self.assertEqual(
            attempt.returncode, 0,
            "Не удалось создать обязательный NTFS junction: " + attempt.stderr[:500]
        )

    def test_cli_gate_returns_nonzero_on_tamper(self):
        command = [sys.executable, str(ROOT / "scripts" / "verify_r01.py"), str(self.root)]
        first = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(first.returncode, 0, first.stderr)
        (self.root / "slab" / "sprite.pgm").write_bytes(b"not-a-fixture")
        second = subprocess.run(command, capture_output=True, text=True, check=False)
        self.assertEqual(second.returncode, 2)
        self.assertIn("Экспорт R01 запрещён", second.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)
