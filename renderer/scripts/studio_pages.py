"""Подготовка проверенного сайта Studio или точного снимка V03 для отката."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

from scripts.promote_v03_s3 import ASSETS as V03_ASSETS, digest
from scripts.verify_pages_snapshot import verify as verify_v03

ASSETS = {
    "index.html", "studio-app.mjs", "whole-ui.mjs", "r05-view.mjs", "synthetic.mjs", "ufo-catalog.mjs",
    "engine/worker.mjs", "engine/fgmr-studio.mjs", "engine/fgmr-studio.wasm",
}
MANIFEST = "studio-manifest.json"
VERSION_PLACEHOLDER = '<code id="studio-version">Локальная сборка</code>'.encode()
SIZE_LIMIT = 16 * 1024 * 1024
REPOSITORY = Path(__file__).resolve().parents[1]
ARCHITECTURE_PATH = "renderer/studio/architecture-version.txt"
REVISION = re.compile(r"[0-9a-f]{40}")
VERSION = re.compile(r"[1-9][0-9]*\.(0|[1-9][0-9]*)")


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise ValueError(f"E_STUDIO_PAGES_{reason}")


def read_engine_lock() -> dict:
    engine = json.loads((REPOSITORY / "studio/engine-lock.json").read_text(encoding="utf-8"))
    require(isinstance(engine, dict) and engine.get("schema") == "fgmp-studio-engine/1"
            and all(isinstance(engine.get(key), str) and REVISION.fullmatch(engine[key])
                    for key in ("core",))
            and "regenerator" not in engine
            and type(engine.get("workerProtocol")) is int and engine["workerProtocol"] == 1
            and engine.get("wholeBuild") == "r06-whole-build/1",
            "ENGINE_LOCK")
    return engine


def stage(output: Path, files: dict[str, bytes]) -> dict[str, str]:
    output.mkdir(parents=True)
    for name, data in sorted(files.items()):
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    return {name: digest(data) for name, data in sorted(files.items())}


def calculate_studio_version(repo: Path, revision: str, preview_base: str | None = None) -> str:
    require(REVISION.fullmatch(revision) is not None, "REVISION")
    require(preview_base is None or REVISION.fullmatch(preview_base) is not None, "PREVIEW_BASE")

    def git(*args: str) -> str:
        return subprocess.check_output(["git", "-C", str(repo), *args], text=True).strip()

    require(git("rev-parse", "--is-shallow-repository") == "false", "SHALLOW_HISTORY")
    architecture = git("show", f"{revision}:{ARCHITECTURE_PATH}")
    require(re.fullmatch(r"[1-9][0-9]*", architecture) is not None, "ARCHITECTURE")
    history = revision if preview_base is None else preview_base
    merges = int(git("rev-list", "--first-parent", "--merges", "--count", history))
    if preview_base is not None:
        merges += 1
    return f"{architecture}.{merges}"


def prepare_studio(bundle: Path, output: Path, revision: str, version: str) -> dict[str, str]:
    require(REVISION.fullmatch(revision) is not None, "REVISION")
    require(VERSION.fullmatch(version) is not None, "VERSION")
    require(bundle.is_dir() and not bundle.is_symlink(), "BUNDLE")
    entries = {path.relative_to(bundle).as_posix(): path for path in bundle.rglob("*")
               if path.is_symlink() or not path.is_dir()}
    require(set(entries) == ASSETS | {MANIFEST}, "ALLOWLIST")
    require(all(path.is_file() and not path.is_symlink() for path in entries.values()), "TYPE")
    sizes = [path.stat().st_size for path in entries.values()]
    require(all(sizes) and sum(sizes) <= SIZE_LIMIT, "SIZE")
    inputs = {name: path.read_bytes() for name, path in entries.items()}
    manifest = json.loads(inputs.pop(MANIFEST))
    engine = read_engine_lock()
    require(isinstance(manifest, dict) and manifest.get("schema") == "fgmp-studio-bundle/1"
            and isinstance(manifest.get("platform"), dict)
            and manifest["platform"].get("revision") == revision
            and isinstance(manifest["platform"].get("tree"), str)
            and REVISION.fullmatch(manifest["platform"]["tree"]) is not None
            and "regenerator" not in manifest and "renderer" not in manifest
            and manifest.get("engine") == engine
            and type(manifest["engine"]["workerProtocol"]) is int,
            "MANIFEST")
    require(manifest.get("assets") == {name: digest(data) for name, data in inputs.items()},
            "ASSET_DIGEST")
    require(inputs["engine/fgmr-studio.wasm"].startswith(b"\x00asm\x01\x00\x00\x00"), "WASM")
    require(inputs["index.html"].count(VERSION_PLACEHOLDER) == 1, "VERSION_PLACEHOLDER")
    badge = f'<code id="studio-version" title="{revision}">Версия {version}</code>'.encode()
    inputs["index.html"] = inputs["index.html"].replace(VERSION_PLACEHOLDER, badge, 1)
    published = {
        "schema": "fgmp-studio-pages/1",
        "platform": manifest["platform"],
        "version": version,
        "engine": engine,
        "assets": {name: digest(data) for name, data in inputs.items()},
    }
    inputs[MANIFEST] = (json.dumps(published, sort_keys=True, indent=2) + "\n").encode("ascii")
    return stage(output, inputs)


def prepare_rollback(source: Path, output: Path) -> dict[str, str]:
    verify_v03(source)
    hashes = stage(output, {name: (source / name).read_bytes()
                            for name in set(V03_ASSETS) | {".nojekyll"}})
    hashes.pop(".nojekyll")
    return hashes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("studio", "rollback-v03"))
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--revision", default="")
    parser.add_argument("--preview-base")
    args = parser.parse_args()
    try:
        if args.mode == "studio":
            version = calculate_studio_version(REPOSITORY.parent, args.revision, args.preview_base or None)
            hashes = prepare_studio(args.input, args.output, args.revision, version)
        else:
            hashes = prepare_rollback(args.input, args.output)
        print(json.dumps(hashes, sort_keys=True, separators=(",", ":")))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(2, f"{error}\n")


if __name__ == "__main__":
    main()
