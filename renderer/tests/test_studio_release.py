"""Предметные origin/ZIP/rollback проверки; только синтетические пакеты и API fixtures."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.studio_pages import (
    ARCHITECTURE_PATH, ENGINE_PATH, ASSETS, MANIFEST, prepare_studio, read_engine_lock,
)
from scripts.studio_release import (
    ARCHIVE, BUNDLE, INDEX, REPOSITORY, REPOSITORY_ID, REQUIRED_JOBS, WORKFLOW,
    archive_bytes, check_ci_origin, check_current_main, check_release,
    prepare_ci, previous, read_archive, restore, retain, seal, unpack, verify_attestation,
)


def checksum(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.git("init", "--quiet", "--initial-branch=main")
        (self.repo / ARCHITECTURE_PATH).parent.mkdir(parents=True)
        (self.repo / ARCHITECTURE_PATH).write_text("1\n")
        (self.repo / ENGINE_PATH).write_text(json.dumps(read_engine_lock()))
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", "Synthetic Platform release")
        self.revision = self.git("rev-parse", "HEAD")
        self.bundle = self.root / "bundle"
        files = {name: b"synthetic" for name in ASSETS}
        files["index.html"] = '<code id="studio-version">Локальная сборка</code>'.encode()
        files["engine/fgmr-studio.wasm"] = bytes.fromhex("0061736d01000000")
        manifest = {"schema": "fgmp-studio-bundle/1",
                    "platform": {"revision": self.revision, "tree": self.git("rev-parse", "HEAD^{tree}")},
                    "engine": read_engine_lock(), "assets": {n: checksum(b) for n, b in files.items()}}
        files[MANIFEST] = json.dumps(manifest).encode()
        for name, data in files.items():
            path = self.bundle / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.site = self.root / "site"
        prepare_studio(self.bundle, self.site, self.revision, repo=self.repo)
        self.archive = self.root / ARCHIVE
        self.index = seal(self.site, self.archive, self.revision, repo=self.repo)
        self.data = self.archive.read_bytes()
        self.wrapper = archive_bytes({ARCHIVE: self.data})
        self.artifact_id, self.run_id, self.attempt = 71, 81, 2
        self.run = {"id": self.run_id, "run_attempt": self.attempt, "path": WORKFLOW,
                    "head_sha": self.revision, "head_branch": "main", "event": "push",
                    "status": "in_progress", "conclusion": None,
                    "repository": {"full_name": REPOSITORY, "id": REPOSITORY_ID}}
        self.artifact = {"id": self.artifact_id,
                         "name": f"platform-studio-{self.revision}-{self.attempt}",
                         "expired": False, "digest": "sha256:" + checksum(self.wrapper),
                         "size_in_bytes": len(self.wrapper),
                         "workflow_run": {"id": self.run_id, "head_sha": self.revision,
                                          "repository_id": REPOSITORY_ID, "head_repository_id": REPOSITORY_ID}}
        self.jobs = {"total_count": 6, "jobs": [
            {"name": n, "run_id": self.run_id, "head_sha": self.revision,
             "status": "completed", "conclusion": "success"} for n in sorted(REQUIRED_JOBS)]}
        self.output = self.root / "prepared" / "site"

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-C", str(self.repo), "-c", "user.name=Release Test",
             "-c", "user.email=release@example.invalid", "-c", "commit.gpgsign=false", *args],
            text=True, stderr=subprocess.PIPE).strip()

    def query(self, path):
        return copy.deepcopy({
            "": {"full_name": REPOSITORY, "id": REPOSITORY_ID},
            "branches/main": {"commit": {"sha": self.revision}},
            f"actions/artifacts/{self.artifact_id}": self.artifact,
            f"actions/runs/{self.run_id}": self.run,
            f"actions/runs/{self.run_id}/attempts/{self.attempt}/jobs?per_page=100": self.jobs,
        }[path])

    def test_verified_ci_origin_and_byte_preserving_package(self):
        result = prepare_ci(self.output, self.revision, self.artifact_id, self.run_id, self.attempt,
                            repo=self.repo, query=self.query, download=lambda _: self.wrapper)
        self.assertEqual(result["tree"], self.git("rev-parse", "HEAD^{tree}"))
        self.assertEqual((self.output.parent / ARCHIVE).read_bytes(), self.data)
        for name in ASSETS | {MANIFEST}:
            self.assertEqual((self.output / name).read_bytes(), (self.site / name).read_bytes())
        second = self.root / "second.zip"
        seal(self.site, second, self.revision, repo=self.repo)
        self.assertEqual(second.read_bytes(), self.data)

    def test_rejects_foreign_source_repository_even_with_valid_sha(self):
        self.run["repository"]["id"] += 1
        with self.assertRaisesRegex(ValueError, "REPOSITORY"):
            check_ci_origin(self.artifact, self.run, self.jobs, self.revision, self.run_id, self.attempt)

    def test_rejects_pr_failed_wrong_workflow_branch_sha_or_attempt(self):
        cases = {"event": "pull_request", "path": ".github/workflows/untrusted.yml",
                 "head_branch": "feature", "head_sha": "a" * 40, "run_attempt": 3,
                 "conclusion": "failure", "id": 999, "status": "queued"}
        for key, value in cases.items():
            with self.subTest(key=key):
                run = {**self.run, key: value}
                with self.assertRaisesRegex(ValueError, "RUN"):
                    check_ci_origin(self.artifact, run, self.jobs, self.revision, self.run_id, self.attempt)

    def test_rejects_expired_foreign_or_unpinned_artifact(self):
        cases = [
            {**self.artifact, "expired": True}, {**self.artifact, "name": "review-only"},
            {**self.artifact, "workflow_run": {**self.artifact["workflow_run"], "id": 99}},
            {**self.artifact, "workflow_run": {**self.artifact["workflow_run"], "head_repository_id": 1}},
            {**self.artifact, "workflow_run": {**self.artifact["workflow_run"], "head_sha": "e" * 40}},
            {**self.artifact, "digest": None}, {**self.artifact, "digest": "self-reported"},
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaisesRegex(ValueError, "ARTIFACT|PROVIDER_DIGEST"):
                    check_ci_origin(case, self.run, self.jobs, self.revision, self.run_id, self.attempt)

    def test_all_six_jobs_must_be_unique_complete_successful_and_same_source(self):
        for change in ("missing", "duplicate", "failed", "skipped", "wrong-sha", "wrong-run", "truncated"):
            jobs = copy.deepcopy(self.jobs)
            if change == "missing":
                jobs["jobs"].pop()
                jobs["total_count"] -= 1
            elif change == "duplicate":
                jobs["jobs"].append(jobs["jobs"][0].copy())
                jobs["total_count"] += 1
            elif change == "truncated":
                jobs["total_count"] = 200
            else:
                key, value = {"failed": ("conclusion", "failure"), "skipped": ("conclusion", "skipped"),
                              "wrong-sha": ("head_sha", "e" * 40), "wrong-run": ("run_id", 9)}[change]
                jobs["jobs"][0][key] = value
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "JOBS"):
                    check_ci_origin(self.artifact, self.run, jobs, self.revision, self.run_id, self.attempt)

    def test_changed_archive_cannot_be_admitted_by_self_reported_hash_index(self):
        files = read_archive(self.data, ASSETS | {MANIFEST, INDEX})
        files["studio-app.mjs"] = b"substituted"
        manifest = json.loads(files[MANIFEST])
        manifest["assets"]["studio-app.mjs"] = checksum(files["studio-app.mjs"])
        files[MANIFEST] = json.dumps(manifest).encode()
        index = json.loads(files[INDEX])
        index["hashes"] = {n: checksum(b) for n, b in files.items() if n != INDEX}
        files[INDEX] = json.dumps(index).encode()
        forged = archive_bytes({ARCHIVE: archive_bytes(files)})
        with self.assertRaisesRegex(ValueError, "PROVIDER_DIGEST"):
            prepare_ci(self.output, self.revision, self.artifact_id, self.run_id, self.attempt,
                       repo=self.repo, query=self.query, download=lambda _: forged)
        self.assertFalse(self.output.exists())

    def test_stale_main_is_rejected_before_downloading_or_writing(self):
        downloaded = []
        def query(path):
            return {"commit": {"sha": "e" * 40}} if path == "branches/main" else self.query(path)
        with self.assertRaisesRegex(ValueError, "STALE_MAIN"):
            prepare_ci(self.output, self.revision, self.artifact_id, self.run_id, self.attempt,
                       repo=self.repo, query=query, download=lambda _: downloaded.append(True))
        self.assertEqual(downloaded, [])
        self.assertFalse(self.output.exists())

    def test_archive_rejects_traversal_extra_members_and_duplicate_names(self):
        for name in ("../private.bin", "/absolute", "extra.bin"):
            files = read_archive(self.data, ASSETS | {MANIFEST, INDEX})
            files[name] = b"synthetic"
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "ARCHIVE_ALLOWLIST"):
                    unpack(archive_bytes(files), self.output, self.revision, repo=self.repo)
                self.assertFalse(self.output.exists())
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w") as z:
            z.writestr(ARCHIVE, self.data)
            with self.assertWarns(UserWarning):
                z.writestr(ARCHIVE, self.data)
        with self.assertRaisesRegex(ValueError, "ARCHIVE_ALLOWLIST"):
            read_archive(raw.getvalue(), {ARCHIVE})

    def test_archive_rejects_symlink_and_oversized_declared_members(self):
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, "w") as z:
            entry = zipfile.ZipInfo(ARCHIVE)
            entry.create_system = 3
            entry.external_attr = (stat.S_IFLNK | 0o777) << 16
            z.writestr(entry, "target")
        with self.assertRaisesRegex(ValueError, "ARCHIVE_TYPE"):
            read_archive(raw.getvalue(), {ARCHIVE})
        with self.assertRaisesRegex(ValueError, "ARCHIVE_SIZE"):
            read_archive(b"x" * (17 * 1024 * 1024), {ARCHIVE})

    def test_rejects_index_with_wrong_tree_or_missing_full_hashes(self):
        for change in ("tree", "no-hashes", "wrong-manifest-hash"):
            files = read_archive(self.data, ASSETS | {MANIFEST, INDEX})
            index = json.loads(files[INDEX])
            if change == "tree":
                index["platform"]["tree"] = "e" * 40
            elif change == "no-hashes":
                index["hashes"] = None
            else:
                index["hashes"][MANIFEST] = "e" * 64
            files[INDEX] = json.dumps(index).encode()
            with self.subTest(change=change):
                with self.assertRaisesRegex(ValueError, "SOURCE|INDEX|RELEASE_DIGEST"):
                    unpack(archive_bytes(files), self.output, self.revision, repo=self.repo)
                self.assertFalse(self.output.exists())

    def test_preview_package_cannot_be_promoted_to_release(self):
        preview = self.root / "preview"
        prepare_studio(self.bundle, preview, self.revision, repo=self.repo, preview_base=self.revision)
        file = self.root / "preview.zip"
        seal(preview, file, self.revision, repo=self.repo, preview_base=self.revision)
        with self.assertRaisesRegex(ValueError, "VERSION"):
            unpack(file.read_bytes(), self.output, self.revision, repo=self.repo)

    def test_signature_policy_is_enforced_and_signed_subject_must_match(self):
        bundle = self.root / BUNDLE
        bundle.write_text("{}")
        captured = []
        def verifier(args, **kwargs):
            captured.append(args)
            return subprocess.CompletedProcess(args, 0, json.dumps([
                {"verificationResult": {"statement": {"subject": [{"digest": {"sha256": checksum(self.data)}}]}}}
            ]).encode(), b"")
        verify_attestation(self.archive, bundle, self.revision, run=verifier)
        args = captured[0]
        for flag, expected in (("--repo", REPOSITORY), ("--signer-workflow", REPOSITORY + "/" + WORKFLOW),
                               ("--source-ref", "refs/heads/main"), ("--source-digest", self.revision),
                               ("--signer-digest", self.revision)):
            self.assertEqual(args[args.index(flag) + 1], expected)
        self.assertIn("--deny-self-hosted-runners", args)
        for code, output in ((1, b"signature rejected"), (0, b""), (0, b"[]"),
                             (0, b'[{"verificationResult":{"statement":{"subject":[]}}}]')):
            with self.subTest(code=code, output=output):
                with self.assertRaisesRegex(ValueError, "ATTESTATION"):
                    verify_attestation(self.archive, bundle, self.revision,
                                       run=lambda *a, **kw: subprocess.CompletedProcess(a, code, output, b""))

    def test_only_complete_stable_product_releases_are_previous_candidates(self):
        valid = {"tag_name": "studio-" + self.revision, "draft": False, "prerelease": False,
                 "assets": [{"name": ARCHIVE}, {"name": BUNDLE}]}
        query = lambda p: self.query("") if p == "" else valid
        self.assertEqual(previous(query), {"revision": self.revision})
        self.assertEqual(previous(lambda p: self.query("") if p == "" else None), {"revision": ""})
        for mutation in ({"draft": True}, {"prerelease": True}, {"assets": [{"name": ARCHIVE}]}):
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(ValueError, "RELEASE"):
                    check_release({**valid, **mutation}, self.revision)

    def test_restore_checks_signature_before_any_output(self):
        release = {"tag_name": "studio-" + self.revision, "draft": False, "prerelease": False,
                   "assets": [{"name": ARCHIVE, "digest": "sha256:" + checksum(self.data)},
                              {"name": BUNDLE, "digest": "sha256:" + checksum(b"unsigned")}]}
        def query(p):
            if p == "":
                return self.query("")
            if p.startswith("git/ref"):
                return {"object": {"type": "commit", "sha": self.revision}}
            return release
        def fetch(tag, directory):
            (directory / ARCHIVE).write_bytes(self.data)
            (directory / BUNDLE).write_bytes(b"unsigned")
        with patch("scripts.studio_release.verify_attestation", side_effect=ValueError("E_STUDIO_RELEASE_ATTESTATION")):
            with self.assertRaisesRegex(ValueError, "ATTESTATION"):
                restore(self.revision, self.output, repo=self.repo, query=query, fetch=fetch)
        self.assertFalse(self.output.exists())

    def test_restore_preserves_bytes_and_rejects_changed_tag_or_provider_digest(self):
        release = {"tag_name": "studio-" + self.revision, "draft": False, "prerelease": False,
                   "assets": [{"name": ARCHIVE, "digest": "sha256:" + checksum(self.data)},
                              {"name": BUNDLE, "digest": "sha256:" + checksum(b"signature-fixture")}]}
        tag = {"object": {"type": "commit", "sha": self.revision}}
        downloads = []
        def query(p):
            return self.query("") if p == "" else tag if p.startswith("git/ref") else release
        def fetch(name, directory):
            downloads.append(name)
            (directory / ARCHIVE).write_bytes(self.data)
            (directory / BUNDLE).write_bytes(b"signature-fixture")
        with patch("scripts.studio_release.verify_attestation") as verifier:
            result = restore(self.revision, self.output, repo=self.repo, query=query, fetch=fetch)
            verifier.assert_called_once()
        self.assertEqual(result["hashes"], self.index["hashes"])
        self.assertEqual((self.output.parent / ARCHIVE).read_bytes(), self.data)
        for name in ASSETS | {MANIFEST}:
            self.assertEqual((self.output / name).read_bytes(), (self.site / name).read_bytes())
        bad_output = self.root / "rejected" / "site"
        tag["object"]["sha"] = "e" * 40
        with self.assertRaisesRegex(ValueError, "RELEASE_TAG"):
            restore(self.revision, bad_output, repo=self.repo, query=query, fetch=fetch)
        self.assertEqual(len(downloads), 1)
        tag["object"]["sha"] = self.revision
        release["assets"][0]["digest"] = "sha256:" + "e" * 64
        with patch("scripts.studio_release.verify_attestation") as verifier:
            with self.assertRaisesRegex(ValueError, "RELEASE_DIGEST"):
                restore(self.revision, bad_output, repo=self.repo, query=query, fetch=fetch)
            verifier.assert_not_called()
        self.assertFalse(bad_output.exists())

    def test_retain_cannot_promote_existing_release_with_retargeted_tag(self):
        bundle = self.root / BUNDLE
        bundle.write_text("signature-fixture")
        existing = {"tag_name": "studio-" + self.revision, "draft": False, "prerelease": False}
        def query(p):
            if p == "":
                return self.query("")
            if p.startswith("git/ref"):
                return {"object": {"type": "commit", "sha": "e" * 40}}
            return [existing]
        with patch("scripts.studio_release.api", side_effect=query), \
                patch("scripts.studio_release.verify_attestation"), \
                patch("scripts.studio_release.gh") as command:
            with self.assertRaisesRegex(ValueError, "RELEASE_TAG"):
                retain(self.archive, bundle, self.revision, repo=self.repo)
            command.assert_not_called()


if os.environ.get("STUDIO_REAL_GH_VERIFY") == "1":
    class RealVerifierTests(unittest.TestCase):
        def test_real_pinned_gh_rejects_unsigned_release(self):
            help_result = subprocess.run(["gh", "attestation", "verify", "--help"], capture_output=True, text=True)
            self.assertEqual(help_result.returncode, 0, help_result.stderr)
            self.assertIn("--source-digest", help_result.stdout)
            with tempfile.TemporaryDirectory() as directory:
                archive, bundle = Path(directory) / ARCHIVE, Path(directory) / BUNDLE
                archive.write_bytes(archive_bytes({"synthetic.txt": b"synthetic"}))
                bundle.write_text("{}")
                result = subprocess.run(["gh", "attestation", "verify", str(archive), "--bundle", str(bundle),
                                         "--repo", REPOSITORY, "--signer-workflow", REPOSITORY + "/" + WORKFLOW,
                                         "--source-ref", "refs/heads/main", "--source-digest", "e" * 40,
                                         "--deny-self-hosted-runners"], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertRegex(result.stderr.lower(), "bundle|unmarshal|media.?type|parse|invalid json")
                print("REAL_GH_UNSIGNED_RELEASE_REJECTED")
