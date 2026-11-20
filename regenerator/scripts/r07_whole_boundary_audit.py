#!/usr/bin/env python3
"""Локальная карточка гипотезы объекта и проверка центров вне его клеток.

Повторяет существующий source-fit и использует только native R02/R03/Core.
Не удостоверяет семантическую принадлежность, source-to-binary origin или Stage A.
"""
import argparse
import copy
from contextlib import ExitStack
from itertools import product
from pathlib import Path
import sys
import tempfile

import build_r06_evidence as evidence
import r07_local_fit as local
import r07_local_observation as s0
import r07_whole_joint_fit as joint
import r07_whole_source_fit as source_fit
import r07_whole_source_preflight as preflight
import verify_r06_membership as b1

SCHEMA = "fgmr-r07-object-boundary-audit/1"
PUBLIC_SCHEMA = "fgmr-r07-object-boundary-public/1"
TOOLS = ("studio", "r03", "whole_build", "surface", "r02", "sampler")
require = preflight.require


def snapshot_manifests(paths, root):
    """Freeze the source snapshot once; replay/inventory cannot read changed paths."""
    require(2 <= len(paths) <= 8, "E_BOUNDARY_MANIFEST_COUNT")
    snapshots, originals = [], []
    for i, path in enumerate(paths):
        raw = s0.limited_file(path, 64*1024)
        require(not any(p.is_symlink() for p in (path, *path.parents)), "E_BOUNDARY_SYMLINK")
        fixed = root / f"selection-{i}.json"
        # Parse exactly the captured bytes through the existing manifest validator.
        fixed.write_bytes(raw)
        doc = s0.load_selection(fixed)
        contents, hashes = s0.source_snapshot(doc, path)
        directory = root / f"source-{i}"
        directory.mkdir()
        for name, data in contents.items():
            target = directory / name
            target.write_bytes(data)
            doc["files"][name]["path"] = str(target)
        fixed.write_bytes(s0.canonical(doc))
        snapshots.append(fixed)
        originals.append(s0.digest(raw))
    return snapshots, originals


def halo_of(members):
    selected = {tuple(m["local_xyz"]) for m in members}
    require(2 <= len(selected) == len(members) <= 8, "E_BOUNDARY_MEMBERS")
    # All 26 adjacent cells, including edge/corner contacts and cells outside MAP.
    halo = {tuple(v+d for v, d in zip(p, delta)) for p in selected
            for delta in product((-1, 0, 1), repeat=3)} - selected
    require(len(halo) <= 208 and all(-16 <= v <= 16 for p in halo for v in p),
            "E_BOUNDARY_HALO_SCOPE")
    return sorted(halo)


def sample_halo(binary, package, material, halo, root, prefix):
    """Mask transport/counting only. The existing native Core samples every center."""
    model = root / (prefix+".fgm.json")
    model.write_bytes(package)
    cells, checked = [], 0
    for offset in range(0, len(halo), 8):
        batch = halo[offset:offset+8]
        # Accepted sampler requires >=2 cells; deterministic padding is not counted twice.
        padded = batch if len(batch) > 1 else batch+[halo[0]]
        request = root / (prefix+"-cells.json")
        request.write_bytes(joint.canonical({"schema": "fgm-regenerator/whole-object-sampling-v1",
            "cells": [{"local_xyz": list(p)} for p in padded]}))
        answer = local.run(binary, [str(model), str(request), material])
        require(type(answer) is dict and set(answer) == {"schema", "cells"} and
                answer["schema"] == "fgm-regenerator/whole-object-sampling-v1" and
                type(answer["cells"]) is list and len(answer["cells"]) == len(padded),
                "E_BOUNDARY_SAMPLER_PROTOCOL")
        for i, point in enumerate(padded):
            item = answer["cells"][i]
            require(type(item) is dict and set(item) == {"local_xyz", "mask"} and
                    item["local_xyz"] == list(point), "E_BOUNDARY_SAMPLER_PROTOCOL")
            mask = item["mask"]
            require(type(mask) is str and len(mask) == 6144 and set(mask) <= {"0", "1"},
                    "E_BOUNDARY_SAMPLER_PROTOCOL")
            if i < len(batch):
                cells.append({"local_xyz": list(point), "occupied_centers": mask.count("1"),
                              "mask_sha256": s0.digest(mask.encode("ascii"))})
                checked += 6144
    return {"model_sha256": s0.digest(package), "checked_centers": checked,
            "occupied_centers": sum(c["occupied_centers"] for c in cells), "cells": cells}


def inventory(r02, r03, selection, contents, verified, halo, root):
    bindings = selection["spec"]["sourceBindings"]
    paths = {}
    directory = root / "inventory-source"
    directory.mkdir()
    for name, data in contents.items():
        paths[name] = directory / name
        paths[name].write_bytes(data)
    mcd = [d["id"]+"="+str(paths[d["file"]]) for d in bindings["datasets"]]
    facts = evidence.facts_snapshot(r02, paths[bindings["map"]], mcd)
    dims = preflight.coords(facts["map"]["dimensions_xyz"], 1, 255, "E_BOUNDARY_R02_PROTOCOL")
    tiles = {(t["x"], t["y"], t["z"]): t for t in facts["map"]["tiles"]}
    require(len(tiles) == dims[0]*dims[1]*dims[2], "E_BOUNDARY_R02_PROTOCOL")
    members = verified["cell_bindings"]
    anchor = verified["anchor_xyz"]
    wanted = {tuple(m["xyz"]): m for m in members}
    points = sorted({tuple(m["local_xyz"]) for m in members} | set(halo))
    result = []
    for point in points:
        world = tuple(p+a for p, a in zip(point, anchor))
        inside = all(0 <= p < size for p, size in zip(world, dims))
        entry = {"xyz": list(world), "local_xyz": list(point),
                 "scope": "MEMBER_TILE" if world in wanted else "HALO_TILE",
                 "source_status": "IN_MAP" if inside else "OUTSIDE_MAP", "parts": []}
        if inside:
            tile = tiles[world]
            request = ["--map", str(paths[bindings["map"]]), "--loft", str(paths[bindings["loft"]]),
                       *(arg for d in mcd for arg in ("--mcd", d)),
                       "--tile", ",".join(map(str, world))]
            loft = local.run(r03, request)
            require(type(loft) is dict and loft.get("schema") == "fgm-regenerator/loft-terrain-v1" and
                    loft.get("voxel_dimensions_xyz") == [16, 16, 24] and loft.get("terrain_only") is True and
                    loft.get("tile") == {"xyz": list(world), "record_index": tile["record_index"]} and
                    len(loft.get("sources", [])) == len(loft.get("part_rows", [])) == 4,
                    "E_BOUNDARY_R03_PROTOCOL")
            for i, part in enumerate(evidence.PARTS):
                fact, decoded = tile["parts"][i], loft["sources"][i]
                rows = loft["part_rows"][i]
                require(type(fact) is dict and type(decoded) is dict and fact["kind"] == decoded.get("part") == part and
                        fact["present"] is decoded.get("present") and
                        type(rows) is list and len(rows) == 24 and all(type(layer) is list and
                        len(layer) == 16 and all(type(v) is int and 0 <= v <= 65535 for v in layer)
                        for layer in rows), "E_BOUNDARY_R03_PROTOCOL")
                if not fact["present"]:
                    require(rows == [[0]*16 for _ in range(24)], "E_BOUNDARY_R03_PROTOCOL")
                    continue
                require(fact["dataset"] == decoded.get("dataset_label") and
                        fact["local_index"] == decoded.get("local_index"), "E_BOUNDARY_R03_PROTOCOL")
                member = wanted.get(world)
                chosen = member is not None and member["part"] == part
                if chosen:
                    require(member["dataset"] == fact["dataset"] and member["record"] == fact["local_index"] and
                            member["map_record"] == tile["record_index"], "E_BOUNDARY_MEMBER_BINDING")
                entry["parts"].append({"part": part, "dataset": fact["dataset"], "record": fact["local_index"],
                    "map_record": tile["record_index"], "loft_rows_sha256": s0.digest(s0.canonical(rows)),
                    "membership": "DECLARED_MEMBER" if chosen else "EXCLUDED_FROM_TARGET_DECLARATION",
                    "semantic_identity": "UNRESOLVED"})
        result.append(entry)
    require(sum(p["membership"] == "DECLARED_MEMBER" for c in result for p in c["parts"]) == len(members),
            "E_BOUNDARY_MEMBER_BINDING")
    return result


def public_summary(card):
    # Explicit allowlist: never serialize private fields and then try to redact them.
    return {"schema": PUBLIC_SCHEMA, "status": card["status"],
            "object_hypothesis_sha256": s0.digest(joint.canonical(card["hypothesis"])),
            "private_card_sha256": s0.digest(joint.canonical(card)),
            "fit_receipt_sha256": card["fit_receipt_sha256"],
            "source_snapshot_sha256": s0.digest(joint.canonical(card["source_sha256"])),
            "native_sha256": {name: card["native_sha256"][name] for name in TOOLS},
            "model_sha256": {k: card[k]["model_sha256"] for k in ("baseline", "winner")},
            "selected_cells": len(card["hypothesis"]["members"]),
            "selected_c05_centers": card["selected_c05_centers"],
            "halo_cells": len(card["winner"]["cells"]),
            "halo_checked_centers": {k: card[k]["checked_centers"] for k in ("baseline", "winner")},
            "halo_occupied_centers": {k: card[k]["occupied_centers"] for k in ("baseline", "winner")},
            "membership_semantics": "NOT_AUTHENTICATED", "native_origin": "EXTERNAL_BINARY_SHA_ONLY",
            "stage_a": "NOT_ACCEPTED", "private_acceptance": "PENDING"}


def boundary_status(before, after):
    require(before["checked_centers"] == after["checked_centers"] > 0 and
            [c["local_xyz"] for c in before["cells"]] == [c["local_xyz"] for c in after["cells"]],
            "E_BOUNDARY_INCOMPLETE_HALO")
    return ("GEOMETRIC_BOUNDARY_PASS" if before["occupied_centers"] == after["occupied_centers"] == 0
            else "REJECTED_HALO_OCCUPANCY")


def execute(args):
    joint.check_output(args.output)
    require(type(args.hypothesis_version) is int and 1 <= args.hypothesis_version <= 2147483647,
            "E_BOUNDARY_VERSION")
    expected = joint.pinned_path(args.fit_receipt, 1024*1024, args.fit_receipt_sha256,
                                 "E_BOUNDARY_FIT_RECEIPT_SHA")
    receipt = joint.parse(expected, "E_BOUNDARY_FIT_RECEIPT")
    require(type(receipt) is dict and receipt.get("schema") in (source_fit.SCHEMA, source_fit.AXIS_SCHEMA),
            "E_BOUNDARY_SOURCE_FIT_ONLY")
    require((receipt["schema"] == source_fit.AXIS_SCHEMA) == args.axis_fit, "E_BOUNDARY_FIT_MODE")
    verified_bytes = joint.pinned_path(args.verified, 1024*1024, args.verified_sha256, "E_BOUNDARY_B1_SHA")
    prior = joint.pinned_path(args.preflight, 1024*1024, args.preflight_sha256, "E_BOUNDARY_PREFLIGHT_SHA")
    verified = preflight.parse_verified(verified_bytes, args.verified_sha256)
    halo = halo_of(verified["cell_bindings"])
    require(verified["provenance"]["r02_sha256"] == args.r02_sha256, "E_BOUNDARY_B1_R02_SHA")
    with tempfile.TemporaryDirectory(prefix="fgmr-object-boundary-") as temporary, ExitStack() as stack:
        root = Path(temporary)
        replay = copy.copy(args)
        replay.manifest, manifest_hashes = snapshot_manifests(args.manifest, root)
        replay.verified, replay.preflight = root/"verified.json", root/"preflight.json"
        replay.verified.write_bytes(verified_bytes)
        replay.preflight.write_bytes(prior)
        replay.output = root/"replayed-fit"
        pins = {}
        for name in TOOLS:
            binary, digest = stack.enter_context(b1.pinned_r02(getattr(args, name+"_native"), getattr(args, name+"_sha256")))
            setattr(replay, name+"_native", binary)
            pins[name] = digest
        source_fit.execute(replay)
        require((replay.output/"joint-fit-receipt.json").read_bytes() == expected, "E_BOUNDARY_FIT_REPLAY")
        preview = joint.parse((replay.output/"fit-preview.json").read_bytes(), "E_BOUNDARY_REPLAY_OUTPUT")
        baseline = (replay.output/"whole-baseline.fgm.json").read_bytes().removesuffix(b"\n")
        winner = preview["winner_package"].encode("utf-8")
        primary = s0.load_selection(replay.manifest[0])
        contents, hashes = s0.source_snapshot(primary, replay.manifest[0])
        material = primary["spec"]["parameters"]["material"]
        neighbourhood = inventory(replay.r02_native, replay.r03_native, primary, contents, verified, halo, root)
        before = sample_halo(replay.sampler_native, baseline, material, halo, root, "baseline")
        after = sample_halo(replay.sampler_native, winner, material, halo, root, "winner")
        card = {"schema": SCHEMA, "status": boundary_status(before, after),
            "hypothesis": {"schema": "fgmr-object-hypothesis/1", "version": args.hypothesis_version,
                "object_key": primary["object_key"], "instance": verified["instance"], "prototype": verified["prototype"],
                "membership_sha256": args.verified_sha256, "members": verified["cell_bindings"],
                "identity": "CONDITIONAL_ON_B1_WITNESS_NOT_AUTHENTICATED"},
            "fit_receipt_sha256": args.fit_receipt_sha256, "manifest_sha256": manifest_hashes,
            "source_sha256": hashes, "native_sha256": pins,
            "source_neighbourhood": neighbourhood, "baseline": before, "winner": after,
            "selected_c05_centers": receipt["c05_checked_per_candidate"],
            "before_loss": receipt["baseline_loss"], "after_loss": receipt["winner_loss"],
            "halo_contract": "26_neighbours_voxel_centers_only/1", "stage_a": "NOT_ACCEPTED",
            "private_acceptance": "PENDING", "limitations": ["no_authenticated_semantic_membership",
                "same_MCD_LOFT_or_adjacency_is_not_common_ownership", "no_continuous_collision_or_seam_proof",
                "no_geometry_beyond_one_cell_halo_claim", "native_binary_SHA_not_source_build_attestation",
                "no_independent_original_corpus_attestation_or_author_visual_acceptance",
                "current_B1_scope_one_TilePart_per_tile", "private_card_must_not_be_published"]}
    # Atomic no-replace directory publication, including explicitly rejected evidence.
    files = {"object-boundary.private.json": joint.canonical(card),
             "object-boundary.public.json": joint.canonical(public_summary(card))}
    joint.publish_files(args.output, files)
    return card


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", type=Path, required=True)
    for name in ("verified", "preflight", "fit-receipt"):
        parser.add_argument("--"+name, type=Path, required=True)
        parser.add_argument("--"+name+"-sha256", required=True)
    for name in TOOLS:
        flag = name.replace("_", "-")
        parser.add_argument("--"+flag+"-native", type=Path, required=True)
        parser.add_argument("--"+flag+"-sha256", required=True)
    parser.add_argument("--axis-fit", action="store_true")
    parser.add_argument("--hypothesis-version", type=int, required=True)
    parser.add_argument("--output", type=Path, required=True)
    try:
        card = execute(parser.parse_args())
        print(joint.canonical(public_summary(card)).decode("ascii"))
        return 0 if card["status"] == "GEOMETRIC_BOUNDARY_PASS" else 2
    except (s0.EvidenceError, evidence.EvidenceError, joint.FitError) as error:
        print("R07-BOUNDARY: "+str(error), file=sys.stderr)
    except (OSError, ValueError, TypeError, KeyError, IndexError, RecursionError):
        print("R07-BOUNDARY: E_BOUNDARY_INPUT_OR_RUNTIME", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
