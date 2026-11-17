#!/usr/bin/env python3
"""R07-S1B0 local-only source-bound constrained fitting pilot.

Uses accepted native R03, R04/R05/R06/C05 (Studio S0), and R07-S1A.
Original game bytes, derived masks, models and reports never leave local output.
Neither one MCD nor membership.status=explicit independently certifies an ObjectDefinition.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import r07_local_observation as s0

SCHEMA = "fgmr-r07-local-fit-pilot/1"
DELTAS = (-0.375, -0.25, -0.125, 0.0, 0.125, 0.25, 0.375)
PARTS = ("floor", "west_wall", "north_wall", "object")
MAX_NATIVE_OUTPUT = 3 * 1024 * 1024
MAX_PACKAGE_BYTES = 48 * 1024


def require(ok, code):
    if not ok:
        raise s0.EvidenceError(code)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "E_S1B_JSON_DUPLICATE")
        result[key] = value
    return result


def parse_json(payload):
    try:
        return json.loads(payload, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError, TypeError) as error:
        raise s0.EvidenceError("E_S1B_JSON") from error


class CandidateC05Mismatch(Exception):
    """Only exact native S1A C05 inequality may exclude a fit candidate."""


def run(executable, arguments, *, payload=None, timeout=60,
        candidate_c05_gate=False):
    try:
        result = subprocess.run([str(executable), *arguments], input=payload,
                                capture_output=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise s0.EvidenceError("E_S1B_NATIVE_UNAVAILABLE") from error
    if result.returncode != 0:
        # This narrow, versioned native error is the *only* recoverable
        # candidate rejection. Any crash/timeout/JSON/protocol/other error
        # aborts the fit; it must not masquerade as no improvement.
        c05_stderr = b"R07-S1A: E_S1A_C05_LOFT_MISMATCH"
        if (candidate_c05_gate and result.returncode == 2 and
                result.stdout == b"" and
                result.stderr in (c05_stderr + b"\n", c05_stderr + b"\r\n")):
            raise CandidateC05Mismatch()
        raise s0.EvidenceError("E_S1B_NATIVE_REJECTED")
    require(0 < len(result.stdout) <= MAX_NATIVE_OUTPUT, "E_S1B_NATIVE_OUTPUT")
    return parse_json(result.stdout)


def pin_native_hash(path):
    # Record local executable identity; hash does NOT independently attest origin.
    require(path.is_file() and not path.is_symlink(), "E_S1B_NATIVE_UNAVAILABLE")
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            total += len(chunk)
            require(total <= 100 * 1024 * 1024, "E_S1B_NATIVE_LIMIT")
            digest.update(chunk)
    return digest.hexdigest()


def native_r03(r03_native, selection, sources):
    bindings = selection["spec"]["sourceBindings"]
    parameters = selection["spec"]["parameters"]
    with tempfile.TemporaryDirectory(prefix="fgmr-s1b0-source-") as workspace:
        root = Path(workspace)
        # Hash-verified S0 snapshot is staged exactly once for accepted native R03.
        for key, data in sources.items():
            (root / key).write_bytes(data)
        args = ["--map", str(root / bindings["map"]), "--loft",
                str(root / bindings["loft"])]
        for entry in bindings["datasets"]:
            args += ["--mcd", entry["id"] + "=" + str(root / entry["file"])]
        args += ["--tile", ",".join(str(v) for v in parameters["tile"])]
        observation = run(r03_native, args)
    require(observation.get("schema") == "fgm-regenerator/loft-terrain-v1" and
            observation.get("voxel_dimensions_xyz") == [16, 16, 24] and
            observation.get("tile", {}).get("xyz") == parameters["tile"],
            "E_S1B_R03_SCHEMA")
    part = PARTS.index(parameters["part"])
    source = observation["sources"][part]
    expected = selection["expected_source"]
    require(source.get("present") is True and
            source.get("part") == expected["part"] and
            source.get("dataset_label") == expected["dataset_label"] and
            source.get("local_index") == expected["local_index"],
            "E_S1B_R03_SOURCE")
    layers = observation.get("part_rows")
    require(type(layers) is list and len(layers) == 4, "E_S1B_R03_ROWS")
    chosen = layers[part]
    require(type(chosen) is list and len(chosen) == 24 and
            all(type(layer) is list and len(layer) == 16 for layer in chosen),
            "E_S1B_R03_ROWS")
    flat = [bit for layer in chosen for bit in layer]
    require(all(type(bit) is int and 0 <= bit <= 65535 for bit in flat),
            "E_S1B_R03_ROWS")
    return flat, source


def candidate_package(baseline, delta):
    if delta == 0:
        return baseline
    model = parse_json(baseline)
    try:
        program = model["model"]["contributions"][0]["field"]["program"]
        nodes = program["nodes"]
        require(program["version"] == "fgm-0", "E_S1B_GRAMMAR")
        extents = [node for node in nodes if node.get("op") == "constant" and
                   node.get("type") == "vec3" and
                   node.get("id", "").startswith("extent_")]
        require(1 <= len(extents) <= 128, "E_S1B_GRAMMAR")
        for node in extents:
            value = node["value"]
            require(type(value) is list and len(value) == 3 and
                    all(type(v) in (float, int) and v >= 0.5 for v in value),
                    "E_S1B_GRAMMAR")
            proposed = [round(v + delta, 3) for v in value]
            require(all(x > 0 for x in proposed), "E_S1B_GRAMMAR")
            node["value"] = proposed
        generation = model["generation"]
        require(generation["algorithm"] == "r06_loft_boxes" and
                generation["version"] == "1.0.0", "E_S1B_GRAMMAR")
        generation["algorithm"] = "r07_s1b_uniform_extent"
        generation["version"] = "1.0.0"
        generation["parameters"] = {"delta": delta}
        generation["resources"]["baseline_package"] = s0.digest(baseline.encode())
        model["model"]["seed"] = s0.digest(s0.canonical(
            ["fgm:seed:1", {"generation": generation, "purpose": "model"}]))
    except (KeyError, TypeError, IndexError) as error:
        raise s0.EvidenceError("E_S1B_GRAMMAR") from error
    return s0.canonical(model).decode("utf-8")


def surface_evaluate(surface_native, package, reference_rows, material,
                     tile, p_level, right_half, *, candidate=False):
    require(len(package.encode("utf-8")) <= MAX_PACKAGE_BYTES,
            "E_S1B_PACKAGE_TOO_LARGE")
    request = {"schema": "fgmr-r07-surface-request/1",
               "package": package, "package_sha256": s0.digest(package.encode()),
               "reference_rows": reference_rows, "material": material,
               "tile": tile, "camera_offset": [0, 0],
               "p_level": p_level, "right_half": right_half}
    result = run(surface_native, [], payload=s0.canonical(request), timeout=60,
                 candidate_c05_gate=candidate)
    require(result.get("schema") == "fgmr-r07-surface-observation/1" and
            result.get("model_sha256") == request["package_sha256"] and
            result.get("reference_rows_sha256") == s0.digest(s0.canonical(reference_rows)) and
            result.get("c05", {}).get("match") is True and
            result.get("c05", {}).get("checked") == 6144 and
            result.get("c05", {}).get("material") == material and
            result.get("camera", {}).get("tile") == tile and
            result.get("camera", {}).get("p_level") == p_level and
            result.get("camera", {}).get("right_half") == right_half and
            result.get("camera", {}).get("camera_offset") == [0, 0] and
            result.get("raster", {}).get("algorithm") == "r07-r05-center-rays/1" and
            result.get("raster", {}).get("completeness") == "UNRESOLVED_THIN_FEATURES",
            "E_S1B_SURFACE_PROTOCOL")
    predicted = s0.pixels(result.get("surface_pixels_xy"))
    require(result.get("surface_pixels") == len(predicted) and
            result.get("surface_mask_sha256") == s0.digest(
                s0.canonical(sorted([list(p) for p in predicted]))),
            "E_S1B_SURFACE_INTEGRITY")
    return result, predicted


def metrics(predicted, observed):
    common = len(predicted & observed)
    union = len(predicted | observed)
    return {"common": common, "union": union,
            "predicted": len(predicted), "observed": len(observed),
            "iou": round(common / union, 8) if union else None,
            "contour_l1": s0.contour_loss(predicted, observed)}


def improved(new, old):
    # Exact rational IoU ordering; contour only breaks ties.
    if new["union"] and old["union"]:
        left = new["common"] * old["union"]
        right = old["common"] * new["union"]
        if left != right:
            return left > right
    elif new["union"] != old["union"]:
        return old["union"] == 0 and new["union"] == 0
    a, b = new["contour_l1"], old["contour_l1"]
    return a is not None and b is not None and a < b


def local_receipt(selection, baseline_result, baseline_proof, trace,
                  winner, source_hashes, native_hashes, r03_source):
    fitted = winner["score"]
    base = trace[0]["score"]
    was_improved = improved(fitted, base)
    return {"schema": SCHEMA,
            "object_key": selection["object_key"],
            "source_binding": selection["expected_source"],
            "membership_declared": selection["membership"]["status"],
            "object_identity": "NOT_INDEPENDENTLY_ATTESTED",
            "stage_a": ("PARAMETERS_IMPROVED_IDENTITY_UNRESOLVED" if was_improved
                        else "UNRESOLVED_NO_IMPROVEMENT"),
            "real_sprite_loss_is_local_only": True,
            "c05": {"checked": 6144, "hard_gate": "EXACT_PART_LOFT_MATCH",
                    "baseline_proof_sha256": s0.digest(baseline_proof.encode())},
            "source_sha256": source_hashes,
            "native_executable_sha256": native_hashes,
            "native_tool_trust": "LOCALLY_HASHED_NOT_INDEPENDENTLY_ATTESTED",
            "r03_source": {"part": r03_source["part"],
                           "dataset": r03_source["dataset_label"],
                           "index": r03_source["local_index"],
                           "loft_ids": r03_source["loft_ids"]},
            "loss": {"baseline": base, "best": fitted,
                     "strictly_improved": was_improved,
                     "ordering": "IoU_exact_rational_then_symmetric_contour_L1"},
            "best_delta": winner["delta"],
            "candidates": trace,
            "limitations": ["single_cell_part_not_verified_ObjectDefinition",
                            "finite_ray_sampling_can_miss_thin_features",
                            "uniform_extent_grammar_only",
                            "no_four_novel_views",
                            "never_publish_assets_or_derived_images",
                            "not_stage_a_accepted"]}


def execute(manifest, studio_native, r03_native, surface_native, output):
    require(not output.exists() and not output.is_symlink(), "E_S1B_OUTPUT_EXISTS")
    require(output.parent.is_dir(), "E_S1B_OUTPUT_PARENT")
    native_hashes = {"studio": pin_native_hash(studio_native),
                     "r03": pin_native_hash(r03_native),
                     "surface": pin_native_hash(surface_native)}
    selection = s0.load_selection(manifest)
    sources, metadata = s0.source_snapshot(selection, manifest)
    baseline = s0.run_native(studio_native, sources, selection["spec"])
    s0.verify_result(selection, metadata, baseline)
    model, visual, report, proof = (baseline[k] for k in ("model","visual","report","proof"))
    view, measured = parse_json(visual), parse_json(report)
    reference, source = native_r03(r03_native, selection, sources)
    require(measured.get("loft_ids") == source["loft_ids"],
            "E_S1B_R03_LOFT_BINDING")
    original_pixels = s0.pixels(view["observed"])
    require(original_pixels, "E_S1B_NO_OBSERVATION")
    material = selection["spec"]["parameters"]["material"]
    tile = selection["spec"]["parameters"]["tile"]
    p_level, right_half = measured["p_level"], measured["right_half"]
    base_surface, base_pixels = surface_evaluate(surface_native, model,
            reference, material, tile, p_level, right_half)
    base_score = metrics(base_pixels, original_pixels)
    trace = [{"delta": 0.0, "score": base_score,
              "model_sha256": s0.digest(model.encode()),
              "surface_sha256": base_surface["surface_mask_sha256"],
              "gate": "C05_PASS"}]
    winner = {"delta": 0.0, "score": base_score, "model": model,
              "surface": base_surface}
    for delta in DELTAS:
        if delta == 0:
            continue
        payload = candidate_package(model, delta)
        try:
            sidecar, pixels = surface_evaluate(surface_native, payload,
                    reference, material, tile, p_level, right_half, candidate=True)
        except CandidateC05Mismatch:
            # C05 geometry inequality is expected; no other execution failure
            # is permitted to turn into a successful no-improvement receipt.
            trace.append({"delta": delta, "gate": "C05_REJECTED",
                          "reason": "E_S1A_C05_LOFT_MISMATCH"})
            continue
        require(sidecar["loft_mask_sha256"] == base_surface["loft_mask_sha256"],
                "E_S1B_LOFT_INVARIANT")
        score = metrics(pixels, original_pixels)
        trace.append({"delta": delta, "score": score,
                      "model_sha256": s0.digest(payload.encode()),
                      "surface_sha256": sidecar["surface_mask_sha256"],
                      "gate": "C05_PASS"})
        if improved(score, winner["score"]):
            winner = {"delta": delta, "score": score,
                      "model": payload, "surface": sidecar}

    receipt = local_receipt(selection, baseline, proof, trace, winner,
            metadata, native_hashes, source)
    tmp = Path(tempfile.mkdtemp(prefix=".r07-s1b0-", dir=output.parent))
    try:
        # Everything here is private, including the fitted model/derived masks.
        files = {"model-baseline.fgm.json": model, "model-candidate.fgm.json": winner["model"],
                 "surface-baseline.json": s0.canonical(base_surface).decode(),
                 "surface-candidate.json": s0.canonical(winner["surface"]).decode(),
                 "stage-a-fit-pilot-receipt.json": s0.canonical(receipt).decode()}
        for name, value in files.items():
            with (tmp / name).open("x", encoding="utf-8") as stream:
                stream.write(value + "\n")
        require(not output.exists(), "E_S1B_OUTPUT_EXISTS")
        tmp.rename(output)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--studio-native", type=Path, required=True)
    parser.add_argument("--r03-native", type=Path, required=True)
    parser.add_argument("--surface-native", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = execute(args.manifest.resolve(), args.studio_native.resolve(),
                          args.r03_native.resolve(), args.surface_native.resolve(),
                          args.output.absolute())
    except (s0.EvidenceError, OSError, KeyError, IndexError, TypeError) as error:
        # Never print paths, original bytes, rendered frames or model data.
        code = str(error) if isinstance(error, s0.EvidenceError) else "E_S1B_INPUT_IO"
        print("R07_S1B0: " + code, file=sys.stderr)
        return 2
    print(s0.canonical({"schema": SCHEMA, "stage_a": receipt["stage_a"],
                        "best_delta": receipt["best_delta"],
                        "strictly_improved": receipt["loss"]["strictly_improved"]}).decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
