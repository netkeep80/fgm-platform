"""Проверка состава и версии пакета Studio для Pages."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from scripts.studio_pages import (
    ARCHITECTURE_PATH, ENGINE_PATH, MANIFEST, PLATFORM, ASSETS, calculate_studio_version,
    digest, git, prepare_rollback, prepare_studio, read_engine_lock, verify_site, version_badge,
)

from studio_pages_fixture import StudioPagesFixture, VERSION, FALLBACK


class PagesSnapshotTests(StudioPagesFixture):
    def test_site_and_rollback_preserve_all_previously_verified_bytes(self):
        self.prepare_site()
        self.assertEqual(verify_site(self.out, self.revision, repo=self.repo, expected_hashes=self.hashes), self.hashes)
        restored = self.root / "restored"
        self.assertEqual(prepare_rollback(self.out, restored, self.revision, self.hashes, repo=self.repo), self.hashes)
        self.assertEqual(verify_site(restored, self.revision, repo=self.repo, expected_hashes=self.hashes), self.hashes)
        for name in self.hashes:
            self.assertEqual((self.out / name).read_bytes(), (restored / name).read_bytes())


    def test_rollback_uses_target_revision_even_when_current_head_has_advanced(self):
        self.prepare_site()
        (self.repo / ARCHITECTURE_PATH).write_text("2\n")
        self.commit("Later architecture")
        restored = self.root / "restored"
        self.assertEqual(prepare_rollback(self.out, restored, self.revision, self.hashes, repo=self.repo), self.hashes)


    def test_ready_site_rejects_wrong_tree_even_with_new_trusted_hashes(self):
        self.prepare_site()
        self.rewrite_site(lambda m: m["platform"].update(tree="e" * 40))
        hashes = {name: digest((self.out / name).read_bytes()) for name in self.hashes}
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_SOURCE_TREE"):
            verify_site(self.out, self.revision, repo=self.repo, expected_hashes=hashes)


    def test_ready_site_rejects_foreign_revision(self):
        self.prepare_site()
        revision = self.commit("Another commit")
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_SOURCE_TREE"):
            verify_site(self.out, revision, repo=self.repo)


    def test_ready_site_rejects_wrong_version_and_rehashed_badge(self):
        self.prepare_site()
        (self.out / "index.html").write_text("incorrect badge")
        self.rewrite_site(lambda m: None, rehash_asset=True)
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_VERSION_BADGE"):
            verify_site(self.out, self.revision, repo=self.repo)


    def test_ready_site_rejects_wrong_version(self):
        self.prepare_site()
        self.rewrite_site(lambda m: m.update(version="9.999"))
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_VERSION"):
            verify_site(self.out, self.revision, repo=self.repo)


    def test_rollback_rejects_changed_and_rehashed_asset_against_independent_hashes(self):
        self.prepare_site()
        (self.out / "studio-app.mjs").write_bytes(b"changed")
        self.rewrite_site(lambda m: None, rehash_asset=True)
        restored = self.root / "restored"
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_RELEASE_DIGEST"):
            prepare_rollback(self.out, restored, self.revision, self.hashes, repo=self.repo)
        self.assertFalse(restored.exists())


    def test_rollback_requires_complete_independent_hashes(self):
        self.prepare_site()
        for hashes in (None, {}, {**self.hashes, MANIFEST: "bad"}, {k: v for k, v in self.hashes.items() if k != MANIFEST}):
            with self.subTest(hashes=hashes):
                with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_EXPECTED_HASHES"):
                    prepare_rollback(self.out, self.root / "restored", self.revision, hashes, repo=self.repo)
                self.assertFalse((self.root / "restored").exists())


    def test_preview_site_cannot_masquerade_as_release_rollback(self):
        self.prepare_site(preview_base=self.revision)
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_VERSION"):
            prepare_rollback(self.out, self.root / "restored", self.revision, self.hashes, repo=self.repo)


    def test_ready_site_rejects_private_or_unexpected_files(self):
        self.prepare_site()
        (self.out / "private.bin").write_bytes(b"synthetic")
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_ALLOWLIST"):
            verify_site(self.out, self.revision, repo=self.repo)


    def test_rollback_rejects_existing_destination_without_changing_it(self):
        self.prepare_site()
        destination = self.root / "restored"
        destination.mkdir()
        (destination / "keep").write_text("untouched")
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_OUTPUT"):
            prepare_rollback(self.out, destination, self.revision, self.hashes, repo=self.repo)
        self.assertEqual((destination / "keep").read_text(), "untouched")


    def test_cli_studio_verify_and_rollback_share_the_checked_identity(self):
        revision = git(PLATFORM, "rev-parse", "HEAD")
        self.manifest["platform"] = {"revision": revision, "tree": git(PLATFORM, "rev-parse", "HEAD^{tree}")}
        self.write_bundle()
        hashes_file = self.root / "hashes.json"
        restored = self.root / "restored"

        def run(*args):
            return subprocess.run([sys.executable, "-m", "scripts.studio_pages", *map(str, args)],
                                  cwd=PLATFORM / "renderer", capture_output=True, text=True)

        built = run("studio", self.bundle, self.out, "--revision", revision)
        self.assertEqual(built.returncode, 0, built.stderr)
        hashes = json.loads(built.stdout)
        hashes_file.write_text(built.stdout)
        for mode, paths in (("verify", [self.out]), ("rollback", [self.out, restored])):
            result = run(mode, *paths, "--revision", revision, "--hashes", hashes_file)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), hashes)
        self.manifest["platform"]["tree"] = "e" * 40
        self.write_bundle()
        rejected_output = self.root / "rejected"
        rejected = run("studio", self.bundle, rejected_output, "--revision", revision)
        self.assertEqual(rejected.returncode, 2)
        self.assertIn("E_STUDIO_PAGES_SOURCE_TREE", rejected.stderr)
        self.assertFalse(rejected_output.exists())


if __name__ == "__main__":
    unittest.main()
