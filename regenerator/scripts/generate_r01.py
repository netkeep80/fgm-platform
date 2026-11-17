"""Воспроизводимый корпус R01: только собственные математические фикстуры."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

SIDE = 16
IDENTIFIERS = ("slab", "arch", "boulder")
COLORS = {
    "slab": ("#242932", "#b5c1d0", "#f2e4ca"),
    "arch": ("#252a33", "#8eaa9b", "#f0dca7"),
    "boulder": ("#23262b", "#8895a3", "#d2c5af"),
}


class CorpusError(Exception):
    """Отказ без обращения к пользовательским игровым данным."""


def canon(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def occupied(kind, x, y, z):
    if kind == "slab":
        return 3 <= x < 13 and 3 <= y < 13 and 2 <= z < 4
    if kind == "arch":
        wall = 6 <= y <= 9
        posts = (2 <= x <= 4 or 11 <= x <= 13) and 1 <= z <= 12
        lintel = 2 <= x <= 13 and 10 <= z <= 12
        return wall and (posts or lintel)
    if kind == "boulder":
        dx, dy, dz = 2 * (x - 8), 2 * (y - 8), 2 * (z - 6)
        ellipsoid = 16 * dx * dx + 25 * dy * dy + 20 * dz * dz <= 1600
        return ellipsoid and not (x > 10 and y < 7 and z > 7)
    raise CorpusError("E_R01_UNKNOWN_KIND")


def render(kind):
    # Z major, затем Y, X — младший; маска = строго бинарные 0/1.
    mask = bytes(int(occupied(kind, x, y, z))
                 for z in range(SIDE) for y in range(SIDE) for x in range(SIDE))
    # Независимая от игрового ракурса диагностическая ортопроекция вдоль Y.
    pixels = bytes(
        255 if any(occupied(kind, x, y, z) for y in range(SIDE)) else 0
        for z in range(SIDE - 1, -1, -1) for x in range(SIDE)
    )
    pgm = b"P5\n16 16\n255\n" + pixels
    metadata = {
        "schema": "fgm-regenerator/synthetic-geometry-v1",
        "class": kind,
        "dimensions_xyz": [SIDE, SIDE, SIDE],
        "mask_order": "z-major/y-middle/x-minor",
        "occupancy_count": sum(mask),
        "projection": "orthographic along y, x→columns, z descending→rows",
        "evidence_scope": "authored mathematical test, not UFO measurement",
    }
    palette = {
        "schema": "fgm-regenerator/synthetic-palette-v1",
        "class": kind,
        "void": COLORS[kind][0],
        "surface": COLORS[kind][1],
        "detail": COLORS[kind][2],
        "source": "self-authored, not imported from game assets",
    }
    return {
        "volume.mask": mask,
        "sprite.pgm": pgm,
        "palette.json": canon(palette),
        "metadata.json": canon(metadata),
    }


def generate(root):
    root = Path(root)
    # Никогда не очищать или перезаписывать существующий каталог.
    if root.exists() or root.is_symlink():
        raise CorpusError("E_R01_OUTPUT_EXISTS")
    root.mkdir(parents=True, exist_ok=False)
    datasets = []
    for kind in IDENTIFIERS:
        directory = root / kind
        directory.mkdir()
        artifacts = []
        for filename, data in sorted(render(kind).items()):
            (directory / filename).write_bytes(data)
            artifacts.append({
                "path": kind + "/" + filename,
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            })
        datasets.append({
            "id": kind,
            "origin": "authored_synthetic",
            "license": "Unlicense",
            "artifacts": artifacts,
        })
    manifest = {
        "schema": "fgm-regenerator/synthetic-corpus-v1",
        "generator": "scripts/generate_r01.py",
        "generator_version": "r01-s1/1",
        "datasets": datasets,
    }
    (root / "manifest.json").write_bytes(canon(manifest))
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Создать собственные синтетические данные R01")
    parser.add_argument("output", help="Новый, ещё не существующий каталог для записи")
    args = parser.parse_args()
    try:
        manifest = generate(args.output)
    except (CorpusError, OSError) as error:
        print("Генерация R01 отклонена:", error, file=sys.stderr)
        return 2
    print(canon({"schema": manifest["schema"], "datasets": [d["id"] for d in manifest["datasets"]]}).decode(), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
