"""Check the exact file snapshot imported by S02B."""

import argparse
import json
from pathlib import Path
import re
import subprocess


MODULES = ("core", "regenerator", "renderer")
SUPPORT_FILES = {
    ".github/workflows/source-snapshots.yml",
    "docs/source-snapshots.json",
    "docs/source-snapshot-resources.json",
    "docs/source-snapshot-import.md",
    "requirements/FGMP-MIG-SNAPSHOT-001.rg.yaml",
    "scripts/check-source-snapshots.py",
    "tests/test_source_snapshots.py",
}


def git(repo, *arguments):
    result = subprocess.run(
        ["git", "-C", str(repo), *arguments], check=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
    )
    return result.stdout


def tree_files(repo, revision):
    entries = git(repo, "ls-tree", "-r", "-z", revision).split(b"\0")
    return dict(entry.split(b"\t", 1)[::-1] for entry in entries if entry)


def check(repo, head="HEAD", expected_base=None):
    head = git(repo, "rev-parse", "--verify", head + "^{commit}").decode().strip()
    manifest = json.loads(git(repo, "show", head + ":docs/source-snapshots.json"))
    if manifest.get("schema") != "fgm-platform-source-snapshots/1":
        raise ValueError("Unsupported snapshot manifest")
    base = manifest["platform_base"]["head"]
    if expected_base is not None and base != expected_base:
        raise ValueError("BASE differs from the selected snapshot base")
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        raise ValueError("Invalid platform BASE")
    parents = git(repo, "rev-list", "--parents", "-n", "1", head).decode().split()[1:]
    if parents != [base]:
        raise ValueError("Expected one snapshot commit with the selected BASE as its only parent")
    actual_base_tree = git(repo, "rev-parse", base + "^{tree}").decode().strip()
    if actual_base_tree != manifest["platform_base"]["tree"]:
        raise ValueError("Platform BASE TREE differs from the manifest")

    sources = manifest["sources"]
    if [source["target"] for source in sources] != list(MODULES):
        raise ValueError("Expected Core, Regenerator and Renderer in the selected order")
    before, after = tree_files(repo, base), tree_files(repo, head)
    if any(after.get(path) != value for path, value in before.items()):
        raise ValueError("An existing Platform file changed")
    imported = []
    report = []
    for source in sources:
        prefix = source["target"]
        if source["repository"] != "https://github.com/netkeep80/fgm-" + prefix:
            raise ValueError("Unexpected source repository")
        if any(not re.fullmatch(r"[0-9a-f]{40}", source[field]) for field in ("head", "tree")):
            raise ValueError("Invalid full source HEAD/TREE")
        tree = git(repo, "rev-parse", head + ":" + prefix).decode().strip()
        if tree != source["tree"]:
            raise ValueError("Source subtree mismatch: " + prefix)
        files = tree_files(repo, head + ":" + prefix)
        if len(files) != source["files"]:
            raise ValueError("Source file count mismatch: " + prefix)
        imported.extend(prefix + "/" + path.decode("utf-8") for path in files)
        report.append({"target": prefix, "tree": tree, "files": len(files)})

    actual_additions = set(after) - set(before)
    expected_additions = {path.encode("utf-8") for path in [*imported, *SUPPORT_FILES]}
    if actual_additions != expected_additions:
        raise ValueError("Unexpected or missing files outside the exact source snapshots")
    collection = json.loads(git(repo, "show", head + ":docs/source-snapshot-resources.json"))
    if (set(collection) != {"schema", "members"}
            or collection["schema"] != "repo-guard/resource-collection/v0"
            or len(collection["members"]) != len(imported)
            or set(collection["members"]) != set(imported)):
        raise ValueError("RepoGuard collection differs from the imported file inventory")
    return {"head": head, "base": base, "sources": report,
            "imported_files": len(imported), "platform_files_preserved": len(before), "result": "PASS"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--base")
    args = parser.parse_args()
    try:
        result = check(args.repo, args.head, args.base)
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        parser.exit(2, "SNAPSHOT_CHECK_FAILED: " + str(error) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
