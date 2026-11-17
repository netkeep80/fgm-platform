"""Use small Git fixtures to detect specific snapshot import regressions."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-source-snapshots.py"
SPEC = importlib.util.spec_from_file_location("snapshot_check", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fgmp-snapshot-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.run_git("init", "--bare", str(self.repo))
        blob = self.blob(b"base bytes\0\xff")
        self.base_tree = self.tree({"LICENSE": ("100644", "blob", blob)})
        self.base = self.commit(self.base_tree)
        self.root_entries = {"LICENSE": ("100644", "blob", blob)}
        sources = []
        for key in checker.MODULES:
            content = self.blob(b"module bytes\0\xff" + key.encode())
            subtree = self.tree({"program": ("100755", "blob", content)})
            self.root_entries[key] = ("040000", "tree", subtree)
            sources.append({"repository": "https://github.com/netkeep80/fgm-" + key,
                            "head": "a" * 40, "tree": subtree, "target": key, "files": 1})
        self.manifest = {"schema": "fgm-platform-source-snapshots/1",
                         "platform_base": {"head": self.base, "tree": self.base_tree}, "sources": sources}
        self.extra_files = {name: b"synthetic" for name in checker.SUPPORT_FILES}
        self.extra_files["docs/source-snapshot-resources.json"] = json.dumps({
            "schema": "repo-guard/resource-collection/v0",
            "members": [key + "/program" for key in checker.MODULES],
        }).encode()

    def run_git(self, *args, data=None):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args], input=data, check=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60,
        ).stdout

    def blob(self, data):
        return self.run_git("hash-object", "-w", "--stdin", data=data).decode().strip()

    def tree(self, entries):
        data = b"".join((mode + " " + kind + " " + sha + "\t" + name + "\0").encode()
                        for name, (mode, kind, sha) in sorted(entries.items()))
        return self.run_git("mktree", "-z", data=data).decode().strip()

    def commit(self, tree, *parents):
        arguments = ["-c", "user.name=Snapshot fixture", "-c", "user.email=fixture@example.invalid",
                     "commit-tree", tree]
        for parent in parents:
            arguments.extend(["-p", parent])
        return self.run_git(*arguments, data=b"fixture\n").decode().strip()

    def candidate(self, *, manifest=None, extras=None, entries=None, parents=None):
        files = {**self.extra_files, **(extras or {})}
        files["docs/source-snapshots.json"] = json.dumps(manifest or self.manifest).encode()
        root = deepcopy(entries or self.root_entries)
        for path, content in files.items():
            parts = path.split("/")
            leaf = ("100644", "blob", self.blob(content))
            # Overlay nested metadata trees, retaining previously inserted siblings.
            def overlay(current, remaining):
                name = remaining[0]
                if len(remaining) == 1:
                    current[name] = leaf
                else:
                    previous = current.get(name)
                    children = {}
                    if previous:
                        raw = self.run_git("ls-tree", "-z", previous[2])
                        for entry in raw.split(b"\0"):
                            if entry:
                                meta, filename = entry.split(b"\t")
                                children[filename.decode()] = tuple(meta.decode().split())
                    overlay(children, remaining[1:])
                    current[name] = ("040000", "tree", self.tree(children))
            overlay(root, parts)
        return self.commit(self.tree(root), *(parents if parents is not None else [self.base]))

    def test_exact_subtrees_and_original_platform_files(self):
        result = checker.check(self.repo, self.candidate(), self.base)
        self.assertEqual(result["imported_files"], 3)
        self.assertEqual(result["platform_files_preserved"], 1)
        self.assertEqual(result["result"], "PASS")

    def test_changed_source_mode_fails(self):
        entries = deepcopy(self.root_entries)
        blob = self.blob(b"module bytes\0\xffcore")
        entries["core"] = ("040000", "tree", self.tree({"program": ("100644", "blob", blob)}))
        with self.assertRaisesRegex(ValueError, "subtree mismatch"):
            checker.check(self.repo, self.candidate(entries=entries))

    def test_changed_platform_file_fails(self):
        entries = deepcopy(self.root_entries)
        entries["LICENSE"] = ("100644", "blob", self.blob(b"changed"))
        with self.assertRaisesRegex(ValueError, "Platform file changed"):
            checker.check(self.repo, self.candidate(entries=entries))

    def test_extra_file_and_incomplete_inventory_fail(self):
        with self.assertRaisesRegex(ValueError, "Unexpected or missing files"):
            checker.check(self.repo, self.candidate(extras={"unexpected": b"new"}))
        collection = json.dumps({"schema": "repo-guard/resource-collection/v0", "members": []}).encode()
        with self.assertRaisesRegex(ValueError, "collection differs"):
            checker.check(self.repo, self.candidate(extras={"docs/source-snapshot-resources.json": collection}))

    def test_bad_count_and_wrong_base_fail(self):
        manifest = deepcopy(self.manifest)
        manifest["sources"][0]["files"] = 2
        with self.assertRaisesRegex(ValueError, "file count"):
            checker.check(self.repo, self.candidate(manifest=manifest))
        with self.assertRaisesRegex(ValueError, "BASE differs"):
            checker.check(self.repo, self.candidate(), "b" * 40)

    def test_source_history_merge_parent_rejected(self):
        other = self.commit(self.base_tree, self.base)
        with self.assertRaisesRegex(ValueError, "only parent"):
            checker.check(self.repo, self.candidate(parents=[self.base, other]))


if __name__ == "__main__":
    unittest.main()
