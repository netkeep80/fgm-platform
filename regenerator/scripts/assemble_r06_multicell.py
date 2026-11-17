#!/usr/bin/env python3
"""R06-S2B2: one FGM volume from B1-verified multi-cell LOFT observations."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

import reconstruct_r06 as r06
import verify_r06_membership as source_verifier

SCHEMA = "fgm-regenerator/verified-membership-input-v1"
SLICES_SCHEMA = "fgm-regenerator/slice-by-cell-v1"
SAMPLING_SCHEMA = "fgm-regenerator/whole-object-sampling-v1"
MAX_CELLS = 8
MAX_LOFT_BYTES = 1024 * 1024
MAX_RECEIPT_BYTES = 1024 * 1024
MAX_PROGRAM_BYTES = 4 * 1024 * 1024
MAX_BOXES = 8192
MAX_COORD = 16
MATERIAL = re.compile(r"[a-z][a-z0-9_]*")


def fail(condition, code):
    if not condition:
        raise r06.ReconstructionError(code)


def ints3(value, *, lower, upper):
    fail(isinstance(value, list) and len(value) == 3
         and all(type(v) is int and lower <= v <= upper for v in value),
         "E_S2B2_COORDINATES")
    return tuple(value)


def rows_to_voxels(rows):
    fail(isinstance(rows, list) and len(rows) == r06.HEIGHT,
         "E_S2B2_LOFT_ROWS")
    occupied = set()
    for z, layer in enumerate(rows):
        fail(isinstance(layer, list) and len(layer) == r06.DEPTH,
             "E_S2B2_LOFT_ROWS")
        for y, bits in enumerate(layer):
            fail(type(bits) is int and 0 <= bits < 65536,
                 "E_S2B2_LOFT_ROWS")
            for x in range(r06.WIDTH):
                if bits & (1 << (15 - x)):
                    occupied.add((x, y, z))
    return occupied


def expected_mask(occupied):
    return "".join("1" if (x, y, z) in occupied else "0"
                   for z in range(r06.HEIGHT)
                   for y in range(r06.DEPTH)
                   for x in range(r06.WIDTH))


def validate_receipt(receipt):
    fail(isinstance(receipt, dict) and receipt.get("schema") == SCHEMA
         and receipt.get("status") == "verified_explicit_membership",
         "E_S2B2_MEMBERSHIP")
    fail(isinstance(receipt.get("instance"), str)
         and isinstance(receipt.get("prototype"), str)
         and isinstance(receipt.get("provenance"), dict),
         "E_S2B2_MEMBERSHIP")
    anchor = ints3(receipt.get("anchor_xyz"), lower=-255, upper=254)
    bindings = receipt.get("cell_bindings")
    fail(isinstance(bindings, list) and 2 <= len(bindings) <= MAX_CELLS,
         "E_S2B2_SCOPE")
    seen = set()
    parsed = []
    tile_seen = set()
    for binding in bindings:
        fail(isinstance(binding, dict), "E_S2B2_MEMBERSHIP")
        xyz = ints3(binding.get("xyz"), lower=0, upper=254)
        local = ints3(binding.get("local_xyz"), lower=-MAX_COORD, upper=MAX_COORD)
        fail(local == tuple(x - a for x, a in zip(xyz, anchor, strict=True)),
             "E_S2B2_BINDING")
        part = binding.get("part")
        dataset = binding.get("dataset")
        record = binding.get("record")
        map_record = binding.get("map_record")
        fail(part in r06.PARTS and isinstance(dataset, str)
             and re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", dataset) is not None
             and type(record) is int and 0 <= record <= 65535
             and type(map_record) is int and 0 <= map_record <= 16777216,
             "E_S2B2_BINDING")
        fail((xyz, part) not in seen, "E_S2B2_DUPLICATE")
        seen.add((xyz, part))
        tile_seen.add(xyz)
        parsed.append({"xyz": xyz, "local": local, "part": part,
                       "dataset": dataset, "record": record, "map_record": map_record})
    fail(len(tile_seen) == len(parsed), "E_S2B2_SCOPE")
    return sorted(parsed, key=lambda v: (v["xyz"], v["part"]))


def read_lofts(paths, bindings):
    expected_tiles = {b["xyz"] for b in bindings}
    lofts = {}
    loft_sha = {}
    for path in paths:
        loft, sha = r06.load(path, "fgm-regenerator/loft-terrain-v1")
        fail(loft.get("voxel_dimensions_xyz") == [16, 16, 24]
             and loft.get("terrain_only") is True,
             "E_S2B2_LOFT_LAYOUT")
        tile = loft.get("tile", {})
        fail(isinstance(tile, dict), "E_S2B2_LOFT_LAYOUT")
        xyz = ints3(tile.get("xyz"), lower=0, upper=254)
        fail(xyz in expected_tiles and xyz not in lofts,
             "E_S2B2_EXTRA_LOFT")
        lofts[xyz] = loft
        loft_sha[xyz] = sha
    fail(set(lofts) == expected_tiles, "E_S2B2_MISSING_LOFT")
    return lofts, loft_sha


def assemble(receipt, lofts, hashes, material, receipt_sha):
    bindings = validate_receipt(receipt)
    expected_tiles = {b["xyz"] for b in bindings}
    fail(set(lofts) == expected_tiles, "E_S2B2_MISSING_LOFT")
    whole = set()
    evidence = []
    expected = []
    for binding in bindings:
        loft = lofts[binding["xyz"]]
        fail(loft["tile"].get("record_index") == binding["map_record"],
             "E_S2B2_LOFT_BINDING")
        sources, rows = loft.get("sources"), loft.get("part_rows")
        fail(isinstance(sources, list) and len(sources) == len(r06.PARTS)
             and isinstance(rows, list) and len(rows) == len(r06.PARTS),
             "E_S2B2_LOFT_LAYOUT")
        part = binding["part"]
        source = sources[r06.PARTS.index(part)]
        fail(isinstance(source, dict) and source.get("part") == part
             and source.get("present") is True
             and source.get("dataset_label") == binding["dataset"]
             and source.get("local_index") == binding["record"],
             "E_S2B2_LOFT_BINDING")
        occupied = rows_to_voxels(rows[r06.PARTS.index(part)])
        offset = tuple(coord * size for coord, size in
                       zip(binding["local"], (16, 16, 24), strict=True))
        transformed = {(x + offset[0], y + offset[1], z + offset[2])
                       for x, y, z in occupied}
        fail(whole.isdisjoint(transformed), "E_S2B2_OVERLAP")
        whole.update(transformed)
        expected.append((binding, expected_mask(occupied)))
        evidence.append({"xyz": list(binding["xyz"]), "part": part,
                         "source_sha256": hashes[binding["xyz"]],
                         "occupancy_sha256": r06.digest(expected[-1][1].encode("ascii")),
                         "occupied": len(occupied)})
    fail(bool(whole), "E_S2B2_EMPTY")
    bounds = list(r06.boxes(whole))
    fail(len(bounds) <= MAX_BOXES, "E_S2B2_LIMIT")
    observation = {"receipt_sha256": receipt_sha, "cells": evidence,
                   "coordinate_unit": "loft-voxel", "grid": [16, 16, 24]}
    package = json.loads(r06.package(bounds, material, observation))
    generation = {"algorithm": "r06_multicell_loft_boxes", "version": "0.1.0",
                  "parameters": {"cell_xyz": [16, 16, 24]},
                  "resources": {"membership": receipt_sha,
                                "loft_observations": r06.digest(r06.canonical(evidence)),
                                "material_sha256": r06.digest(r06.canonical(material))}}
    package["generation"] = generation
    package["model"]["seed"] = r06.digest(r06.canonical(
        ["fgm:seed:1", {"generation": generation, "purpose": "model"}]))
    package["model"]["contributions"][0]["id"] = "whole_object"
    model = r06.canonical(package)
    fail(len(model) <= MAX_PROGRAM_BYTES, "E_S2B2_LIMIT")
    return model, whole, expected, evidence, len(bounds)


def sample_global(sampler, model, expected, material):
    request = r06.canonical({"schema": SAMPLING_SCHEMA,
                             "cells": [{"local_xyz": list(b["local"])}
                                       for b, _ in expected]})
    with tempfile.TemporaryDirectory(prefix="fgmr-r06-whole-") as tmp:
        root = Path(tmp)
        model_file, req_file = root / "model.fgm.json", root / "cells.json"
        model_file.write_bytes(model)
        req_file.write_bytes(request)
        result = subprocess.run([str(sampler.resolve()), str(model_file),
                                 str(req_file), material],
                                capture_output=True, timeout=60, check=False)
    fail(result.returncode == 0 and len(result.stdout) <= 1024 * 1024,
         "E_S2B2_C05")
    try:
        obj = json.loads(result.stdout, object_pairs_hook=lambda pairs: unique(pairs))
    except (ValueError, UnicodeDecodeError) as error:
        raise r06.ReconstructionError("E_S2B2_C05") from error
    fail(isinstance(obj, dict) and obj.get("schema") == SAMPLING_SCHEMA
         and isinstance(obj.get("cells"), list)
         and len(obj["cells"]) == len(expected), "E_S2B2_C05")
    slices = []
    for (binding, mask), actual in zip(expected, obj["cells"], strict=True):
        fail(actual.get("local_xyz") == list(binding["local"])
             and actual.get("mask") == mask, "E_S2B2_C05_MISMATCH")
        rows = []
        for z in range(24):
            rows.append([sum((1 << (15-x)) for x in range(16)
                             if mask[(z*16+y)*16+x] == "1")
                         for y in range(16)])
        slices.append({"xyz": list(binding["xyz"]), "local_xyz": list(binding["local"]),
                       "part": binding["part"], "rows": rows,
                       "occupied": mask.count("1")})
    return slices


def unique(pairs):
    result = dict(pairs)
    fail(len(result) == len(pairs), "E_S2B2_DUPLICATE")
    return result


def run(args):
    fail(MATERIAL.fullmatch(args.material) is not None, "E_S2B2_MATERIAL")
    receipt, receipt_sha = r06.load(args.verified, SCHEMA)
    fail(receipt_sha == args.verified_sha256, "E_S2B2_RECEIPT_SHA")
    bindings = validate_receipt(receipt)
    lofts, hashes = read_lofts(args.loft, bindings)
    model, whole, expected, evidence, boxes = assemble(
        receipt, lofts, hashes, args.material, receipt_sha)
    with source_verifier.pinned_r02(args.sampler, args.sampler_sha256) as (pinned, _sha):
        slices = sample_global(pinned, model, expected, args.material)
    preview = r06.mesh(whole)
    slice_bytes = r06.canonical({"schema": SLICES_SCHEMA,
                                 "instance": receipt["instance"],
                                 "cells": slices})
    report = r06.canonical({
        "schema": "fgm-regenerator/whole-object-report-v1",
        "instance": receipt["instance"], "prototype": receipt["prototype"],
        "membership_sha256": receipt_sha,
        "model_sha256": r06.digest(model),
        "preview_sha256": r06.digest(preview),
        "slices_sha256": r06.digest(slice_bytes),
        "cell_bindings": evidence, "boxes": boxes,
        "occupied": len(whole),
        "checked_centers": len(expected) * r06.SAMPLE_COUNT,
        "surface": "global_voxel_boundary_no_internal_faces",
        "scope": "static_explicit_single_part_per_tile"
    })
    args.output.mkdir(exist_ok=False)
    files = [("model.fgm.json", model), ("slices.json", slice_bytes),
             ("preview.obj", preview), ("report.json", report)]
    try:
        for name, payload in files:
            (args.output / name).write_bytes(payload)
    except OSError:
        for name, _ in files:
            (args.output / name).unlink(missing_ok=True)
        args.output.rmdir()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified", type=Path, required=True)
    parser.add_argument("--verified-sha256", required=True)
    parser.add_argument("--loft", type=Path, action="append", required=True)
    parser.add_argument("--sampler", type=Path, required=True)
    parser.add_argument("--sampler-sha256", required=True)
    parser.add_argument("--material", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        run(args)
    except (r06.ReconstructionError, OSError, TypeError, ValueError, KeyError,
            IndexError, subprocess.TimeoutExpired):
        print("R06-S2B2: E_WHOLE_OBJECT", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
