"""Проверяемая подготовка публичного Pages из принятого артефакта CI."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import stat
import sys
import zipfile

SOURCE_SHA = "dcb20e0c5c2f0df3490d378333c9e86ca3f577d5"
WORKFLOW_RUN = 43698253210
ARTIFACT_ID = 14155805365
ARCHIVE_SHA256 = "0ceeeddc6c309417b88b54baa302fa1d0dd5775158e9d787ce4ef632f7533b09"
ASSETS = {
    "camera.wgsl": "c801a3ac5c2571036b639bcf15b1bda04e9bb89f4f187d3c43db8ea91580ba32",
    "fgm_scene.mjs": "8e08523c9b82aa56f2f167873f7979341b0d01bdda175107e73a9229cf4770aa",
    "camera.html": "86069679ac37d80b1d3ddd31e7902b044fa2c12f53b55c029ae33933a51a77f9",
    "camera.js": "9cbf67914da3d6e8285c8e912bfc881b008348adc213f7a71efe79ec8e8c2d7f",
    "fgm_scene.wasm": "c12d3707f57db51154e00c00dd3c08b242a2bb9a4589b606b14730cca7d43cd3",
    "index.html": "9303f41cdfce36d45da4b360705c1c3d026147f0c7fdccb27eec4c3819ac5e5e",
    "scene.wgsl": "71956bb94f257c9aa31bb4a468352a08080d034e217dcabc12b546f5d199d101",
    "main.js": "fe40f7c695ef43a5eb515ee50ed5b7cc800809d52988283056452c2ae6a558f5",
    "sphere.fgm.json": "9077aaf889ccf228a66e0d785258c5cc3e82b7bfa707113eb6220da50a971fac",
}
AUXILIARY = {
    "native/sphere.ppm", "browser.png", "camera.png",
    "v02/report.json", "v02/hits.csv", "v02/mutations.json",
    "v02/c05-semantic.json", "v03/report.json", "v03-map/report.json",
}


def require(test: bool, reason: str) -> None:
    if not test:
        raise ValueError(f"E_PAGES_{reason}")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def check_receipts(run: dict, artifact: dict) -> None:
    require(run.get("id") == WORKFLOW_RUN, "RUN_ID")
    require(run.get("head_sha") == SOURCE_SHA, "RUN_HEAD")
    require(run.get("status") == "completed" and run.get("conclusion") == "success", "RUN_SUCCESS")
    require(run.get("event") == "pull_request", "RUN_EVENT")
    require(artifact.get("id") == ARTIFACT_ID and artifact.get("name") == "fgm-boot", "ARTIFACT_ID")
    require(artifact.get("expired") is False, "EXPIRED")
    require(artifact.get("digest") == "sha256:" + ARCHIVE_SHA256, "ARTIFACT_DIGEST")
    provenance = artifact.get("workflow_run") or {}
    require(provenance.get("id") == WORKFLOW_RUN and provenance.get("head_sha") == SOURCE_SHA, "PROVENANCE")


def check_zip(data: bytes, expected_archive: str = ARCHIVE_SHA256,
              expected_assets: dict[str, str] = ASSETS) -> dict[str, bytes]:
    require(digest(data) == expected_archive, "ARCHIVE_DIGEST")
    selected: dict[str, bytes] = {}
    expected = {"web/" + item for item in expected_assets} | AUXILIARY
    with zipfile.ZipFile(__import__("io").BytesIO(data)) as archive:
        names = [info.filename for info in archive.infolist()]
        require(len(names) == len(expected) and set(names) == expected, "ALLOWLIST")
        require(len(names) == len(set(names)), "DUPLICATE")
        require(sum(info.file_size for info in archive.infolist()) < 32 * 1024 * 1024, "SIZE")
        for info in archive.infolist():
            require(info.file_size <= 16 * 1024 * 1024, "ENTRY_SIZE")
            require(not info.is_dir(), "DIRECTORY")
            require((info.external_attr >> 16) & 0o170000 != stat.S_IFLNK, "SYMLINK")
            require("\\" not in info.filename and ".." not in info.filename.split("/"), "PATH")
            if info.filename.startswith("web/"):
                asset = info.filename[4:]
                content = archive.read(info)
                require(digest(content) == expected_assets[asset], "ASSET_DIGEST")
                selected[asset] = content
    require(set(selected) == set(expected_assets), "MISSING_ASSETS")
    return selected


def promote(archive_path: Path, run_path: Path, artifact_path: Path, destination: Path) -> dict:
    require(not destination.exists(), "DESTINATION_EXISTS")
    check_receipts(json.loads(run_path.read_text()), json.loads(artifact_path.read_text()))
    selected = check_zip(archive_path.read_bytes())
    destination.mkdir(parents=True)
    for name, data in selected.items():
        (destination / name).write_bytes(data)
    (destination / ".nojekyll").write_bytes(b"")
    receipt = {
        "ok": True, "source_sha": SOURCE_SHA, "workflow_run": WORKFLOW_RUN,
        "artifact_id": ARTIFACT_ID, "archive_sha256": ARCHIVE_SHA256,
        "public_assets": len(selected),
    }
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(promote(args.zip, args.run, args.artifact, args.output), sort_keys=True))
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as exc:
        print(f"PAGES_RELEASE_REJECTED: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
