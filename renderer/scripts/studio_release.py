"""Доверенный CI artifact и подписанный Platform release для публикации и отката."""

from __future__ import annotations

import argparse
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import zipfile

from scripts.studio_pages import (
    ASSETS, MANIFEST, PLATFORM, REVISION, SIZE_LIMIT, digest, git, identity,
    package, stage, verify_site,
)

REPOSITORY = "netkeep80/fgm-platform"
REPOSITORY_ID = 1461346889
WORKFLOW = ".github/workflows/platform.yml"
INDEX = "release.json"
ARCHIVE = "studio.zip"
BUNDLE = "studio.sigstore.json"
SCHEMA = "fgmp-studio-release/1"
LIMIT = SIZE_LIMIT + 128 * 1024
REQUIRED_JOBS = {
    "RepoGuard exact BASE/HEAD",
    "Platform policy / ubuntu-24.04", "Platform policy / windows-2025",
    "Native Platform / ubuntu-24.04", "Native Platform / windows-2025",
    "Local WASM, WebGPU and Chromium / ubuntu-24.04",
}


def require(ok: bool, code: str) -> None:
    if not ok:
        raise ValueError("E_STUDIO_RELEASE_" + code)


def gh(*args: str, binary: bool = False):
    result = subprocess.run(["gh", *args], capture_output=True, check=False, timeout=120)
    require(result.returncode == 0, "GITHUB_COMMAND")
    return result.stdout if binary else json.loads(result.stdout or b"null")


def api(path: str):
    endpoint = "repos/" + REPOSITORY + ("/" + path if path else "")
    result = subprocess.run(["gh", "api", endpoint], capture_output=True, check=False, timeout=120)
    optional = path == "releases/latest" or re.fullmatch(r"git/ref/tags/studio-[0-9a-f]{40}", path)
    if optional and result.returncode and b"(HTTP 404)" in result.stderr:
        return None
    require(result.returncode == 0, "GITHUB_COMMAND")
    return json.loads(result.stdout)


def check_repository(data: dict) -> None:
    require(data.get("full_name") == REPOSITORY and data.get("id") == REPOSITORY_ID, "REPOSITORY")


def check_current_main(revision: str, query=api) -> None:
    require(isinstance(revision, str) and REVISION.fullmatch(revision), "REVISION")
    check_repository(query(""))
    require(query("branches/main").get("commit", {}).get("sha") == revision, "STALE_MAIN")


def archive_bytes(files: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return output.getvalue()


def read_archive(data: bytes, expected: set[str]) -> dict[str, bytes]:
    require(0 < len(data) <= LIMIT, "ARCHIVE_SIZE")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            require(len(entries) == len(expected) and {p.filename for p in entries} == expected, "ARCHIVE_ALLOWLIST")
            require(all(not p.is_dir() and p.file_size > 0 and not p.flag_bits & 1
                        and stat.S_IFMT(p.external_attr >> 16) in (0, stat.S_IFREG) for p in entries), "ARCHIVE_TYPE")
            require(sum(p.file_size for p in entries) <= LIMIT, "ARCHIVE_SIZE")
            return {p.filename: archive.read(p) for p in entries}
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        raise ValueError("E_STUDIO_RELEASE_ARCHIVE") from error


def seal(source: Path, output: Path, revision: str, *, repo: Path = PLATFORM, preview_base=None) -> dict:
    hashes = verify_site(source, revision, repo=repo, preview_base=preview_base)
    manifest, files = package(source)
    index = {"schema": SCHEMA, "repository": REPOSITORY, "repository_id": REPOSITORY_ID,
             "platform": identity(repo, revision), "version": manifest["version"], "hashes": hashes}
    files[INDEX] = (json.dumps(index, sort_keys=True, indent=2) + "\n").encode()
    data = archive_bytes(files)
    require(not output.exists() and not output.is_symlink(), "OUTPUT")
    require(not output.resolve().is_relative_to(source.resolve()), "OUTPUT")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return {**index, "archive_sha256": digest(data)}


def unpack(data: bytes, output: Path, revision: str, *, repo: Path = PLATFORM) -> dict:
    files = read_archive(data, ASSETS | {MANIFEST, INDEX})
    index = json.loads(files.pop(INDEX))
    require(isinstance(index, dict) and set(index) == {
        "schema", "repository", "repository_id", "platform", "version", "hashes"}, "INDEX")
    require(index.get("schema") == SCHEMA and index.get("repository") == REPOSITORY
            and index.get("repository_id") == REPOSITORY_ID, "REPOSITORY")
    require(index.get("platform") == identity(repo, revision), "SOURCE")
    require(isinstance(index.get("hashes"), dict) and set(index["hashes"]) == ASSETS | {MANIFEST}
            and all(isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for v in index["hashes"].values()), "INDEX")
    with tempfile.TemporaryDirectory() as directory:
        source = Path(directory) / "site"
        stage(source, files, Path(directory) / "input")
        hashes = verify_site(source, revision, repo=repo, expected_hashes=index.get("hashes"))
        manifest = json.loads(files[MANIFEST])
        require(index.get("version") == manifest["version"], "VERSION")
    # Validate all bytes before writing the requested output; no extraction of arbitrary ZIP paths.
    require(not output.exists() and not output.is_symlink(), "OUTPUT")
    for name, value in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
    return {"revision": revision, "tree": index["platform"]["tree"], "version": index["version"],
            "hashes": hashes, "archive_sha256": digest(data)}


def check_ci_origin(artifact: dict, run: dict, jobs: dict, revision: str, run_id: int, attempt: int) -> str:
    require(type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0, "RUN")
    require(run.get("id") == run_id and run.get("run_attempt") == attempt
            and run.get("path") == WORKFLOW and run.get("head_sha") == revision
            and run.get("head_branch") == "main" and run.get("event") in ("push", "workflow_dispatch")
            and run.get("status") in ("in_progress", "completed")
            and run.get("conclusion") in (None, "success"), "RUN")
    check_repository(run.get("repository", {}))
    require(artifact.get("name") == f"platform-studio-{revision}-{attempt}"
            and artifact.get("expired") is False
            and artifact.get("workflow_run", {}).get("id") == run_id
            and artifact.get("workflow_run", {}).get("head_sha") == revision
            and artifact.get("workflow_run", {}).get("repository_id") == REPOSITORY_ID
            and artifact.get("workflow_run", {}).get("head_repository_id") == REPOSITORY_ID, "ARTIFACT")
    require(type(artifact.get("size_in_bytes")) is int and 0 < artifact["size_in_bytes"] <= LIMIT, "ARTIFACT_SIZE")
    checksum = artifact.get("digest")
    require(isinstance(checksum, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", checksum), "PROVIDER_DIGEST")
    entries = jobs.get("jobs", [])
    require(jobs.get("total_count") == len(entries) and len(entries) < 100, "JOBS")
    for name in REQUIRED_JOBS:
        selected = [j for j in entries if j.get("name") == name]
        require(len(selected) == 1 and selected[0].get("status") == "completed"
                and selected[0].get("conclusion") == "success"
                and selected[0].get("run_id") == run_id
                and selected[0].get("head_sha") == revision, "JOBS")
    return checksum.removeprefix("sha256:")


def prepare_ci(output: Path, revision: str, artifact_id: int, run_id: int, attempt: int, *,
               repo: Path = PLATFORM, query=api, download=None) -> dict:
    require(type(artifact_id) is int and artifact_id > 0, "ARTIFACT")
    require(type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0, "RUN")
    check_current_main(revision, query)
    artifact = query(f"actions/artifacts/{artifact_id}")
    require(artifact.get("id") == artifact_id, "ARTIFACT")
    checksum = check_ci_origin(artifact, query(f"actions/runs/{run_id}"),
                               query(f"actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100"),
                               revision, run_id, attempt)
    wrapper = download(artifact_id) if download else gh("api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip", binary=True)
    require(digest(wrapper) == checksum, "PROVIDER_DIGEST")
    files = read_archive(wrapper, {ARCHIVE})
    info = unpack(files[ARCHIVE], output, revision, repo=repo)
    (output.parent / ARCHIVE).write_bytes(files[ARCHIVE])
    return info


def verify_attestation(archive: Path, bundle: Path, revision: str, *, run=subprocess.run) -> None:
    require(REVISION.fullmatch(revision) and archive.is_file() and bundle.is_file()
            and not archive.is_symlink() and not bundle.is_symlink(), "ATTESTATION")
    require(0 < bundle.stat().st_size <= 1024 * 1024 and 0 < archive.stat().st_size <= LIMIT, "ATTESTATION")
    command = ["gh", "attestation", "verify", str(archive), "--bundle", str(bundle),
               "--repo", REPOSITORY, "--signer-workflow", REPOSITORY + "/" + WORKFLOW,
               "--source-ref", "refs/heads/main", "--source-digest", revision,
               "--signer-digest", revision, "--deny-self-hosted-runners", "--format", "json"]
    result = run(command, capture_output=True, check=False, timeout=180)
    require(result.returncode == 0, "ATTESTATION")
    # Success must include a verified statement, not merely an exit-zero empty wrapper.
    try:
        verified = json.loads(result.stdout)
    except (ValueError, TypeError) as error:
        raise ValueError("E_STUDIO_RELEASE_ATTESTATION") from error
    require(isinstance(verified, list) and verified, "ATTESTATION")
    checksum = digest(archive.read_bytes())
    require(any(isinstance(x.get("verificationResult", {}).get("statement"), dict)
                and any(s.get("digest", {}).get("sha256") == checksum
                        for s in x["verificationResult"]["statement"].get("subject", []))
                for x in verified if isinstance(x, dict)), "ATTESTATION_SUBJECT")


def release_tag(revision: str) -> str:
    require(isinstance(revision, str) and REVISION.fullmatch(revision), "REVISION")
    return "studio-" + revision


def check_release(data: dict, revision: str) -> None:
    require(data.get("tag_name") == release_tag(revision) and data.get("draft") is False
            and data.get("prerelease") is False, "RELEASE")
    assets = data.get("assets", [])
    require(len(assets) == 2 and {a.get("name") for a in assets} == {ARCHIVE, BUNDLE}, "RELEASE_ASSETS")


def check_tag(revision: str, query=api, *, allow_missing: bool = False) -> None:
    tag = query("git/ref/tags/" + release_tag(revision))
    if tag is None and allow_missing:
        return
    require(isinstance(tag, dict) and tag.get("object", {}).get("type") == "commit"
            and tag["object"].get("sha") == revision, "RELEASE_TAG")


def check_release_target(data: dict, revision: str, query=api) -> None:
    require(data.get("tag_name") == release_tag(revision) and data.get("prerelease") is False
            and type(data.get("draft")) is bool, "RELEASE")
    if data["draft"]:
        # GitHub creates an absent tag from this target when a Draft becomes public.
        require(data.get("target_commitish") == revision, "RELEASE_TARGET")
    check_tag(revision, query, allow_missing=data["draft"])


def release_snapshot(revision: str, query=api) -> dict | None:
    """Read unpublished GitHub Draft by provider ID (tag lookup is 404 until publication)."""
    listing = query("releases?per_page=100")
    require(type(listing) is list and len(listing) < 100, "RELEASE_LIST")
    matches = [r for r in listing if isinstance(r, dict) and r.get("tag_name") == release_tag(revision)]
    require(len(matches) <= 1, "RELEASE_DUPLICATE")
    if not matches:
        return None
    listed = matches[0]
    release_id = listed.get("id")
    require(type(release_id) is int and release_id > 0, "RELEASE_ID")
    detail = query("releases/" + str(release_id))
    require(isinstance(detail, dict) and detail.get("id") == release_id
            and detail.get("tag_name") == release_tag(revision), "RELEASE_ID")
    require(all(detail.get(k) == listed.get(k)
                for k in ("target_commitish", "draft", "prerelease")), "RELEASE_DRIFT")
    return detail


def restore(revision: str, output: Path, *, repo: Path = PLATFORM, query=api, fetch=None) -> dict:
    check_repository(query(""))
    git(repo, "merge-base", "--is-ancestor", revision, "HEAD")
    release = query("releases/tags/" + release_tag(revision))
    check_release(release, revision)
    check_tag(revision, query)
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        if fetch:
            fetch(release_tag(revision), directory)
        else:
            gh("release", "download", release_tag(revision), "--repo", REPOSITORY,
               "--pattern", ARCHIVE, "--pattern", BUNDLE, "--dir", str(directory), binary=True)
        archive, bundle = directory / ARCHIVE, directory / BUNDLE
        for entry in release["assets"]:
            path = directory / entry["name"]
            require(path.is_file() and not path.is_symlink()
                    and entry.get("digest") == "sha256:" + digest(path.read_bytes()), "RELEASE_DIGEST")
        verify_attestation(archive, bundle, revision)
        info = unpack(archive.read_bytes(), output, revision, repo=repo)
        (output.parent / ARCHIVE).write_bytes(archive.read_bytes())
        (output.parent / BUNDLE).write_bytes(bundle.read_bytes())
    return info


def previous(query=api) -> dict:
    # Only product releases owned by this pipeline are considered; unrelated releases are never rollback inputs.
    check_repository(query(""))
    release = query("releases/latest")
    if release is None:
        return {"revision": ""}
    tag = release.get("tag_name", "")
    require(re.fullmatch(r"studio-[0-9a-f]{40}", tag), "PREVIOUS_RELEASE")
    check_release(release, tag[7:])
    return {"revision": tag[7:]}


def retain(archive: Path, bundle: Path, revision: str, *, repo: Path = PLATFORM) -> dict:
    check_repository(api(""))
    require(archive.name == ARCHIVE and bundle.name == BUNDLE, "RELEASE_ASSETS")
    verify_attestation(archive, bundle, revision)
    with tempfile.TemporaryDirectory() as directory:
        info = unpack(archive.read_bytes(), Path(directory) / "checked", revision, repo=repo)
    tag = release_tag(revision)
    existing = release_snapshot(revision, api)
    if existing is None:
        check_tag(revision, api, allow_missing=True)
        gh("release", "create", tag, "--repo", REPOSITORY, "--target", revision, "--draft",
           "--title", "Platform Studio " + info["version"], "--notes",
           "Verified Platform Studio; source " + revision + ", TREE " + info["tree"] + ".",
           binary=True)
        existing = release_snapshot(revision, api)
        require(existing is not None and existing.get("draft") is True, "RELEASE_CREATE")
    require(existing is not None, "RELEASE")
    check_release_target(existing, revision, api)
    for path in (archive, bundle):
        asset = next((a for a in existing.get("assets", []) if a.get("name") == path.name), None)
        if asset is None:
            require(existing.get("draft") is True, "RELEASE_ASSETS")
            gh("release", "upload", tag, str(path), "--repo", REPOSITORY, binary=True)
    # Never clobber a prior accepted release; validate stored bytes/signature before making it current.
    current = release_snapshot(revision, api)
    require(current is not None and len(current.get("assets", [])) == 2
            and {a["name"] for a in current["assets"]} == {ARCHIVE, BUNDLE}, "RELEASE_ASSETS")
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        gh("release", "download", tag, "--repo", REPOSITORY, "--pattern", ARCHIVE,
           "--pattern", BUNDLE, "--dir", str(directory), binary=True)
        require(digest((directory / ARCHIVE).read_bytes()) == digest(archive.read_bytes()), "RELEASE_CONFLICT")
        verify_attestation(directory / ARCHIVE, directory / BUNDLE, revision)
    # Re-read after uploads/download/signature verification, before the public/latest transition.
    final_draft = release_snapshot(revision, api)
    require(final_draft is not None, "RELEASE")
    check_release_target(final_draft, revision, api)
    gh("release", "edit", tag, "--repo", REPOSITORY, "--draft=false", "--latest", binary=True)
    check_tag(revision, api)
    return info


def emit(info: dict) -> None:
    print(json.dumps(info, sort_keys=True, separators=(",", ":")))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key in ("revision", "tree", "version", "hashes", "archive_sha256"):
                if key in info:
                    value = json.dumps(info[key], separators=(",", ":")) if isinstance(info[key], dict) else str(info[key])
                    require("\n" not in value and "\r" not in value, "OUTPUT")
                    output.write(f"{key}={value}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("seal", "prepare", "restore", "previous", "retain", "current"))
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--revision", default="")
    parser.add_argument("--preview-base")
    parser.add_argument("--artifact-id", type=int)
    parser.add_argument("--run-id", type=int)
    parser.add_argument("--attempt", type=int)
    parser.add_argument("--bundle", type=Path)
    args = parser.parse_args()
    try:
        if args.mode == "seal":
            require(args.input is not None and args.output is not None, "ARGUMENTS")
            info = seal(args.input, args.output, args.revision, preview_base=args.preview_base)
        elif args.mode == "prepare":
            require(os.environ.get("GITHUB_REPOSITORY") == REPOSITORY
                    and os.environ.get("GITHUB_REF") == "refs/heads/main"
                    and os.environ.get("GITHUB_SHA") == args.revision
                    and os.environ.get("GITHUB_RUN_ID") == str(args.run_id)
                    and os.environ.get("GITHUB_RUN_ATTEMPT") == str(args.attempt)
                    and args.output is not None, "CONTEXT")
            info = prepare_ci(args.output, args.revision, args.artifact_id, args.run_id, args.attempt)
        elif args.mode == "restore":
            require(args.output is not None, "ARGUMENTS")
            info = restore(args.revision, args.output)
        elif args.mode == "previous":
            info = previous()
        elif args.mode == "retain":
            require(args.input is not None and args.bundle is not None, "ARGUMENTS")
            info = retain(args.input, args.bundle, args.revision)
        else:
            check_current_main(args.revision)
            info = {"revision": args.revision}
        emit(info)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(2, f"{error}\n")


if __name__ == "__main__":
    main()
