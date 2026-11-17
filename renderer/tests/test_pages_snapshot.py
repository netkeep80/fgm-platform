"""Негативные тесты проверенного дерева Pages без доступа к сети."""

from pathlib import Path
import subprocess
import tempfile
import unittest

from scripts.promote_v03_s3 import ASSETS
from scripts.verify_pages_snapshot import git, verify


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.site = Path(self.temp.name) / "site"
        self.site.mkdir()
        for name, content in {**{k: k.encode() for k in ASSETS}, ".nojekyll": b""}.items():
            (self.site / name).write_bytes(content)
        self.hashes = dict(ASSETS)
        for name in ASSETS:
            ASSETS[name] = __import__("hashlib").sha256(name.encode()).hexdigest()
        self.addCleanup(lambda: ASSETS.update(self.hashes))
        subprocess.run(["git", "-C", str(self.site), "init", "-q"], check=True)
        subprocess.run(["git", "-C", str(self.site), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.site), "-c", "user.email=ci@example.invalid",
                        "-c", "user.name=CI", "commit", "-qm", "synthetic test fixture"], check=True)
        self.sha = git(self.site, "rev-parse", "HEAD")
        self.tree = git(self.site, "rev-parse", "HEAD^{tree}")

    def check(self):
        return verify(self.site, self.sha, self.tree)

    def test_exact_fixture(self):
        result = self.check()
        self.assertEqual(result["files"], len(ASSETS) + 1)

    def test_wrong_head(self):
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_HEAD"):
            verify(self.site, "0" * 40, self.tree)

    def test_wrong_tree(self):
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_TREE"):
            verify(self.site, self.sha, "0" * 40)

    def test_modified_payload(self):
        (self.site / "camera.js").write_text("altered")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_DIRTY"):
            self.check()

    def test_untracked_secret(self):
        (self.site / "private.bin").write_bytes(b"no")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_DIRTY"):
            self.check()

    def test_missing_payload(self):
        (self.site / "camera.wgsl").unlink()
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_DIRTY"):
            self.check()

    def test_tracked_symlink_tree(self):
        (self.site / "camera.html").unlink()
        (self.site / "camera.html").symlink_to("index.html")
        subprocess.run(["git", "-C", str(self.site), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.site), "-c", "user.email=ci@example.invalid",
                        "-c", "user.name=CI", "commit", "-qm", "symlink test"], check=True)
        self.sha = git(self.site, "rev-parse", "HEAD")
        self.tree = git(self.site, "rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_TREE_MODE"):
            self.check()

    def test_committed_foreign_file(self):
        (self.site / "private.bin").write_bytes(b"no")
        subprocess.run(["git", "-C", str(self.site), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.site), "-c", "user.email=ci@example.invalid",
                        "-c", "user.name=CI", "commit", "-qm", "extra test"], check=True)
        self.sha = git(self.site, "rev-parse", "HEAD")
        self.tree = git(self.site, "rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_TREE_ALLOWLIST"):
            self.check()

    def test_committed_modified_payload(self):
        (self.site / "camera.js").write_text("altered")
        subprocess.run(["git", "-C", str(self.site), "add", "-A"], check=True)
        subprocess.run(["git", "-C", str(self.site), "-c", "user.email=ci@example.invalid",
                        "-c", "user.name=CI", "commit", "-qm", "modified asset"], check=True)
        self.sha = git(self.site, "rev-parse", "HEAD")
        self.tree = git(self.site, "rev-parse", "HEAD^{tree}")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_FILE_DIGEST"):
            self.check()

    def test_dirty_nojekyll(self):
        (self.site / ".nojekyll").write_bytes(b"injected")
        with self.assertRaisesRegex(ValueError, "E_PAGES_DEPLOY_DIRTY"):
            self.check()


if __name__ == "__main__":
    unittest.main()
