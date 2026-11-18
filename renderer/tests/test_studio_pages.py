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

VERSION = "1.0"
FALLBACK = '<code id="studio-version">Локальная сборка</code>'.encode()


class StudioPagesTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bundle = self.root / "bundle"
        self.out = self.root / "site"
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "--quiet", "--initial-branch=main")
        (self.repo / ARCHITECTURE_PATH).parent.mkdir(parents=True)
        (self.repo / ARCHITECTURE_PATH).write_text("1\n")
        (self.repo / ENGINE_PATH).write_text(json.dumps(read_engine_lock()))
        self.revision = self.commit("Synthetic Platform release")
        self.tree = self.git("rev-parse", "HEAD^{tree}")
        self.assets = {name: b"synthetic" for name in ASSETS}
        self.assets["index.html"] = b"<header>" + FALLBACK + b"</header>"
        self.assets["engine/fgmr-studio.wasm"] = bytes.fromhex("0061736d01000000")
        self.engine = read_engine_lock()
        self.manifest = {
            "schema": "fgmp-studio-bundle/1",
            "platform": {"revision": self.revision, "tree": self.tree},
            "engine": self.engine.copy(),
            "assets": {name: digest(data) for name, data in self.assets.items()},
        }

    def write_bundle(self):
        for name, data in self.assets.items():
            path = self.bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (self.bundle / "studio-manifest.json").write_text(json.dumps(self.manifest))

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.repo), "-c", "user.name=Studio Test",
             "-c", "user.email=studio@example.invalid", "-c", "commit.gpgsign=false", *args],
            text=True, stderr=subprocess.PIPE,
        ).strip()

    def commit(self, title):
        self.git("add", "-A")
        self.git("commit", "--quiet", "--allow-empty", "-m", title)
        return self.git("rev-parse", "HEAD")

    def reject(self, reason, revision=None, version=VERSION):
        with self.assertRaisesRegex(ValueError, f"E_STUDIO_PAGES_{reason}"):
            prepare_studio(self.bundle, self.out, revision or self.revision, version, repo=self.repo)
        self.assertFalse(self.out.exists())

    def test_verified_build_produces_reproducible_versioned_site(self):
        self.write_bundle()
        first = prepare_studio(self.bundle, self.out, self.revision, VERSION, repo=self.repo)
        second = prepare_studio(self.bundle, self.root / "another-site", self.revision, VERSION, repo=self.repo)
        self.assertEqual(first, second)
        self.assertEqual(set(first), set(ASSETS) | {"studio-manifest.json"})
        self.assertEqual((self.out / "ufo-catalog.mjs").read_bytes(), b"synthetic")
        for name, checksum in first.items():
            self.assertEqual(digest((self.out / name).read_bytes()), checksum)
        manifest = json.loads((self.out / "studio-manifest.json").read_bytes())
        self.assertEqual(manifest["schema"], "fgmp-studio-pages/1")
        self.assertEqual(manifest["platform"], {"revision": self.revision, "tree": self.tree})
        self.assertEqual(manifest["version"], VERSION)
        self.assertEqual(manifest["engine"], self.engine)
        self.assertEqual(manifest["assets"], {name: first[name] for name in ASSETS})
        self.assertIn(version_badge(self.revision, self.tree, VERSION),
                      (self.out / "index.html").read_bytes())

    def test_new_merge_updates_visible_version_even_with_same_assets(self):
        self.write_bundle()
        first = prepare_studio(self.bundle, self.out, self.revision, VERSION, repo=self.repo)
        self.git("switch", "--quiet", "-c", "feature")
        self.commit("Compatible feature")
        self.git("switch", "--quiet", "main")
        self.git("merge", "--quiet", "--no-ff", "--no-edit", "feature")
        another_revision = self.git("rev-parse", "HEAD")
        self.manifest["platform"]["revision"] = another_revision
        self.write_bundle()
        second = prepare_studio(self.bundle, self.root / "updated-site", another_revision, "1.1", repo=self.repo)
        changed = {name for name in first if first[name] != second[name]}
        self.assertEqual(changed, {"index.html", "studio-manifest.json"})
        self.assertIn("Версия 1.1", (self.root / "updated-site/index.html").read_text())

    def test_rejects_invalid_revision(self):
        self.write_bundle()
        self.reject("REVISION", "<invalid>")

    def test_rejects_invalid_version(self):
        self.write_bundle()
        for version in ("", "01.17", "1.017", "0.1", "<invalid>"):
            with self.subTest(version=version):
                self.reject("VERSION", version=version)

    def test_rejects_bundle_from_another_revision(self):
        self.write_bundle()
        another_revision = self.commit("Other source commit")
        self.reject("SOURCE_TREE", another_revision)

    def test_rejects_missing_catalog_module(self):
        self.assets.pop("ufo-catalog.mjs")
        self.manifest["assets"].pop("ufo-catalog.mjs")
        self.write_bundle()
        self.reject("ALLOWLIST")

    def test_rejects_previous_manifest_schema(self):
        self.manifest["schema"] = "fgmv-studio-ufo-catalog/1"
        self.write_bundle()
        self.reject("MANIFEST")

    def test_rejects_unexpected_file(self):
        self.write_bundle()
        (self.bundle / "private.bin").write_bytes(b"synthetic")
        self.reject("ALLOWLIST")

    def test_rejects_file_changed_against_manifest(self):
        self.assets["studio-app.mjs"] = b"changed"
        self.write_bundle()
        self.reject("ASSET_DIGEST")

    def test_rejects_manifest_with_legacy_source_pin(self):
        self.manifest["regenerator"] = "6a9ba7d30518fb8c3a75a2f4b2bc5ae3b83c376f"
        self.write_bundle()
        self.reject("MANIFEST")

    def test_rejects_manifest_with_missing_or_changed_engine_contract(self):
        cases = (None, {**self.engine, "core": "0" * 40}, {**self.engine, "workerProtocol": 2},
                 {**self.engine, "workerProtocol": True}, {**self.engine, "workerProtocol": 1.0},
                 {**self.engine, "wholeBuild": "r06-whole-build/2"})
        for index, engine in enumerate(cases):
            with self.subTest(engine=engine):
                self.out = self.root / f"site-{index}"
                self.manifest.pop("engine", None)
                if engine is not None:
                    self.manifest["engine"] = engine
                self.write_bundle()
                self.reject("MANIFEST")

    def test_rejects_symlink_disguised_as_asset(self):
        self.write_bundle()
        file = self.bundle / "studio-app.mjs"
        file.unlink()
        try:
            file.symlink_to("ufo-catalog.mjs")
        except OSError as error:
            self.skipTest(f"OS does not permit unprivileged symlinks: {error}")
        self.reject("TYPE")

    def test_rejects_incomplete_wasm(self):
        name = "engine/fgmr-studio.wasm"
        self.assets[name] = b"invalid"
        self.manifest["assets"][name] = digest(b"invalid")
        self.write_bundle()
        self.reject("WASM")

    def test_rejects_well_formed_wrong_tree(self):
        self.manifest["platform"]["tree"] = "f" * 40
        self.write_bundle()
        self.reject("SOURCE_TREE")

    def test_rejects_rehashed_bundle_with_wrong_tree(self):
        self.manifest["platform"]["tree"] = "e" * 40
        self.assets["studio-app.mjs"] = b"changed and correctly rehashed"
        self.manifest["assets"] = {name: digest(data) for name, data in self.assets.items()}
        self.write_bundle()
        self.reject("SOURCE_TREE")

    def test_rejects_unknown_or_extra_platform_identity(self):
        self.manifest["platform"]["source"] = "legacy"
        self.write_bundle()
        self.reject("SOURCE_TREE")

    def test_reads_target_commit_engine_instead_of_mutable_worktree(self):
        (self.repo / ENGINE_PATH).write_text("{}")
        self.write_bundle()
        prepare_studio(self.bundle, self.out, self.revision, repo=self.repo)
        self.assertEqual(verify_site(self.out, self.revision, repo=self.repo)[MANIFEST],
                         digest((self.out / MANIFEST).read_bytes()))

    def test_rejects_output_inside_input_without_changing_input(self):
        self.write_bundle()
        before = (self.bundle / MANIFEST).read_bytes()
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_OUTPUT"):
            prepare_studio(self.bundle, self.bundle / "output", self.revision, repo=self.repo)
        self.assertEqual((self.bundle / MANIFEST).read_bytes(), before)
        self.assertFalse((self.bundle / "output").exists())

    def prepare_site(self, **kwargs):
        self.write_bundle()
        self.hashes = prepare_studio(self.bundle, self.out, self.revision, repo=self.repo, **kwargs)
        return self.hashes

    def rewrite_site(self, change, rehash_asset=False):
        manifest = json.loads((self.out / MANIFEST).read_bytes())
        change(manifest)
        if rehash_asset:
            manifest["assets"] = {name: digest((self.out / name).read_bytes()) for name in ASSETS}
        (self.out / MANIFEST).write_text(json.dumps(manifest))

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


class StudioVersionHistoryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        self.git("init", "--quiet", "--initial-branch=main")
        self.architecture = self.repo / ARCHITECTURE_PATH
        self.architecture.parent.mkdir(parents=True)
        self.architecture.write_text("1\n")
        self.root = self.commit("Initial architecture")

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.repo), "-c", "user.name=Studio Test",
             "-c", "user.email=studio@example.invalid", "-c", "commit.gpgsign=false", *args],
            text=True,
        ).strip()

    def commit(self, title):
        self.git("add", "-A")
        self.git("commit", "--quiet", "--allow-empty", "-m", title)
        return self.git("rev-parse", "HEAD")

    def test_counts_main_merges_and_reads_architecture_from_exact_commit(self):
        self.assertEqual(calculate_studio_version(self.repo, self.root), "1.0")
        self.git("switch", "--quiet", "-c", "feature")
        self.commit("Feature work")
        self.git("switch", "--quiet", "-c", "nested")
        self.commit("Nested work")
        self.git("switch", "--quiet", "feature")
        self.git("merge", "--quiet", "--no-ff", "--no-edit", "nested")
        feature = self.git("rev-parse", "HEAD")
        self.assertEqual(calculate_studio_version(self.repo, feature, self.root), "1.1")
        self.git("switch", "--quiet", "main")
        self.git("merge", "--quiet", "--no-ff", "--no-edit", "feature")
        self.assertEqual(calculate_studio_version(self.repo, self.git("rev-parse", "HEAD")), "1.1")
        direct = self.commit("Direct change on main")
        self.assertEqual(calculate_studio_version(self.repo, direct), "1.1")
        self.git("switch", "--quiet", "-c", "architecture")
        self.architecture.write_text("2\n")
        architecture = self.commit("Incompatible architecture")
        self.assertEqual(calculate_studio_version(self.repo, architecture, direct), "2.2")
        self.git("switch", "--quiet", "main")
        self.git("merge", "--quiet", "--no-ff", "--no-edit", "architecture")
        self.assertEqual(calculate_studio_version(self.repo, self.git("rev-parse", "HEAD")), "2.2")
        self.assertEqual(calculate_studio_version(self.repo, direct), "1.1")

    def test_rejects_invalid_architecture_and_preview_base(self):
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_PREVIEW_BASE"):
            calculate_studio_version(self.repo, self.root, "main")
        self.architecture.write_text("01\n")
        with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_ARCHITECTURE"):
            calculate_studio_version(self.repo, self.commit("Invalid version"))

    def test_rejects_shallow_history(self):
        with tempfile.TemporaryDirectory() as directory:
            self.git("clone", "--quiet", "--depth=1", self.repo.as_uri(), directory)
            with self.assertRaisesRegex(ValueError, "E_STUDIO_PAGES_SHALLOW_HISTORY"):
                calculate_studio_version(Path(directory), self.root)
