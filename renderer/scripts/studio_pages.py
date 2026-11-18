"""Подготовка, проверка и побайтовый откат текущего пакета Platform Studio."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

ASSETS = {
    "index.html", "studio-app.mjs", "whole-ui.mjs", "r05-view.mjs", "synthetic.mjs", "ufo-catalog.mjs",
    "engine/worker.mjs", "engine/fgmr-studio.mjs", "engine/fgmr-studio.wasm",
}
MANIFEST = "studio-manifest.json"
VERSION_PLACEHOLDER = '<code id="studio-version">Локальная сборка</code>'.encode()
SIZE_LIMIT = 16 * 1024 * 1024
REPOSITORY = Path(__file__).resolve().parents[1]
PLATFORM = REPOSITORY.parent
ARCHITECTURE_PATH = "renderer/studio/architecture-version.txt"
ENGINE_PATH = "renderer/studio/engine-lock.json"
REVISION = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"[1-9][0-9]*\.(0|[1-9][0-9]*)")
DIGEST = re.compile(r"[0-9a-f]{64}")


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(f"E_STUDIO_PAGES_{reason}")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(repo: Path, *args: str) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(repo), *args], text=True,
                                       stderr=subprocess.PIPE).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise ValueError("E_STUDIO_PAGES_GIT") from error


def read_engine_lock(repo: Path = PLATFORM, revision: str | None = None) -> dict:
    raw = (repo / ENGINE_PATH).read_text(encoding="utf-8") if revision is None else git(
        repo, "show", f"{revision}:{ENGINE_PATH}")
    engine = json.loads(raw)
    require(isinstance(engine, dict)
            and set(engine) == {"schema", "core", "workerProtocol", "wholeBuild"}
            and engine.get("schema") == "fgmp-studio-engine/1"
            and isinstance(engine.get("core"), str) and REVISION.fullmatch(engine["core"])
            and type(engine.get("workerProtocol")) is int and engine["workerProtocol"] == 1
            and engine.get("wholeBuild") == "r06-whole-build/1", "ENGINE_LOCK")
    return engine


def calculate_studio_version(repo: Path, revision: str, preview_base: str | None = None) -> str:
    require(isinstance(revision, str) and REVISION.fullmatch(revision) is not None, "REVISION")
    require(preview_base is None or REVISION.fullmatch(preview_base) is not None, "PREVIEW_BASE")
    require(git(repo, "rev-parse", "--is-shallow-repository") == "false", "SHALLOW_HISTORY")
    require(git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}") == revision, "REVISION")
    architecture = git(repo, "show", f"{revision}:{ARCHITECTURE_PATH}")
    require(re.fullmatch(r"[1-9][0-9]*", architecture) is not None, "ARCHITECTURE")
    if preview_base is not None:
        git(repo, "merge-base", "--is-ancestor", preview_base, revision)
    history = revision if preview_base is None else preview_base
    merges = int(git(repo, "rev-list", "--first-parent", "--merges", "--count", history))
    return f"{architecture}.{merges + (preview_base is not None)}"


def identity(repo: Path, revision: str) -> dict[str, str]:
    require(isinstance(revision, str) and REVISION.fullmatch(revision) is not None, "REVISION")
    require(git(repo, "rev-parse", "--verify", f"{revision}^{{commit}}") == revision, "REVISION")
    return {"revision": revision, "tree": git(repo, "rev-parse", f"{revision}^{{tree}}")}


def package(source: Path) -> tuple[dict, dict[str, bytes]]:
    require(source.is_dir() and not source.is_symlink(), "BUNDLE")
    entries = {p.relative_to(source).as_posix(): p for p in source.rglob("*")
               if p.is_symlink() or not p.is_dir()}
    require(set(entries) == ASSETS | {MANIFEST}, "ALLOWLIST")
    require(all(p.is_file() and not p.is_symlink() for p in entries.values()), "TYPE")
    sizes = [p.stat().st_size for p in entries.values()]
    require(all(sizes) and sum(sizes) <= SIZE_LIMIT, "SIZE")
    files = {name: p.read_bytes() for name, p in entries.items()}
    manifest = json.loads(files[MANIFEST])
    require(isinstance(manifest, dict), "MANIFEST")
    return manifest, files


def validate(manifest: dict, files: dict[str, bytes], schema: str, repo: Path, revision: str) -> None:
    keys = {"schema", "platform", "engine", "assets"} | ({"version"} if schema.endswith("pages/1") else set())
    require(set(manifest) == keys and manifest.get("schema") == schema, "MANIFEST")
    # Derive this from immutable Git independently at every admission boundary.
    require(manifest.get("platform") == identity(repo, revision), "SOURCE_TREE")
    require(manifest.get("engine") == read_engine_lock(repo, revision)
            and type(manifest.get("engine", {}).get("workerProtocol")) is int, "MANIFEST")
    require(manifest.get("assets") == {name: digest(files[name]) for name in ASSETS}, "ASSET_DIGEST")
    require(files["engine/fgmr-studio.wasm"].startswith(b"\x00asm\x01\x00\x00\x00"), "WASM")


def version_badge(revision: str, tree: str, version: str) -> bytes:
    return f'<code id="studio-version" title="Platform {revision} / TREE {tree}">Версия {version}</code>'.encode()


def stage(output: Path, files: dict[str, bytes], source: Path) -> dict[str, str]:
    source, destination = source.resolve(), output.resolve()
    require(not destination.is_relative_to(source) and not source.is_relative_to(destination), "OUTPUT")
    require(not output.exists() and not output.is_symlink(), "OUTPUT")
    output.mkdir(parents=True)
    for name, data in sorted(files.items()):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return {name: digest(data) for name, data in sorted(files.items())}


def prepare_studio(bundle: Path, output: Path, revision: str, version: str | None = None, *,
                   repo: Path = PLATFORM, preview_base: str | None = None) -> dict[str, str]:
    expected_version = calculate_studio_version(repo, revision, preview_base)
    require(version is None or isinstance(version, str) and VERSION.fullmatch(version)
            and version == expected_version, "VERSION")
    manifest, files = package(bundle)
    validate(manifest, files, "fgmp-studio-bundle/1", repo, revision)
    require(files["index.html"].count(VERSION_PLACEHOLDER) == 1, "VERSION_PLACEHOLDER")
    files["index.html"] = files["index.html"].replace(
        VERSION_PLACEHOLDER, version_badge(revision, manifest["platform"]["tree"], expected_version), 1)
    published = {**manifest, "schema": "fgmp-studio-pages/1", "version": expected_version,
                 "assets": {name: digest(files[name]) for name in sorted(ASSETS)}}
    files[MANIFEST] = (json.dumps(published, sort_keys=True, indent=2) + "\n").encode("ascii")
    return stage(output, files, bundle)


def verify_site(source: Path, revision: str, *, repo: Path = PLATFORM,
                expected_hashes: dict[str, str] | None = None,
                preview_base: str | None = None) -> dict[str, str]:
    version = calculate_studio_version(repo, revision, preview_base)
    manifest, files = package(source)
    validate(manifest, files, "fgmp-studio-pages/1", repo, revision)
    require(manifest.get("version") == version, "VERSION")
    badge = version_badge(revision, manifest["platform"]["tree"], version)
    require(files["index.html"].count(badge) == 1 and VERSION_PLACEHOLDER not in files["index.html"], "VERSION_BADGE")
    hashes = {name: digest(data) for name, data in sorted(files.items())}
    if expected_hashes is not None:
        require(isinstance(expected_hashes, dict) and set(expected_hashes) == ASSETS | {MANIFEST}
                and all(isinstance(v, str) and DIGEST.fullmatch(v) for v in expected_hashes.values()), "EXPECTED_HASHES")
        require(hashes == expected_hashes, "RELEASE_DIGEST")
    return hashes


def prepare_rollback(source: Path, output: Path, revision: str, expected_hashes: dict[str, str], *,
                     repo: Path = PLATFORM) -> dict[str, str]:
    require(expected_hashes is not None, "EXPECTED_HASHES")
    # Rollback uses the exact previously checked Platform package, never a rebuild or old repository.
    hashes = verify_site(source, revision, repo=repo, expected_hashes=expected_hashes)
    _, files = package(source)
    require({name: digest(data) for name, data in sorted(files.items())} == hashes, "RELEASE_DIGEST")
    return stage(output, files, source)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("studio", "verify", "rollback"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, nargs="?")
    parser.add_argument("--revision", required=True)
    parser.add_argument("--preview-base")
    parser.add_argument("--hashes", type=Path, help="Независимо полученные hashes ранее проверенного release")
    args = parser.parse_args()
    try:
        hashes = json.loads(args.hashes.read_bytes()) if args.hashes else None
        if args.mode == "studio":
            require(args.output is not None and hashes is None, "ARGUMENTS")
            hashes = prepare_studio(args.input, args.output, args.revision, preview_base=args.preview_base)
        elif args.mode == "verify":
            require(args.output is None, "ARGUMENTS")
            hashes = verify_site(args.input, args.revision, expected_hashes=hashes, preview_base=args.preview_base)
        else:
            require(args.output is not None and args.preview_base is None, "ARGUMENTS")
            hashes = prepare_rollback(args.input, args.output, args.revision, hashes)
        print(json.dumps(hashes, sort_keys=True, separators=(",", ":")))
    except (OSError, ValueError) as error:
        parser.exit(2, f"{error}\n")


if __name__ == "__main__":
    main()
