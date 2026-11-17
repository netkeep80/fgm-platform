"""Проверка неизменяемого снимка gh-pages перед выпуском через GitHub Actions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys

from scripts.promote_v03_s3 import ASSETS, digest

PAGES_SHA = "29d9ed509c5ef50e3a92b8bb72db10eb7903069f"
PAGES_TREE = "5cfaed61445bd4cd460d974cbcea7aea7ad07c75"
PAGES_COUNT = len(ASSETS) + 1


def require(ok: bool, reason: str) -> None:
    if not ok:
        raise ValueError(f"E_PAGES_DEPLOY_{reason}")


def git(directory: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(directory), *args], text=True, stderr=subprocess.PIPE
    ).strip()


def verify(site: Path, expected_sha: str = PAGES_SHA,
           expected_tree: str = PAGES_TREE) -> dict:
    require(site.is_dir() and not site.is_symlink(), "SITE_DIR")
    require(git(site, "rev-parse", "HEAD") == expected_sha, "HEAD")
    require(git(site, "rev-parse", "HEAD^{tree}") == expected_tree, "TREE")
    require(not git(site, "status", "--porcelain=v1", "--untracked-files=all"), "DIRTY")

    # Both Git and the filesystem must contain only the approved regular files.
    entries = git(site, "ls-tree", "-r", "--full-tree", "HEAD").splitlines()
    names: set[str] = set()
    for row in entries:
        metadata, separator, name = row.partition("\t")
        require(separator == "\t", "TREE_FORMAT")
        mode, kind, _ = metadata.split()
        require(mode == "100644" and kind == "blob", "TREE_MODE")
        require(name not in names, "TREE_DUPLICATE")
        names.add(name)
    expected_names = set(ASSETS) | {".nojekyll"}
    require(len(names) == PAGES_COUNT and names == expected_names, "TREE_ALLOWLIST")

    disk_names = {p.name for p in site.iterdir() if p.name != ".git"}
    require(disk_names == expected_names, "DISK_ALLOWLIST")
    for name, expected_digest in ASSETS.items():
        item = site / name
        require(item.is_file() and not item.is_symlink(), "DISK_TYPE")
        require(digest(item.read_bytes()) == expected_digest, "FILE_DIGEST")
    nojekyll = site / ".nojekyll"
    require(nojekyll.is_file() and not nojekyll.is_symlink() and nojekyll.read_bytes() == b"", "NOJEKYLL")

    return {"ok": True, "source": expected_sha, "tree": expected_tree,
            "assets": len(ASSETS), "files": len(names)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.site), sort_keys=True))
    except (OSError, ValueError, subprocess.CalledProcessError) as e:
        print(f"PAGES_DEPLOY_REJECTED: {e}", file=sys.stderr)
        raise SystemExit(2) from e


if __name__ == "__main__":
    main()
