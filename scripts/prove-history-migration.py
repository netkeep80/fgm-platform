"""Build and verify a disposable, non-squashed Git history migration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


SOURCE_KEYS = ("core", "regenerator", "renderer")
PROOF_IDENTITY = {
    "GIT_AUTHOR_NAME": "FGM history proof",
    "GIT_AUTHOR_EMAIL": "history-proof@example.invalid",
    "GIT_COMMITTER_NAME": "FGM history proof",
    "GIT_COMMITTER_EMAIL": "history-proof@example.invalid",
    "GIT_AUTHOR_DATE": "2000-01-01T00:00:00+00:00",
    "GIT_COMMITTER_DATE": "2000-01-01T00:00:00+00:00",
}


def git(repo, *arguments, data=None, environment=None):
    env = os.environ.copy()
    # Keep the selected repository and index independent of the caller's shell.
    for key in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR",
                "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(key, None)
    env.update({"GIT_NO_REPLACE_OBJECTS": "1", "GIT_CONFIG_NOSYSTEM": "1"})
    env.update(environment or {})
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments], input=data,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=120,
    )
    if result.returncode:
        raise ValueError(result.stderr.decode("utf-8", errors="replace").strip())
    return result.stdout


def text(repo, *arguments, **options):
    return git(repo, *arguments, **options).decode("ascii").strip()


def verify_snapshot(path, expected):
    for field in ("head", "tree"):
        if not re.fullmatch(r"[0-9a-f]{40}", expected.get(field, "")):
            raise ValueError("Invalid full Git SHA in source lock")
    if text(path, "rev-parse", "--is-shallow-repository") != "false":
        raise ValueError("Shallow history cannot prove complete ancestry")
    if text(path, "cat-file", "-t", expected["head"]) != "commit":
        raise ValueError("Source HEAD is not a commit")
    if text(path, "rev-parse", expected["head"] + "^{tree}") != expected["tree"]:
        raise ValueError("Source TREE differs from the lock")
    git(path, "rev-list", "--objects", "--missing=error", expected["head"])
    return set(text(path, "rev-list", expected["head"]).splitlines())


def verify_stage(repo, previous, source, prefix, commit):
    parents = text(repo, "rev-list", "--parents", "-n", "1", commit).split()[1:]
    if parents != [previous, source["head"]]:
        raise ValueError("Proof merge parents differ from the selected histories")
    expected_tree = text(repo, "rev-parse", previous + "^{tree}")
    actual_tree = text(repo, "rev-parse", commit + "^{tree}")
    if text(repo, "rev-parse", commit + ":" + prefix) != source["tree"]:
        raise ValueError("Prefixed source TREE differs from the lock")
    before = git(repo, "ls-tree", "-z", expected_tree).split(b"\0")[:-1]
    after = git(repo, "ls-tree", "-z", actual_tree).split(b"\0")[:-1]
    entry = b"040000 tree " + source["tree"].encode("ascii") + b"\t" + prefix.encode("ascii")
    if sorted(after) != sorted([*before, entry]):
        raise ValueError("An import changed files outside its selected prefix")


def prove(lock, repositories, output):
    if lock.get("schema") != "fgm-platform-history-lock/1":
        raise ValueError("Unsupported source lock schema")
    sources = lock.get("sources", [])
    if [source.get("key") for source in sources] != list(SOURCE_KEYS):
        raise ValueError("Expected the ordered Core, Regenerator and Renderer locks")
    for source in sources:
        if source.get("prefix") != source["key"]:
            raise ValueError("Source prefix must match its selected module")
    snapshots = [("platform", lock["platform"]), *[(s["key"], s) for s in sources]]
    paths = {key: Path(repositories[key]).resolve(strict=True) for key, _ in snapshots}
    histories = {key: verify_snapshot(paths[key], source) for key, source in snapshots}
    for key in SOURCE_KEYS:
        if git(paths["platform"], "ls-tree", lock["platform"]["head"], "--", key):
            raise ValueError("The platform already contains the selected source prefix")

    output = Path(output).resolve()
    if any(output.is_relative_to(path) for path in paths.values()):
        raise ValueError("Proof output must be outside the input repositories")
    # mkdir is exclusive. Existing output directories are never reused.
    output.mkdir()
    repository = output / "proof.git"
    git(output, "init", "--bare", "--object-format=sha1", str(repository))
    for key, source in snapshots:
        git(repository, "-c", "fetch.fsckObjects=true", "fetch", "--no-tags",
            "--no-recurse-submodules", "--no-write-fetch-head", str(paths[key]),
            source["head"] + ":refs/proof/source/" + key)

    current = lock["platform"]["head"]
    stages = []
    for source in sources:
        prefix = source["prefix"]
        environment = {**PROOF_IDENTITY, "GIT_INDEX_FILE": str(output / "proof-index")}
        git(repository, "read-tree", current, environment=environment)
        git(repository, "read-tree", "-i", "--prefix=" + prefix + "/", source["head"],
            environment=environment)
        tree = text(repository, "write-tree", environment=environment)
        message = ("S02A isolated proof: preserve " + prefix + " history\n").encode("ascii")
        commit = text(repository, "commit-tree", tree, "-p", current,
                      "-p", source["head"], data=message, environment=environment)
        verify_stage(repository, current, source, prefix, commit)
        stages.append({
            "key": source["key"], "source_head": source["head"],
            "source_tree": source["tree"], "prefix": prefix,
            "previous": current, "proof_commit": commit, "proof_tree": tree,
            "source_commits": len(histories[source["key"]]),
            "source_commit_list_sha256": hashlib.sha256(
                ("\n".join(sorted(histories[source["key"]])) + "\n").encode("ascii")
            ).hexdigest(),
            "source_files": len(git(repository, "ls-tree", "-r", "-z", source["head"]).split(b"\0")) - 1,
        })
        current = commit

    git(repository, "update-ref", "refs/heads/history-proof", current)
    expected_commits = set().union(*histories.values(), {stage["proof_commit"] for stage in stages})
    if set(text(repository, "rev-list", current).splitlines()) != expected_commits:
        raise ValueError("Proof commit ancestry differs from the union of the source histories")
    git(repository, "fsck", "--full", "--strict", "--no-reflogs")
    report = {
        "schema": "fgm-platform-history-proof/1", "platform": lock["platform"],
        "source_commit_mapping": "identity for every commit reachable from each locked source HEAD",
        "reachable_commits": len(expected_commits), "stages": stages,
        "final_head": current, "final_tree": text(repository, "rev-parse", current + "^{tree}"),
        "result": "PASS",
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--lock", type=Path, required=True)
    for key in ("platform", *SOURCE_KEYS):
        parser.add_argument("--" + key, type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        lock = json.loads(args.lock.read_text(encoding="utf-8"))
        report = prove(lock, {key: getattr(args, key) for key in ("platform", *SOURCE_KEYS)}, args.output)
    except (ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        parser.exit(2, "HISTORY_PROOF_FAILED: " + str(error) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
