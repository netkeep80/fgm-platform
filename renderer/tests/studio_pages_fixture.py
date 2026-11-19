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


class StudioPagesFixture(unittest.TestCase):
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
