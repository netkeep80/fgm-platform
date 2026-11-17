"""R01: экспорт разрешён только для точно воспроизводимых собственных данных."""
import argparse
import json
import os
import stat
import sys
import tempfile
from pathlib import Path

from generate_r01 import CorpusError, IDENTIFIERS, generate


def reject_links(path, info):
    """Отвергать ссылку и любой NTFS reparse point до обхода вложений."""
    if path.is_symlink():
        raise CorpusError("E_R01_SYMLINK")
    # st_file_attributes отсутствует в POSIX. FILE_ATTRIBUTE_REPARSE_POINT
    # включает NTFS junction, даже если Path.is_symlink() сообщает False.
    if getattr(info, "st_file_attributes", 0) & getattr(
        stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400
    ):
        raise CorpusError("E_R01_REPARSE")


def catalog(root):
    """Каноническое дерево: отдельные множества файлов и ВСЕХ каталогов."""
    root = Path(root)
    if root.is_symlink():
        raise CorpusError("E_R01_SYMLINK")
    root_info = root.lstat()
    reject_links(root, root_info)
    if not stat.S_ISDIR(root_info.st_mode):
        raise CorpusError("E_R01_SOURCE")

    files, directories = set(), set()
    remaining = [root]
    while remaining:
        current = remaining.pop()
        with os.scandir(current) as entries:
            for entry in entries:
                item = Path(entry.path)
                if entry.name.startswith("."):
                    raise CorpusError("E_R01_HIDDEN_FILE")
                if entry.is_symlink():
                    raise CorpusError("E_R01_SYMLINK")
                info = entry.stat(follow_symlinks=False)
                reject_links(item, info)
                relative = item.relative_to(root).as_posix()
                if stat.S_ISDIR(info.st_mode):
                    # Учитываем и пустые каталоги; ссылки в каталог не проходим.
                    directories.add(relative)
                    remaining.append(item)
                elif stat.S_ISREG(info.st_mode):
                    files.add(relative)
                else:
                    raise CorpusError("E_R01_NONREGULAR_FILE")
    return {"files": files, "directories": directories}


def verify(root):
    root = Path(root)
    actual = catalog(root)
    with tempfile.TemporaryDirectory(prefix="fgm-r01-reference-") as temp:
        reference = Path(temp) / "free"
        generate(reference)
        expected = catalog(reference)
        if actual != expected:
            raise CorpusError("E_R01_FILE_SET")
        for relative in sorted(expected["files"]):
            if (root / relative).read_bytes() != (reference / relative).read_bytes():
                raise CorpusError("E_R01_BYTE_PARITY: " + relative)
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        # The manifest itself has already been compared byte-for-byte.
        if [item["id"] for item in manifest["datasets"]] != list(IDENTIFIERS):
            raise CorpusError("E_R01_CLASSES")
        return {
            "schema": "fgm-regenerator/r01-gate-v1",
            "ok": True,
            "datasets": len(manifest["datasets"]),
            "artifacts": sum(len(item["artifacts"]) for item in manifest["datasets"]),
            "files": len(expected["files"]),
            "directories": len(expected["directories"]),
            "bytes": sum((root / name).stat().st_size for name in expected["files"]),
            "comparison": "every file byte and full typed tree, including empty directories",
        }


def main():
    parser = argparse.ArgumentParser(description="Проверить происхождение публичного корпуса R01")
    parser.add_argument("directory", help="Каталог с собственными контрольными данными")
    args = parser.parse_args()
    try:
        report = verify(args.directory)
    except (CorpusError, OSError, ValueError, KeyError) as error:
        print("Экспорт R01 запрещён:", error, file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
