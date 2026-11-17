"""Негативная проверка fail-closed публикации без игровых ресурсов."""

from io import BytesIO
import json
from pathlib import Path
import stat
import tempfile
import unittest
from zipfile import ZipFile, ZipInfo

from scripts.promote_v03_s3 import (
    ASSETS, ARTIFACT_ID, ARCHIVE_SHA256, SOURCE_SHA, WORKFLOW_RUN,
    check_receipts, check_zip, digest, promote,
)


def archive(files: dict[str, bytes], symlink: str | None = None) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as z:
        for path, content in files.items():
            if path == symlink:
                info = ZipInfo(path)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, content)
            else:
                z.writestr(path, content)
    return output.getvalue()


class PagesReleaseTests(unittest.TestCase):
    def setUp(self):
        self.files = {f"web/{name}": name.encode() for name in ASSETS}
        self.files.update({name: b"fixture" for name in (
            "native/sphere.ppm", "browser.png", "camera.png",
            "v02/report.json", "v02/hits.csv", "v02/mutations.json",
            "v02/c05-semantic.json", "v03/report.json", "v03-map/report.json",
        )})
        self.hashes = {name: digest(name.encode()) for name in ASSETS}
        self.data = archive(self.files)

    def check(self, data: bytes, files=None):
        return check_zip(data, digest(data), self.hashes) if files is None else check_zip(data, digest(data), files)

    def test_explicit_allowlist_and_exact_bytes(self):
        self.assertEqual(self.check(self.data), {name: name.encode() for name in ASSETS})

    def test_fails_on_missing_or_added_web_asset(self):
        for changes in (
            {k: v for k, v in self.files.items() if k != "web/camera.js"},
            {**self.files, "web/secret.dat": b"private"},
            {**self.files, "web/../other.txt": b"bad"},
        ):
            with self.subTest(changes=len(changes)), self.assertRaisesRegex(ValueError, "E_PAGES_ALLOWLIST"):
                self.check(archive(changes))

    def test_fails_on_modified_asset_even_with_rehashed_zip(self):
        modified = archive({**self.files, "web/camera.js": b"changed"})
        with self.assertRaisesRegex(ValueError, "E_PAGES_ASSET_DIGEST"):
            self.check(modified)

    def test_fails_on_wrong_zip_digest(self):
        with self.assertRaisesRegex(ValueError, "E_PAGES_ARCHIVE_DIGEST"):
            check_zip(self.data, "0" * 64, self.hashes)

    def test_fails_on_symlink(self):
        symlink = archive(self.files, symlink="web/index.html")
        with self.assertRaisesRegex(ValueError, "E_PAGES_SYMLINK"):
            self.check(symlink)

    def test_fails_on_invalid_receipts(self):
        run = {"id": WORKFLOW_RUN, "head_sha": SOURCE_SHA, "status": "completed", "conclusion": "success", "event": "pull_request"}
        artifact = {"id": ARTIFACT_ID, "name": "fgm-boot", "expired": False, "digest": "sha256:" + ARCHIVE_SHA256,
                    "workflow_run": {"id": WORKFLOW_RUN, "head_sha": SOURCE_SHA}}
        check_receipts(run, artifact)
        for bad in ({**run, "conclusion": "failure"}, {**run, "head_sha": "0" * 40}):
            with self.assertRaisesRegex(ValueError, "E_PAGES_RUN"):
                check_receipts(bad, artifact)
        for bad in ({**artifact, "expired": True}, {**artifact, "digest": "sha256:" + "0" * 64}):
            with self.assertRaisesRegex(ValueError, "E_PAGES_(EXPIRED|ARTIFACT_DIGEST)"):
                check_receipts(run, bad)

    def test_no_partial_files_on_receipt_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            temp = Path(temp)
            (temp / "bad.zip").write_bytes(self.data)
            (temp / "run.json").write_text(json.dumps({"id": WORKFLOW_RUN, "conclusion": "failure"}))
            (temp / "artifact.json").write_text("{}")
            with self.assertRaises(ValueError):
                promote(temp / "bad.zip", temp / "run.json", temp / "artifact.json", temp / "output")
            self.assertFalse((temp / "output").exists())


if __name__ == "__main__":
    unittest.main()
