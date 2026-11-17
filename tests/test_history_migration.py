"""Exercise actual Git graphs, file modes and negative migration cases."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prove-history-migration.py"
SPEC = importlib.util.spec_from_file_location("history_proof", SCRIPT)
proof = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(proof)


class HistoryProofTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="fgmp-history-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repositories = {}
        self.snapshots = {}
        for key in ("platform", *proof.SOURCE_KEYS):
            path = self.root / key
            proof.git(self.root, "init", "--bare", str(path))
            self.repositories[key] = path
            blob = proof.text(path, "hash-object", "-w", "--stdin", data=b"\0\xff" + key.encode())
            link = proof.text(path, "hash-object", "-w", "--stdin", data=b"binary file")
            entries = (
                f"100644 blob {blob}\tbinary file\0"
                f"100755 blob {blob}\texecutable\0"
                f"120000 blob {link}\tsymlink\0"
            ).encode()
            tree = proof.text(path, "mktree", "-z", data=entries)
            original = self.commit(path, tree, key + " original")
            left = self.commit(path, tree, key + " left", original)
            right = self.commit(path, tree, key + " right", original)
            head = self.commit(path, tree, key + " merge", left, right)
            proof.git(path, "update-ref", "refs/heads/main", head)
            proof.git(path, "symbolic-ref", "HEAD", "refs/heads/main")
            self.snapshots[key] = {"head": head, "tree": tree}
        self.lock = {
            "schema": "fgm-platform-history-lock/1",
            "platform": self.snapshots["platform"],
            "sources": [
                {"key": key, "prefix": key, **self.snapshots[key]}
                for key in proof.SOURCE_KEYS
            ],
        }

    def commit(self, repo, tree, message, *parents):
        arguments = ["commit-tree", tree]
        for parent in parents:
            arguments.extend(["-p", parent])
        return proof.text(repo, *arguments, data=(message + "\n").encode(),
                          environment=proof.PROOF_IDENTITY)

    def test_graphs_binary_files_modes_and_repeatability(self):
        report = proof.prove(self.lock, self.repositories, self.root / "first")
        again = proof.prove(self.lock, self.repositories, self.root / "second")
        self.assertEqual(report, again)
        self.assertEqual(report["reachable_commits"], 19)
        self.assertEqual(report["result"], "PASS")
        target = self.root / "first" / "proof.git"
        for key, source in self.snapshots.items():
            for sha in proof.text(self.repositories[key], "rev-list", source["head"]).splitlines():
                self.assertEqual(proof.git(self.repositories[key], "cat-file", "commit", sha),
                                 proof.git(target, "cat-file", "commit", sha))
        for source in self.lock["sources"]:
            subtree = report["final_head"] + ":" + source["prefix"]
            self.assertEqual(proof.git(target, "ls-tree", "-r", "-z", subtree),
                             proof.git(self.repositories[source["key"]], "ls-tree", "-r", "-z", source["head"]))

    def test_wrong_tree_rejected_before_output_creation(self):
        lock = deepcopy(self.lock)
        lock["sources"][0]["tree"] = self.snapshots["platform"]["tree"]
        with self.assertRaisesRegex(ValueError, "TREE differs"):
            proof.prove(lock, self.repositories, self.root / "wrong")
        self.assertFalse((self.root / "wrong").exists())

    def test_duplicate_source_and_changed_prefix_rejected(self):
        lock = deepcopy(self.lock)
        lock["sources"][1] = lock["sources"][0]
        with self.assertRaisesRegex(ValueError, "ordered"):
            proof.prove(lock, self.repositories, self.root / "duplicate")
        lock = deepcopy(self.lock)
        lock["sources"][0]["prefix"] = "../core"
        with self.assertRaisesRegex(ValueError, "prefix"):
            proof.prove(lock, self.repositories, self.root / "bad-prefix")

    def test_existing_output_preserved(self):
        destination = self.root / "already-there"
        destination.mkdir()
        marker = destination / "marker.txt"
        marker.write_bytes(b"preserve")
        with self.assertRaises(FileExistsError):
            proof.prove(self.lock, self.repositories, destination)
        self.assertEqual(marker.read_bytes(), b"preserve")

    def test_output_inside_source_is_rejected(self):
        output = self.repositories["core"] / "proof-output"
        with self.assertRaisesRegex(ValueError, "outside the input"):
            proof.prove(self.lock, self.repositories, output)
        self.assertFalse(output.exists())

    def test_platform_prefix_collision_rejected(self):
        lock = deepcopy(self.lock)
        path = self.repositories["platform"]
        tree = proof.text(path, "mktree", data=(
            "040000 tree " + self.snapshots["platform"]["tree"] + "\tcore\n"
        ).encode())
        head = self.commit(path, tree, "existing module", self.snapshots["platform"]["head"])
        lock["platform"] = {"head": head, "tree": tree}
        with self.assertRaisesRegex(ValueError, "already contains"):
            proof.prove(lock, self.repositories, self.root / "collision")

    def test_shallow_source_rejected(self):
        shallow = self.root / "shallow"
        proof.git(self.root, "clone", "--bare", "--depth=1", self.repositories["core"].as_uri(), str(shallow))
        repositories = {**self.repositories, "core": shallow}
        with self.assertRaisesRegex(ValueError, "Shallow history"):
            proof.prove(self.lock, repositories, self.root / "shallow-proof")

    def test_swapped_parents_and_unrelated_tree_changes_detected(self):
        report = proof.prove(self.lock, self.repositories, self.root / "valid")
        repo = self.root / "valid" / "proof.git"
        stage = report["stages"][0]
        source = self.lock["sources"][0]
        wrong_parents = self.commit(repo, stage["proof_tree"], "swapped", source["head"], stage["previous"])
        with self.assertRaisesRegex(ValueError, "parents"):
            proof.verify_stage(repo, stage["previous"], source, "core", wrong_parents)
        # Preserve the source subtree, but silently delete all platform files.
        changed_tree = proof.text(repo, "mktree", data=(
            "040000 tree " + source["tree"] + "\tcore\n"
        ).encode())
        changed = self.commit(repo, changed_tree, "lost platform files", stage["previous"], source["head"])
        with self.assertRaisesRegex(ValueError, "outside"):
            proof.verify_stage(repo, stage["previous"], source, "core", changed)

    def test_cli_builds_from_a_lock_file(self):
        path = self.root / "lock.json"
        path.write_text(json.dumps(self.lock), encoding="utf-8")
        command = [sys.executable, str(SCRIPT), "--lock", str(path), "--output", str(self.root / "cli")]
        for key, repo in self.repositories.items():
            command.extend(["--" + key, str(repo)])
        result = subprocess.run(command, capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["result"], "PASS")
        self.assertEqual(report, json.loads((self.root / "cli" / "report.json").read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
