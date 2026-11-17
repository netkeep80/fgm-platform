#!/usr/bin/env python3
"""R07-S1B1A: private whole-membership/source preflight, NOT a fitted ObjectDefinition.

Binds the accepted R06-S2B1 membership receipt to the same hash-verified
MAP/MCD/LOFT source snapshot as the R07-S0 single-cell observation.
Uses only accepted native R03 and native Studio for geometry observations.
"""
import argparse
from contextlib import ExitStack
import json
from pathlib import Path
import re
import sys
import tempfile

import r07_local_fit as fit
import r07_local_observation as s0
import verify_r06_membership as b1
import build_r06_evidence as evidence

SCHEMA = "fgmr-r07-whole-source-preflight/1"
B1_SCHEMA = "fgm-regenerator/verified-membership-input-v1"
MAX_MEMBERS = 8
COORD_LIMIT = 16


def require(condition, code):
    if not condition:
        raise s0.EvidenceError(code)


def coords(value, low, high, code):
    require(type(value) is list and len(value) == 3 and
            all(type(x) is int and low <= x <= high for x in value), code)
    return tuple(value)


def sha_field(value, code):
    require(type(value) is str and s0.SHA.fullmatch(value), code)
    return value


def load_verified(path, expected):
    return parse_verified(s0.limited_file(path, 1024 * 1024), expected)


def parse_verified(payload, expected):
    sha_field(expected, "E_S1B1A_RECEIPT_SHA")
    require(s0.digest(payload) == expected, "E_S1B1A_RECEIPT_SHA")
    try:
        doc = fit.parse_json(payload)
    except s0.EvidenceError as error:
        raise s0.EvidenceError("E_S1B1A_RECEIPT_SCHEMA") from error
    require(type(doc) is dict and doc.get("schema") == B1_SCHEMA and
            doc.get("status") == "verified_explicit_membership",
            "E_S1B1A_MEMBERSHIP")
    return doc


def bind_membership(verified, selection, source_hashes):
    require(type(verified.get("instance")) is str and
            evidence.IDENTIFIER.fullmatch(verified["instance"]) and
            type(verified.get("prototype")) is str and
            evidence.IDENTIFIER.fullmatch(verified["prototype"]),
            "E_S1B1A_MEMBERSHIP")
    anchor = coords(verified.get("anchor_xyz"), -255, 254, "E_S1B1A_ANCHOR")
    provenance = verified.get("provenance")
    require(type(provenance) is dict, "E_S1B1A_PROVENANCE")
    for name in ("r02_sha256", "map_sha256", "manifest_sha256",
                 "membership_witness_sha256", "frame_source_sha256",
                 "graph_sha256"):
        sha_field(provenance.get(name), "E_S1B1A_PROVENANCE")
    source_bindings = selection["spec"]["sourceBindings"]
    map_id = source_bindings["map"]
    require(provenance["map_sha256"] == source_hashes[map_id]["sha256"],
            "E_S1B1A_MAP_SHA")
    declared = provenance.get("datasets")
    expected = [{"id": item["id"],
                 "sha256": source_hashes[item["file"]]["sha256"]}
                for item in source_bindings["datasets"]]
    require(type(declared) is list and declared == expected,
            "E_S1B1A_DATASET_ORDER_OR_SHA")

    members = verified.get("cell_bindings")
    require(type(members) is list and 1 <= len(members) <= MAX_MEMBERS,
            "E_S1B1A_SCOPE")
    seen, normalized = set(), []
    for item in members:
        require(type(item) is dict and set(item) ==
                {"xyz", "local_xyz", "part", "dataset", "record", "map_record"},
                "E_S1B1A_MEMBERSHIP")
        xyz = coords(item["xyz"], 0, 254, "E_S1B1A_BINDING")
        local = coords(item["local_xyz"], -COORD_LIMIT, COORD_LIMIT,
                       "E_S1B1A_BINDING")
        require(local == tuple(x - a for x, a in zip(xyz, anchor, strict=True)),
                "E_S1B1A_LOCAL_TRANSFORM")
        part, dataset = item["part"], item["dataset"]
        require(part in fit.PARTS and type(dataset) is str and
                dataset in [x["id"] for x in source_bindings["datasets"]] and
                type(item["record"]) is int and 0 <= item["record"] <= 65535 and
                type(item["map_record"]) is int and
                0 <= item["map_record"] <= 16777216,
                "E_S1B1A_BINDING")
        # This deliberately narrow Stage-A gate cannot handle two TileParts
        # in the same tile: never silently drop either part.
        require(xyz not in seen, "E_S1B1A_DUPLICATE_TILE")
        seen.add(xyz)
        normalized.append({"xyz": list(xyz), "local_xyz": list(local),
                           "part": part, "dataset": dataset,
                           "record": item["record"],
                           "map_record": item["map_record"]})
    normalized.sort(key=lambda item: (item["xyz"], item["part"]))
    tile = selection["spec"]["parameters"]["tile"]
    selected = selection["expected_source"]
    matches = [item for item in normalized if item["xyz"] == tile and
               item["part"] == selected["part"] and
               item["dataset"] == selected["dataset_label"] and
               item["record"] == selected["local_index"]]
    require(len(matches) == 1, "E_S1B1A_SELECTED_MEMBER")
    return normalized, anchor, matches[0]


def observe_members(r03, selection, source, members):
    bindings = selection["spec"]["sourceBindings"]
    with tempfile.TemporaryDirectory(prefix="fgmr-r07-s1b1a-") as private:
        root = Path(private)
        for key, data in source.items():
            with (root / key).open("xb") as stream:
                stream.write(data)
        base = ["--map", str(root / bindings["map"]),
                "--loft", str(root / bindings["loft"])]
        for item in bindings["datasets"]:
            base.extend(["--mcd", item["id"] + "=" + str(root / item["file"])])
        for binding in members:
            args = [*base, "--tile",
                    ",".join(str(x) for x in binding["xyz"])]
            result = fit.run(r03, args, timeout=60)
            require(type(result) is dict and
                    result.get("schema") == "fgm-regenerator/loft-terrain-v1" and
                    result.get("voxel_dimensions_xyz") == [16, 16, 24] and
                    result.get("terrain_only") is True,
                    "E_S1B1A_R03_SCHEMA")
            tile = result.get("tile")
            require(type(tile) is dict and
                    tile.get("xyz") == binding["xyz"] and
                    type(tile.get("record_index")) is int and
                    tile["record_index"] == binding["map_record"],
                    "E_S1B1A_R03_MAP_RECORD")
            sources, parts = result.get("sources"), result.get("part_rows")
            require(type(sources) is list and len(sources) == 4 and
                    type(parts) is list and len(parts) == 4,
                    "E_S1B1A_R03_SCHEMA")
            idx = fit.PARTS.index(binding["part"])
            selected = sources[idx]
            require(type(selected) is dict and
                    selected.get("present") is True and
                    selected.get("part") == binding["part"] and
                    selected.get("dataset_label") == binding["dataset"] and
                    selected.get("local_index") == binding["record"],
                    "E_S1B1A_R03_SOURCE")
            loft_ids = selected.get("loft_ids")
            require(type(loft_ids) is list and len(loft_ids) == 12 and
                    all(type(x) is int and 0 <= x <= 255 for x in loft_ids),
                    "E_S1B1A_R03_LOFT_IDS")
            chosen = parts[idx]
            require(type(chosen) is list and len(chosen) == 24 and
                    all(type(row) is list and len(row) == 16 and
                        all(type(bit) is int and 0 <= bit <= 65535 for bit in row)
                        for row in chosen),
                    "E_S1B1A_R03_ROWS")
            yield ({**binding, "loft_ids": loft_ids,
                    "loft_rows_sha256": s0.digest(s0.canonical(chosen)),
                    "checked_rows": 384}, result, chosen)


def preflight(manifest, verified_path, verified_sha256, studio_executable,
              studio_sha256, r03_executable, r03_sha256, output):
    require(not output.exists() and not output.is_symlink(),
            "E_S1B1A_OUTPUT_EXISTS")
    require(output.parent.is_dir(), "E_S1B1A_OUTPUT_PARENT")
    selection = s0.load_selection(manifest)
    source, hashes = s0.source_snapshot(selection, manifest)
    verified = load_verified(verified_path, verified_sha256)
    members, anchor, selected = bind_membership(verified, selection, hashes)
    sha_field(studio_sha256, "E_S1B1A_EXECUTABLE_SHA")
    sha_field(r03_sha256, "E_S1B1A_EXECUTABLE_SHA")

    # Both processes are run only from checked *copied* executables.
    with ExitStack() as stack:
        studio, studio_digest = stack.enter_context(
            b1.pinned_r02(studio_executable, studio_sha256))
        r03, r03_digest = stack.enter_context(
            b1.pinned_r02(r03_executable, r03_sha256))
        report = s0.run_native(studio, source, selection["spec"])
        s0.verify_result(selection, hashes, report)
        inspected = [binding for binding, _, _ in observe_members(r03, selection, source, members)]

    receipt = make_receipt(selection, verified, verified_sha256, hashes, anchor, selected,
                           inspected, report, studio_digest, r03_digest)
    payload = s0.canonical(receipt) + b"\n"
    require(len(payload) <= 1024 * 1024, "E_S1B1A_OUTPUT_LIMIT")
    # R06-S2B1 atomic hard-link create-if-absent: never overwrite existing file.
    b1.publish_receipt(output, payload)
    return receipt


def make_receipt(selection, verified, verified_sha256, hashes, anchor, selected,
                 inspected, report, studio_digest, r03_digest):
    observed = fit.parse_json(report["visual"])
    require(bool(s0.pixels(observed.get("observed"))),
            "E_S1B1A_NO_ORIGINAL_OBSERVATION")
    measured = fit.parse_json(report["report"])
    selected_r03 = next(x for x in inspected if x["xyz"] == selected["xyz"])
    require(measured.get("loft_ids") == selected_r03["loft_ids"],
            "E_S1B1A_STUDIO_R03_DISAGREEMENT")
    return {
        "schema": SCHEMA,
        "status": "LOCAL_MEMBERSHIP_AND_SOURCE_CROSS_BOUND",
        "stage_a": "NOT_ACCEPTED",
        "object_identity": "CONDITIONAL_ON_B1_WITNESS_NOT_AUTHENTICATED",
        "instance": verified["instance"],
        "prototype": verified["prototype"],
        "anchor_xyz": list(anchor),
        "object_key": selection["object_key"],
        "membership_sha256": verified_sha256,
        "source_sha256": hashes,
        "native_sha256": {"studio": studio_digest, "r03": r03_digest},
        "native_tool_trust": "EXTERNALLY_SUPPLIED_SHA_PIN_OF_EXECUTABLE_BYTES",
        "studio_baseline_proof_sha256": s0.digest(report["proof"].encode()),
        "selected_member": selected,
        "members": inspected,
        "checked_r03_rows": 384 * len(inspected),
        "limitations": ["no_combined_model_fit", "no_joint_C05_candidate_gate",
                        "no_four_novel_3D_views", "no_original_UFO_run_in_CI",
                        "no_independently_authenticated_human_membership",
                        "one_TilePart_per_tile", "no_stage_a_acceptance",
                        "never_publish_source_or_derived_artifacts"]
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--verified", type=Path, required=True)
    parser.add_argument("--verified-sha256", required=True)
    parser.add_argument("--studio-native", type=Path, required=True)
    parser.add_argument("--studio-sha256", required=True)
    parser.add_argument("--r03-native", type=Path, required=True)
    parser.add_argument("--r03-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = preflight(args.manifest.resolve(), args.verified,
                            args.verified_sha256, args.studio_native,
                            args.studio_sha256, args.r03_native,
                            args.r03_sha256, args.output.absolute())
    except (s0.EvidenceError, evidence.EvidenceError) as error:
        print("R07_S1B1A: " + str(error), file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, IndexError,
            RecursionError) as error:
        # No source bytes, local file paths, or parsed native error contents.
        print("R07_S1B1A: E_S1B1A_INPUT_OR_RUNTIME", file=sys.stderr)
        return 2
    print(s0.canonical({"schema": SCHEMA, "status": receipt["status"],
                        "stage_a": receipt["stage_a"],
                        "members": len(receipt["members"])}).decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
