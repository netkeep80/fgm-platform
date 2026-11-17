"""Детерминированный синтез FGM из одной статической части клетки."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PARTS = ("floor", "west_wall", "north_wall", "object")
WIDTH, DEPTH, HEIGHT = 16, 16, 24
SAMPLE_COUNT = WIDTH * DEPTH * HEIGHT
SPRITE_SIZE = 32 * 40


class ReconstructionError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ReconstructionError(message)


def canonical(value):
    # Схема генератора ограничена ASCII, целыми и точными полуцелыми.
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path, schema):
    with path.open("rb") as source:
        raw = source.read(1024 * 1024 + 1)
    require(len(raw) <= 1024 * 1024, "E_R06_INPUT_LIMIT")

    def unique(pairs):
        result = dict(pairs)
        require(len(result) == len(pairs), "E_R06_DUPLICATE_KEY")
        return result

    value = json.loads(raw.decode("utf-8"), object_pairs_hook=unique)
    require(isinstance(value, dict) and value.get("schema") == schema, "E_R06_SCHEMA")
    return value, digest(raw)


def source_observation(loft, sprite, part, slot):
    index = PARTS.index(part)
    require(loft["voxel_dimensions_xyz"] == [WIDTH, DEPTH, HEIGHT]
            and loft["terrain_only"] is True, "E_R06_LAYOUT")
    require(len(loft["sources"]) == len(loft["part_rows"]) == len(PARTS), "E_R06_LAYOUT")
    tile = loft["tile"]["xyz"]
    require(len(tile) == 3 and all(type(value) is int and 0 <= value < 255 for value in tile),
            "E_R06_LAYOUT")
    source = loft["sources"][index]
    require(source["part"] == part and source["present"] is True
            and isinstance(source["dataset_label"], str)
            and re.fullmatch(r"[A-Za-z0-9_-]{1,48}", source["dataset_label"])
            and type(source["local_index"]) is int and source["local_index"] >= 0
            and type(sprite["record"]) is int and sprite["record"] == source["local_index"],
            "E_R06_SOURCE")
    rows = loft["part_rows"][index]
    require(len(rows) == HEIGHT and all(len(level) == DEPTH for level in rows)
            and all(type(row) is int and 0 <= row < 65536 for level in rows for row in level),
            "E_R06_LAYOUT")
    require(sprite["width"] == 32 and sprite["height"] == 40, "E_R06_LAYOUT")
    slots = sprite["mcd_frame_slots"]
    require(len(slots) == 8 and all(type(value) is int and 0 <= value < 256 for value in slots),
            "E_R06_FRAME")
    frames = [frame for frame in sprite["frames"] if frame["id"] == slots[slot]]
    require(len(frames) == 1, "E_R06_FRAME")
    raster = bytes.fromhex(frames[0]["indices_hex"])
    alpha = bytes.fromhex(frames[0]["alpha_hex"])
    require(len(raster) == SPRITE_SIZE and alpha == bytes(255 if value else 0 for value in raster),
            "E_R06_FRAME")

    occupied = {(x, y, z) for z, level in enumerate(rows) for y, row in enumerate(level)
                for x in range(WIDTH) if row & (1 << (WIDTH - 1 - x))}
    identity = {key: source[key] for key in ("dataset_label", "local_index", "part")}
    right_half = part == "north_wall" and loft["sources"][1]["present"] is True
    return occupied, rows, identity, tile, raster, slots[slot], right_half


def boxes(occupied):
    remaining = occupied.copy()
    for x, y, z in sorted(occupied, key=lambda p: (p[2], p[1], p[0])):
        if (x, y, z) not in remaining:
            continue
        x_end, y_end, z_end = x + 1, y + 1, z + 1
        while (x_end, y, z) in remaining:
            x_end += 1
        while all((column, y_end, z) in remaining for column in range(x, x_end)):
            y_end += 1
        while all((column, row, z_end) in remaining for row in range(y, y_end)
                  for column in range(x, x_end)):
            z_end += 1
        for layer in range(z, z_end):
            for row in range(y, y_end):
                for column in range(x, x_end):
                    remaining.remove((column, row, layer))
        yield (x, y, z), (x_end, y_end, z_end)


def half(value):
    return value // 2 if value % 2 == 0 else value / 2


def package(bounds, material, observation):
    nodes, level = [], []
    if not bounds:
        # Вычитание формы из неё самой даёт поле без отрицательной области.
        nodes.extend([
            {"id": "extent", "op": "constant", "type": "vec3", "value": [1, 1, 1]},
            {"id": "box", "op": "box", "halfSize": "extent"},
            {"id": "empty", "op": "subtract", "left": "box", "right": "box"},
        ])
        level.append("empty")
    for i, (begin, end) in enumerate(bounds):
        extent, offset, box, moved = (f"{name}_{i}" for name in ("extent", "offset", "box", "move"))
        nodes.extend([
            {"id":extent, "op":"constant", "type":"vec3", "value":[half(b-a) for a,b in zip(begin,end)]},
            {"id":offset, "op":"constant", "type":"vec3", "value":[half(a+b) for a,b in zip(begin,end)]},
            {"id":box, "op":"box", "halfSize":extent},
            {"id":moved, "op":"translate", "field":box, "offset":offset},
        ])
        level.append(moved)
    merge_id = 0
    while len(level) > 1:
        parents = []
        for i in range(0, len(level) - 1, 2):
            name = f"union_{merge_id}"
            nodes.append({"id":name, "op":"union", "left":level[i], "right":level[i+1]})
            parents.append(name)
            merge_id += 1
        if len(level) % 2:
            parents.append(level[-1])
        level = parents

    generation = {"algorithm":"r06_loft_boxes", "version":"1.0.0", "parameters":{},
                  "resources":{"loft_observation":digest(canonical(observation))}}
    seed = digest(canonical(["fgm:seed:1", {"generation":generation, "purpose":"model"}]))
    program = {"version":"fgm-0", "nodes":nodes, "root":level[0]}
    return canonical({
        "format":"fgm-package/1", "interpreter":"fgm-0/1", "generation":generation,
        "model":{"seed":seed, "volumes":{}, "contributions":[
            {"id":"terrain", "material":material, "priority":0,
             "field":{"op":"program", "program":program, "parameters":{}}} ]},
    })


FACES = (
    ((-1,0,0), ((0,0,0),(0,0,1),(0,1,1),(0,1,0))),
    ((1,0,0), ((1,0,0),(1,1,0),(1,1,1),(1,0,1))),
    ((0,-1,0), ((0,0,0),(1,0,0),(1,0,1),(0,0,1))),
    ((0,1,0), ((0,1,0),(0,1,1),(1,1,1),(1,1,0))),
    ((0,0,-1), ((0,0,0),(0,1,0),(1,1,0),(1,0,0))),
    ((0,0,1), ((0,0,1),(1,0,1),(1,1,1),(0,1,1))),
)


def mesh(occupied):
    indices, faces = {}, []
    for x, y, z in sorted(occupied):
        for (dx, dy, dz), corners in FACES:
            if (x + dx, y + dy, z + dz) in occupied:
                continue
            vertices = [indices.setdefault((x+a,y+b,z+c), len(indices)+1) for a,b,c in corners]
            faces.append("f " + " ".join(map(str, vertices)))
    vertices = [f"v {x} {y} {z}" for x, y, z in indices]
    return ("\n".join(["o terrain", *vertices, *faces]) + "\n").encode("ascii")


def validate(sampler, model, raster, material, p_level, right_half):
    with tempfile.TemporaryDirectory(prefix="fgmr-r06-") as tmp:
        root = Path(tmp)
        program, pixels = root/"model.json", root/"pixels"
        program.write_bytes(model)
        pixels.write_bytes(raster)
        result = subprocess.run([str(sampler.resolve()), program, pixels, material,
                                 str(p_level), str(int(right_half))],
                                capture_output=True, timeout=60, check=False)
    require(result.returncode == 0, "E_R06_EVALUATOR")
    mask, common, predicted, observed = result.stdout.decode("ascii").split()
    require(len(mask) == SAMPLE_COUNT and set(mask) <= {"0", "1"}, "E_R06_EVALUATOR")
    occupied = {(i % WIDTH, i // WIDTH % DEPTH, i // (WIDTH * DEPTH))
                for i, value in enumerate(mask) if value == "1"}
    return occupied, {"common":int(common), "predicted_only":int(predicted), "observed_only":int(observed)}


def reconstruct(args):
    require(re.fullmatch(r"[a-z][a-z0-9_]*", args.material), "E_R06_MATERIAL")
    require(0 <= args.p_level <= 255, "E_R06_P_LEVEL")
    loft, loft_hash = load(args.loft, "fgm-regenerator/loft-terrain-v1")
    sprite, sprite_hash = load(args.sprite, "fgm-regenerator/sprite-facts-v1")
    occupied, rows, identity, tile, pixels, frame, right_half = source_observation(
        loft, sprite, args.part, args.slot)
    bounds = list(boxes(occupied))
    model = package(bounds, args.material, {"source":identity, "rows":rows, "material":args.material})
    evaluated, counts = validate(args.sampler, model, pixels, args.material, args.p_level, right_half)
    require(evaluated == occupied, "E_R06_COLLISION_DIVERGENCE")
    report = canonical({
        "schema":"fgm-regenerator/reconstruction-v1", "source":identity,
        "input_sha256":{"loft_json":loft_hash, "sprite_json":sprite_hash},
        "package_bytes_sha256":digest(model), "tile":tile,
        "material":args.material, "occupied":len(evaluated), "boxes":len(bounds),
        "voxel_checks":SAMPLE_COUNT, "silhouette":counts, "frame_id":frame,
        "slot":args.slot, "p_level":args.p_level, "right_half":right_half,
        "hidden_surface_confidence":None,
    })
    preview = mesh(evaluated)
    # RV01: свидетельство связи C05-проверенного пакета, LOFT и точного OBJ.
    # Это hash/provenance receipt, не цифровая подпись и не второй FGM-интерпретатор.
    receipt = canonical({
        "schema": "fgmr-r06-view-proof/1",
        "producer": "reconstruct_r06.py/1.0.0",
        "evaluation": "fgmr-r06-sample/C05",
        "geometry": "r06_voxel_boundary_obj/1",
        "model_sha256": digest(model),
        "mesh_sha256": digest(preview),
        "report_sha256": digest(report),
        "source_loft_sha256": loft_hash,
        "source_sprite_sha256": sprite_hash,
        "occupied": len(evaluated),
        "voxels_checked": SAMPLE_COUNT,
        "coordinate_frame": {"axes": ["x", "y", "z"], "unit": "loft-voxel", "scale": 1},
    })
    args.output.mkdir(exist_ok=False)
    created = []
    try:
        for name, payload in (("model.fgm.json", model), ("preview.obj", preview), ("report.json", report),
                              ("viewer-proof.json", receipt)):
            path = args.output / name
            with path.open("xb") as output:
                created.append(path)
                output.write(payload)
    except OSError:
        for path in created:
            path.unlink(missing_ok=True)
        args.output.rmdir()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("loft", "sprite", "sampler", "output"):
        parser.add_argument(f"--{key}", type=Path, required=True)
    parser.add_argument("--part", choices=PARTS, required=True)
    parser.add_argument("--material", required=True)
    parser.add_argument("--slot", type=int, choices=range(8), required=True)
    parser.add_argument("--p-level", type=int, required=True)
    try:
        reconstruct(parser.parse_args())
    except (ReconstructionError, ValueError, TypeError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        print("R06:", error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
