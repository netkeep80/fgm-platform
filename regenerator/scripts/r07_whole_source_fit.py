#!/usr/bin/env python3
"""Приватный совместный подбор с повторной проверкой B1/R03/R04/R05."""
import argparse
from contextlib import ExitStack
from pathlib import Path
import subprocess
import sys
import tempfile

import build_r06_evidence as evidence
import r07_local_observation as s0
import r07_whole_joint_fit as joint
import r07_whole_source_preflight as preflight
import verify_r06_membership as b1

SCHEMA = "fgmr-r07-whole-source-fit-receipt/1"
AXIS_SCHEMA = "fgmr-r07-whole-source-fit-receipt/2"
require = preflight.require


def shared_sources(selection, hashes):
    bindings = selection["spec"]["sourceBindings"]
    return (hashes[bindings["map"]], hashes[bindings["loft"]],
            [(item["id"], hashes[item["file"]]) for item in bindings["datasets"]])


def observe(studio, selection, data, hashes, member):
    report = s0.run_native(studio, data, selection["spec"])
    checked = s0.verify_result(selection, hashes, report)
    visual = joint.parse(report["visual"], "E_SOURCE_VISUAL")
    native = joint.parse(report["report"], "E_SOURCE_STUDIO_REPORT")
    require(visual["tile"] == member["xyz"] and
            native["loft_ids"] == member["loft_ids"] and
            visual["sprite"]["p_level"] == checked["p_level"] and
            visual["sprite"]["right_half"] == checked["right_half"] and
            bool(visual["observed"]), "E_SOURCE_OBSERVATION")
    return report, visual["observed"], {
        "tile": member["xyz"], "part": member["part"], "dataset": member["dataset"],
        "record": member["record"], "frame_slot": checked["slot"], "frame_id": checked["frame_id"],
        "p_level": checked["p_level"], "right_half": checked["right_half"],
        "observed_sha256": joint.sha(joint.canonical(visual["observed"])),
        "studio_proof_sha256": checked["artifacts_sha256"]["proof"],
        "source_sha256": hashes,
    }


def build(builder, root, membership, membership_sha, material, r03_results):
    receipt = root / "membership.json"
    receipt.write_bytes(membership)
    out = root / "whole-build"
    command = [str(builder), str(receipt), membership_sha, material, str(out)]
    hashes = []
    for index, (member, result, _) in enumerate(r03_results):
        path = root / f"r03-{index}.json"
        payload = joint.canonical(result)
        digest = joint.sha(payload)
        path.write_bytes(payload)
        command += [str(path), digest]
        hashes.append({"xyz": member["xyz"], "sha256": digest})
    try:
        run = subprocess.run(command, capture_output=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise s0.EvidenceError("E_SOURCE_BUILDER_UNAVAILABLE") from error
    require(run.returncode == 0 and not run.stdout and not run.stderr, "E_SOURCE_BUILDER")
    package = s0.limited_file(out / "model.fgm.json", joint.MAX_MODEL)
    proof_bytes = s0.limited_file(out / "input-proof.json", 64 * 1024)
    proof = joint.parse(proof_bytes, "E_SOURCE_BUILD_PROOF")
    require(proof["schema"] == "fgm-regenerator/whole-build-proof-v1" and
            proof["receipt_sha256"] == membership_sha and proof["source_hashes"] == hashes and
            proof["package_sha256"] == joint.sha(package), "E_SOURCE_BUILD_PROOF")
    return package, joint.sha(proof_bytes)


def execute(args):
    joint.check_output(args.output)
    require(2 <= len(args.manifest) <= 8, "E_SOURCE_OBSERVATION_COUNT")
    expected_prior = joint.pinned_path(args.preflight, 1024 * 1024, args.preflight_sha256,
                                       "E_SOURCE_PREFLIGHT_SHA")
    membership = s0.limited_file(args.verified, 1024 * 1024)
    verified = preflight.parse_verified(membership, args.verified_sha256)

    first = args.manifest[0]
    primary = s0.load_selection(first)
    data, hashes = s0.source_snapshot(primary, first)
    members, anchor, selected = preflight.bind_membership(verified, primary, hashes)
    require(2 <= len(members) <= 8, "E_SOURCE_MEMBER_COUNT")
    sources = shared_sources(primary, hashes)
    material = primary["spec"]["parameters"]["material"]
    with ExitStack() as stack:
        studio, studio_sha = stack.enter_context(b1.pinned_r02(args.studio_native, args.studio_sha256))
        r03, r03_sha = stack.enter_context(b1.pinned_r02(args.r03_native, args.r03_sha256))
        r03_results = list(preflight.observe_members(r03, primary, data, members))
        inspected = [binding for binding, _, _ in r03_results]
        by_tile = {tuple(member["xyz"]): member for member in inspected}
        report, points, observation = observe(studio, primary, data, hashes,
                                             by_tile[tuple(selected["xyz"])])
        replay = preflight.make_receipt(primary, verified, args.verified_sha256, hashes, anchor,
                                        selected, inspected, report, studio_sha, r03_sha)
        require(s0.canonical(replay) + b"\n" == expected_prior, "E_SOURCE_PREFLIGHT_REPLAY")
        observed = {tuple(selected["xyz"]): (points, observation)}

        for path in args.manifest[1:]:
            selection = s0.load_selection(path)
            data, hashes = s0.source_snapshot(selection, path)
            require(shared_sources(selection, hashes) == sources and
                    selection["spec"]["parameters"]["material"] == material,
                    "E_SOURCE_SNAPSHOT")
            _, _, member = preflight.bind_membership(verified, selection, hashes)
            tile = tuple(member["xyz"])
            require(tile not in observed, "E_SOURCE_DUPLICATE_MEMBER")
            _, points, observation = observe(studio, selection, data, hashes, by_tile[tile])
            observed[tile] = (points, observation)

        cells = []
        for member, _, rows in r03_results:
            points, metadata = observed.get(tuple(member["xyz"]), (None, {}))
            flat = [bits for row in rows for bits in row]
            cells.append({"tile": member["xyz"], "local_xyz": member["local_xyz"],
                          "reference_rows": flat, "reference_rows_sha256": joint.sha(joint.canonical(flat)),
                          "p_level": metadata.get("p_level", 0), "right_half": metadata.get("right_half", False),
                          "observed_pixels_xy": points, "observed_sha256": metadata.get("observed_sha256")})
        builder, builder_sha = stack.enter_context(b1.pinned_r02(args.whole_build_native,
                                                                args.whole_build_sha256))
        root = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix="fgmr-r07-source-fit-")))
        package, build_proof = build(builder, root, membership, args.verified_sha256, material, r03_results)
        winner, result = joint.fit(package, material, args.verified_sha256, cells,
                                   args.surface_native, args.surface_sha256, root, axis_fit=args.axis_fit)

    receipt = {
        **result, "schema": AXIS_SCHEMA if args.axis_fit else SCHEMA,
        "stage_a": "NOT_ACCEPTED", "source": "LOCAL_SOURCE_CHAIN_REPLAYED",
        "status": "PARAMETERS_IMPROVED" if result["strictly_improved"] else "UNRESOLVED_NO_IMPROVEMENT",
        "object_identity": replay["object_identity"], "preflight_sha256": args.preflight_sha256,
        "whole_build_proof_sha256": build_proof,
        "source_native_sha256": {"studio": studio_sha, "r03": r03_sha, "whole_build": builder_sha},
        "observations": [metadata for _, metadata in (observed[tile] for tile in sorted(observed))],
        "r03_rows": [{"tile": member["xyz"], "nested_sha256": member["loft_rows_sha256"],
                      "flattened_sha256": cell["reference_rows_sha256"]}
                     for member, cell in zip(inspected, cells, strict=True)],
    }
    whole_inputs = {"receipt.json": membership,
                    **{f"loft-{i}.json": joint.canonical(result)
                       for i, (_, result, _) in enumerate(r03_results)}}
    joint.publish(args.output, package, winner, receipt, cells, whole_inputs)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", action="append", type=Path, required=True)
    for name in ("verified", "preflight", "studio-native", "r03-native", "whole-build-native", "surface-native"):
        parser.add_argument("--" + name, type=Path, required=True)
        parser.add_argument("--" + name.removesuffix("-native") + "-sha256", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--axis-fit", action="store_true",
                        help="Проверить также общие поправки полуразмеров и переносы по осям.")
    args = parser.parse_args()
    try:
        receipt = execute(args)
    except (s0.EvidenceError, evidence.EvidenceError, joint.FitError) as error:
        print(f"R07-S1B1B1B: {error}", file=sys.stderr)
        return 2
    except (OSError, ValueError, TypeError, KeyError, IndexError, RecursionError):
        print("R07-S1B1B1B: E_SOURCE_INPUT_OR_RUNTIME", file=sys.stderr)
        return 2
    print(joint.canonical({"schema": receipt["schema"], "status": receipt["status"],
                           "stage_a": receipt["stage_a"],
                           "receipt_sha256": joint.sha(joint.canonical(receipt))}).decode())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
