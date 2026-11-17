#!/usr/bin/env python3
"""R07-S1B1B1A: ограниченный синтетический joint-fit одной whole-FGM.

Только независимые синтетические наблюдения. Не является R03/B1 source binding,
не принимает исходные данные UFO и не подтверждает Stage A.
"""
import argparse
import copy
import ctypes
import errno
import hashlib
from itertools import product
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

SCHEMA = "fgmr-r07-whole-joint-synthetic-request/1"
RECEIPT = "fgmr-r07-whole-joint-synthetic-receipt/1"
DELTAS = (-0.98, -0.49, 0.0, 0.49, 0.98)
AXIS_VECTORS = tuple(product((-0.49, 0.0, 0.49), repeat=3))
SHA = re.compile(r"[0-9a-f]{64}\Z")
C05_ERROR = "R07-S1B1B0: E_B0_C05_ALL_CELLS_MISMATCH\n"
C05_EXACT_STDERR = (C05_ERROR.encode("ascii"),
                    C05_ERROR.replace("\n", "\r\n").encode("ascii"))
MAX_INPUT = 4 * 1024 * 1024
MAX_MODEL = 4 * 1024 * 1024
MIN_EXTENT = 0.5
MAX_EXTENT = 512
MAX_OFFSET = 10000


class FitError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise FitError(code)


def canonical(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
                      allow_nan=False).encode("utf-8")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique_object(pairs):
    obj = {}
    for key, val in pairs:
        need(key not in obj, "E_B1_DUPLICATE_JSON_KEY")
        obj[key] = val
    return obj


def parse(data, code):
    try:
        return json.loads(data, object_pairs_hook=unique_object,
                          parse_constant=lambda _: need(False, code))
    except (ValueError, UnicodeError, TypeError) as exc:
        raise FitError(code) from exc


def fields(obj, keys, code):
    need(type(obj) is dict and set(obj) == set(keys), code)


def pinned_path(path, maximum, expected, code):
    need(type(expected) is str and SHA.fullmatch(expected), code)
    need(not any(p.is_symlink() for p in (path, *path.parents)), code)
    need(path.is_file() and 0 < path.stat().st_size <= maximum, code)
    content = path.read_bytes()
    need(sha(content) == expected, code)
    return content


def triple(value, lo, hi, code):
    need(type(value) is list and len(value) == 3 and
         all(type(v) is int and lo <= v <= hi for v in value), code)
    return tuple(value)


def pixels(value, code):
    need(type(value) is list and len(value) <= 1280, code)
    seen = set()
    for value_pair in value:
        need(type(value_pair) is list and len(value_pair) == 2 and
             all(type(v) is int and -100000 <= v <= 100000 for v in value_pair), code)
        pair = tuple(value_pair)
        need(pair not in seen, code)
        seen.add(pair)
    return seen


def score(prediction, observed):
    common, union = len(prediction & observed), len(prediction | observed)
    return {"common": common, "union": union, "predicted": len(prediction),
            "observed": len(observed)}


def micro(scores):
    return {"common": sum(s["common"] for s in scores),
            "union": sum(s["union"] for s in scores)}


def nonworse(a, b):
    if a["union"] == 0 or b["union"] == 0:
        return a["union"] == b["union"] == 0
    return a["common"] * b["union"] >= b["common"] * a["union"]


def boundary(points):
    return {p for p in points if any((p[0] + dx, p[1] + dy) not in points
                                     for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)))}


def contour(a, b):
    if not a or not b:
        return None
    aa, bb = boundary(a), boundary(b)
    return sum(min(abs(x-u)+abs(y-v) for u, v in bb) for x, y in aa) + \
        sum(min(abs(x-u)+abs(y-v) for u, v in aa) for x, y in bb)


def better(now, prior):
    a, b = now["micro"], prior["micro"]
    need(a["union"] > 0 and b["union"] > 0, "E_B1_EMPTY_OBSERVATION")
    left, right = a["common"] * b["union"], b["common"] * a["union"]
    if left != right:
        return left > right
    return now["contour"] is not None and prior["contour"] is not None and \
        now["contour"] < prior["contour"]


def inspect_model(data, material, membership_sha):
    need(0 < len(data) <= MAX_MODEL, "E_B1_MODEL_SIZE")
    doc = parse(data, "E_B1_MODEL_JSON")
    need(canonical(doc) == data, "E_B1_MODEL_NOT_CANONICAL")
    fields(doc, ("format", "interpreter", "generation", "model"), "E_B1_GRAMMAR")
    need(doc["format"] == "fgm-package/1" and doc["interpreter"] == "fgm-0/1",
         "E_B1_GRAMMAR")
    gen, model = doc["generation"], doc["model"]
    fields(gen, ("algorithm", "version", "parameters", "resources"), "E_B1_GRAMMAR")
    need(gen["algorithm"] == "r06_multicell_loft_boxes" and gen["version"] == "0.1.0" and
         gen["parameters"] == {"cell_xyz": [16, 16, 24]}, "E_B1_GRAMMAR")
    fields(gen["resources"], ("membership", "loft_observations", "material_sha256"),
           "E_B1_GRAMMAR")
    need(gen["resources"]["membership"] == membership_sha and
         type(gen["resources"]["loft_observations"]) is str and
         SHA.fullmatch(gen["resources"]["loft_observations"]) and
         gen["resources"]["material_sha256"] == sha(canonical(material)), "E_B1_PROVENANCE")
    fields(model, ("seed", "volumes", "contributions"), "E_B1_GRAMMAR")
    need(model["volumes"] == {} and type(model["contributions"]) is list and
         len(model["contributions"]) == 1 and
         model["seed"] == sha(canonical(["fgm:seed:1", {"generation": gen, "purpose": "model"}])),
         "E_B1_GRAMMAR")
    contribution = model["contributions"][0]
    fields(contribution, ("id", "material", "priority", "field"), "E_B1_GRAMMAR")
    need(contribution["id"] == "whole_object" and contribution["material"] == material and
         type(contribution["priority"]) is int and contribution["priority"] == 0,
         "E_B1_GRAMMAR")
    field = contribution["field"]
    fields(field, ("op", "program", "parameters"), "E_B1_GRAMMAR")
    need(field["op"] == "program" and field["parameters"] == {}, "E_B1_GRAMMAR")
    program = field["program"]
    fields(program, ("version", "nodes", "root"), "E_B1_GRAMMAR")
    nodes = program["nodes"]
    need(program["version"] == "fgm-0" and type(nodes) is list and
         4 <= len(nodes) <= 768, "E_B1_GRAMMAR")
    ids = [node.get("id") for node in nodes if type(node) is dict]
    need(len(ids) == len(nodes) and len(set(ids)) == len(ids), "E_B1_GRAMMAR")
    count = next((i for i in range(1, 129) if
                  4*i + i-1 == len(nodes)), None)
    need(count is not None, "E_B1_GRAMMAR")
    for i in range(count):
        extent, offset, box, move = nodes[i*4:i*4+4]
        e, o, b, m = (f"extent_{i}", f"offset_{i}", f"box_{i}", f"move_{i}")
        fields(extent, ("id", "op", "type", "value"), "E_B1_GRAMMAR")
        fields(offset, ("id", "op", "type", "value"), "E_B1_GRAMMAR")
        need(extent["id"] == e and extent["op"] == "constant" and
             extent["type"] == "vec3" and offset["id"] == o and
             offset["op"] == "constant" and offset["type"] == "vec3", "E_B1_GRAMMAR")
        need(type(extent["value"]) is list and len(extent["value"]) == 3 and
             all(type(x) in (int, float) and math.isfinite(x) and MIN_EXTENT <= x <= MAX_EXTENT
                 for x in extent["value"]), "E_B1_GRAMMAR")
        need(type(offset["value"]) is list and len(offset["value"]) == 3 and
             all(type(x) in (int, float) and math.isfinite(x) and abs(x) <= MAX_OFFSET
                 and 2*x == int(2*x) for x in offset["value"]), "E_B1_GRAMMAR")
        need(box == {"id": b, "op": "box", "halfSize": e} and
             move == {"id": m, "op": "translate", "field": b, "offset": o},
             "E_B1_GRAMMAR")
    level = [f"move_{i}" for i in range(count)]
    union_index = 0
    pos = 4*count
    while len(level) > 1:
        nxt = []
        for i in range(1, len(level), 2):
            target = f"union_{union_index}"
            need(nodes[pos] == {"id": target, "op": "union",
                                "left": level[i-1], "right": level[i]},
                 "E_B1_GRAMMAR")
            nxt.append(target)
            pos += 1
            union_index += 1
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt
    need(pos == len(nodes) and program["root"] == level[0], "E_B1_GRAMMAR")
    return doc, count


def candidate(baseline, count, delta, original_bytes, *, kind="isotropic_extent"):
    if delta == 0:
        return original_bytes
    translation = kind == "axis_translation"
    adjustments = (delta,) * 3 if kind == "isotropic_extent" else delta
    low, high = (-MAX_OFFSET, MAX_OFFSET) if translation else (MIN_EXTENT, MAX_EXTENT)
    payload = copy.deepcopy(baseline)
    nodes = payload["model"]["contributions"][0]["field"]["program"]["nodes"]
    for i in range(count):
        node = nodes[4*i + int(translation)]
        replacement = [round(value + change, 3) if change else value
                       for value, change in zip(node["value"], adjustments, strict=True)]
        if any(not low <= x <= high for x in replacement):
            return None
        node["value"] = replacement
    gen = payload["generation"]
    algorithm, parameter = {
        "isotropic_extent": ("r07_s1b1b1a_joint_extent", "delta"),
        "axis_extent": ("r07_s1b1b1c_joint_xyz_extent", "delta_xyz"),
        "axis_translation": ("r07_s1b1b1c_joint_xyz_offset", "offset_xyz"),
    }[kind]
    gen["algorithm"] = algorithm
    gen["version"] = "0.1.0"
    gen["parameters"] = {parameter: delta}
    gen["resources"]["baseline_package"] = sha(original_bytes)
    payload["model"]["seed"] = sha(canonical(
        ["fgm:seed:1", {"generation": gen, "purpose": "model"}]))
    result = canonical(payload)
    need(len(result) <= MAX_MODEL, "E_B1_MODEL_SIZE")
    return result


def inspect_request(request):
    fields(request, ("schema", "baseline_package", "baseline_sha256",
                     "membership_sha256", "material", "cells", "synthetic_only"),
           "E_B1_REQUEST")
    need(request["schema"] == SCHEMA and request["synthetic_only"] is True,
         "E_B1_SYNTHETIC_ONLY")
    package = request["baseline_package"]
    need(type(package) is str and type(request["baseline_sha256"]) is str and
         SHA.fullmatch(request["baseline_sha256"]) and
         sha(package.encode()) == request["baseline_sha256"], "E_B1_BASELINE_SHA")
    return package.encode(), request["material"], request["membership_sha256"], request["cells"]


def inspect_inputs(package, material, membership, cells):
    need(type(material) is str and re.fullmatch(r"[a-z][a-z0-9_]{0,15}", material),
         "E_B1_MATERIAL")
    need(type(membership) is str and SHA.fullmatch(membership), "E_B1_MEMBERSHIP")
    base, count = inspect_model(package, material, membership)
    need(type(cells) is list and 2 <= len(cells) <= 8, "E_B1_CELLS")
    anchors, world_seen, local_seen, observed_count = set(), set(), set(), 0
    for item in cells:
        fields(item, ("tile", "local_xyz", "reference_rows", "reference_rows_sha256",
                      "p_level", "right_half", "observed_pixels_xy",
                      "observed_sha256"), "E_B1_CELL")
        world = triple(item["tile"], 0, 254, "E_B1_COORD")
        local = triple(item["local_xyz"], -16, 16, "E_B1_COORD")
        need(world not in world_seen and local not in local_seen, "E_B1_DUPLICATE")
        anchors.add(tuple(a-b for a, b in zip(world, local)))
        world_seen.add(world)
        local_seen.add(local)
        rows = item["reference_rows"]
        need(type(rows) is list and len(rows) == 384 and
             all(type(x) is int and 0 <= x <= 65535 for x in rows) and
             item["reference_rows_sha256"] == sha(canonical(rows)), "E_B1_ROWS")
        need(type(item["p_level"]) is int and 0 <= item["p_level"] <= 255 and
             type(item["right_half"]) is bool, "E_B1_CAMERA")
        obs = item["observed_pixels_xy"]
        if obs is None:
            need(item["observed_sha256"] is None, "E_B1_OBSERVATION")
        else:
            points = pixels(obs, "E_B1_OBSERVATION")
            need(points and item["observed_sha256"] == sha(canonical(obs)),
                 "E_B1_OBSERVATION")
            observed_count += 1
    need(len(anchors) == 1, "E_B1_ANCHOR")
    need(observed_count >= 2, "E_B1_INSUFFICIENT_OBSERVATIONS")
    return base, count


def native_observe(binary, model, material, cells, candidate_delta):
    clean = [{key: cell[key] for key in ("tile", "local_xyz", "reference_rows",
                                        "p_level", "right_half")} for cell in cells]
    request = {"schema": "fgmr-r07-whole-surface-request/1",
               "package": model.decode(), "package_sha256": sha(model),
               "material": material, "cells": clean}
    data = canonical(request)
    need(len(data) <= 5*1024*1024, "E_B1_NATIVE_INPUT_LIMIT")
    try:
        run = subprocess.run([str(binary)], input=data, capture_output=True,
                             timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise FitError("E_B1_NATIVE_UNAVAILABLE") from exc
    if run.returncode == 2 and run.stdout == b"" and \
            run.stderr in C05_EXACT_STDERR and candidate_delta != 0:
        return None
    if run.returncode != 0 or run.stderr:
        # Diagnostics are restricted to the B0's typed public error identifiers.
        reason = run.stderr.decode("ascii", errors="replace").strip()
        code = reason.removeprefix("R07-S1B1B0: ")
        if re.fullmatch(r"E_B0_[A-Z0-9_]{1,64}", code):
            raise FitError("E_B1_NATIVE_FAILURE_" + code)
        raise FitError("E_B1_NATIVE_FAILURE")
    need(0 < len(run.stdout) <= 1024*1024, "E_B1_NATIVE_FAILURE")
    doc = parse(run.stdout, "E_B1_NATIVE_JSON")
    fields(doc, ("schema", "model_sha256", "material", "c05", "raster", "cells"),
           "E_B1_NATIVE_PROTOCOL")
    need(doc["schema"] == "fgmr-r07-whole-surface-observation/1" and
         doc["model_sha256"] == sha(model) and doc["material"] == material and
         doc["c05"] == {"checked": 6144*len(cells), "match": True,
                        "scope": "voxel_centers_only"} and
         doc["raster"] == {"algorithm": "r07-whole-cell-center-rays/1",
                           "r05_camera": "r05-ufo-dimetric/1",
                           "step_voxels": 0.125,
                           "completeness":
                           "UNRESOLVED_THIN_FEATURES_AND_CROSS_CELL_OCCLUSION"} and
         type(doc["cells"]) is list and len(doc["cells"]) == len(cells),
         "E_B1_NATIVE_PROTOCOL")
    all_predictions = []
    for response, cell in zip(doc["cells"], cells):
        fields(response, ("tile", "local_xyz", "reference_rows_sha256", "c05_checked",
                          "surface_pixels", "surface_pixels_xy", "surface_mask_sha256",
                          "rays", "surface_samples"), "E_B1_NATIVE_CELL")
        pred = pixels(response["surface_pixels_xy"], "E_B1_NATIVE_PIXELS")
        need(response["tile"] == cell["tile"] and
             response["local_xyz"] == cell["local_xyz"] and
             response["reference_rows_sha256"] == cell["reference_rows_sha256"] and
             response["c05_checked"] == 6144 and
             response["surface_pixels"] == len(pred) and
             response["surface_mask_sha256"] == sha(canonical(response["surface_pixels_xy"])) and
             type(response["rays"]) is int and 0 <= response["rays"] <= 1280 and
             type(response["surface_samples"]) is int and
             0 <= response["surface_samples"] <= 200000,
             "E_B1_NATIVE_CELL")
        all_predictions.append(pred)
    return all_predictions


def evaluate(predictions, cells):
    scores, contours = [], []
    for pred, cell in zip(predictions, cells):
        if cell["observed_pixels_xy"] is None:
            continue
        observed = pixels(cell["observed_pixels_xy"], "E_B1_OBSERVATION")
        scores.append(score(pred, observed))
        contours.append(contour(pred, observed))
    need(len(scores) >= 2, "E_B1_INSUFFICIENT_OBSERVATIONS")
    return {"cells": scores, "micro": micro(scores),
            "contour": sum(contours) if all(x is not None for x in contours) else None}


def check_output(output):
    need(not output.exists() and not output.is_symlink(), "E_B1_OUTPUT_EXISTS")
    need(output.parent.is_dir() and not output.parent.is_symlink(), "E_B1_OUTPUT_PARENT")


def fit(package, material, membership, cells, binary, binary_sha, work_dir, *, axis_fit=False):
    base, count = inspect_inputs(package, material, membership, cells)
    transforms = [("isotropic_extent", delta) for delta in DELTAS if delta]
    if axis_fit:
        transforms.extend(("axis_extent", d) for d in AXIS_VECTORS if len(set(d)) > 1)
        transforms.extend(("axis_translation", d) for d in AXIS_VECTORS if any(d))
    # Read the executable only after all cheap input validation.
    content = pinned_path(binary, 16*1024*1024, binary_sha, "E_B1_NATIVE_SHA")
    # Use a private copy, not a changing external binary between candidates.
    with tempfile.TemporaryDirectory(prefix=".r07-joint-native-", dir=work_dir) as d:
        isolated = Path(d) / ("fgmr-r07-whole-surface.exe" if binary.suffix.lower() == ".exe"
                              else "fgmr-r07-whole-surface")
        isolated.write_bytes(content)
        isolated.chmod(0o700)
        reference = native_observe(isolated, package, material, cells, 0)
        need(reference is not None, "E_B1_BASELINE_C05")
        baseline = evaluate(reference, cells)
        origin = {"kind": "isotropic_extent", "delta": 0.0} if axis_fit else {"delta": 0.0}
        winner = {"transform": origin, "model": package, "score": baseline}
        trace = [{**origin, "gate": "C05_PASS", "model_sha256": sha(package),
                  "loss": baseline}]
        for kind, delta in transforms:
            transform = {"kind": kind, "delta": delta} if axis_fit else {"delta": delta}
            updated = candidate(base, count, delta, package, kind=kind)
            if updated is None:
                trace.append({**transform, "gate": "OUT_OF_DOMAIN_CANDIDATE_REJECTED",
                              "reason": "E_B1_CANDIDATE_RANGE"})
                continue
            result = native_observe(isolated, updated, material, cells, delta)
            if result is None:
                trace.append({**transform, "gate": "C05_REJECTED",
                              "reason": "E_B0_C05_ALL_CELLS_MISMATCH"})
                continue
            loss = evaluate(result, cells)
            no_regression = all(nonworse(s, b)
                                for s, b in zip(loss["cells"], baseline["cells"]))
            trace.append({**transform, "gate": "C05_PASS",
                          "per_observation_guard": no_regression,
                          "model_sha256": sha(updated), "loss": loss})
            if no_regression and better(loss, winner["score"]):
                winner = {"transform": transform, "model": updated, "score": loss}
        search_receipt = ({"winner_transform": winner["transform"]} if axis_fit else
                          {"candidate_deltas": list(DELTAS), "best_delta": winner["transform"]["delta"]})
        return winner["model"], {
            **search_receipt,
            "baseline_sha256": sha(package), "winner_sha256": sha(winner["model"]),
            "membership_sha256": membership,
            "native_sha256": binary_sha,
            "c05_checked_per_candidate": 6144*len(cells),
            "observed_parts": sum(c["observed_pixels_xy"] is not None for c in cells),
            "baseline_loss": baseline, "winner_loss": winner["score"],
            "strictly_improved": better(winner["score"], baseline),
            "trace": trace}


def rename_without_replacement(staging, output):
    if os.name == "nt":
        try:
            os.rename(staging, output)
        except FileExistsError as exc:
            raise FitError("E_B1_OUTPUT_EXISTS") from exc
        return

    libc = ctypes.CDLL(None, use_errno=True)
    source, destination = os.fsencode(staging), os.fsencode(output)
    if b"\0" in source or b"\0" in destination:
        raise ValueError("embedded null byte")
    if sys.platform == "linux":
        at_fdcwd, rename_noreplace = -100, 1
        rename = getattr(libc, "renameat2", None)
        argument_types = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int,
                          ctypes.c_char_p, ctypes.c_uint)
        arguments = (at_fdcwd, source, at_fdcwd, destination, rename_noreplace)
    elif sys.platform == "darwin":
        rename_excl = 4
        rename = getattr(libc, "renamex_np", None)
        argument_types = (ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint)
        arguments = (source, destination, rename_excl)
    else:
        raise FitError("E_B1_OUTPUT_ATOMIC_UNSUPPORTED")
    need(rename is not None, "E_B1_OUTPUT_ATOMIC_UNSUPPORTED")
    rename.argtypes = argument_types
    rename.restype = ctypes.c_int
    if rename(*arguments) == 0:
        return
    code = ctypes.get_errno()
    if code in (errno.EEXIST, errno.ENOTEMPTY):
        raise FitError("E_B1_OUTPUT_EXISTS")
    need(code not in (errno.ENOSYS, errno.ENOTSUP, errno.EINVAL),
         "E_B1_OUTPUT_ATOMIC_UNSUPPORTED")
    raise OSError(code, os.strerror(code))


def publish(output, package, winner, receipt):
    tmp = Path(tempfile.mkdtemp(prefix=".r07-joint-output-", dir=output.parent))
    try:
        for name, data in {
            "whole-baseline.fgm.json": package,
            "whole-candidate.fgm.json": winner,
            "joint-fit-receipt.json": canonical(receipt)
        }.items():
            (tmp / name).write_bytes(data + b"\n")
        check_output(output)
        rename_without_replacement(tmp, output)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)


def execute(request, binary, binary_sha, output):
    check_output(output)
    package, material, membership, cells = inspect_request(request)
    winner, result = fit(package, material, membership, cells, binary, binary_sha, output.parent)
    receipt = {
        **result, "schema": RECEIPT, "stage_a": "NOT_ACCEPTED",
        "status": ("PARAMETERS_IMPROVED_SYNTHETIC_ONLY" if result["strictly_improved"] else
                   "UNRESOLVED_NO_IMPROVEMENT"),
        "source": "SYNTHETIC_ONLY_NOT_UFO_SOURCE_BOUND", "object_identity": "NOT_ATTESTED",
        "limitations": ["no_original_UFO_R03_R04_R05_source_binding",
                        "no_authenticated_B1_membership", "no_cross_cell_occlusion",
                        "no_four_novel_global_3D_views", "no_Stage_A_acceptance",
                        "never_publish_private_assets_or_derived_models"]}
    publish(output, package, winner, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--native-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        raw = pinned_path(args.request, MAX_INPUT,
                          sha(args.request.read_bytes()) if args.request.is_file()
                          else "", "E_B1_REQUEST_FILE")
        receipt = execute(parse(raw, "E_B1_REQUEST_JSON"), args.native,
                          args.native_sha256, args.output)
        print(canonical({"status": receipt["status"], "stage_a": "NOT_ACCEPTED",
                         "receipt_sha256": sha(canonical(receipt))}).decode())
    except (FitError, OSError) as exc:
        print("R07-S1B1B1A: " + (str(exc) if isinstance(exc, FitError)
                                else "E_B1_IO"), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
