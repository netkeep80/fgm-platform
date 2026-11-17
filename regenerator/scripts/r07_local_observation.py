"""Локальная доказательная подготовка одного R07 Stage-A наблюдения через принятый R06/R04/R05/C05.

Не исполняет подбор параметров и не удостоверяет объектную идентичность по одной клетке.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

SCHEMA = "fgmr-r07-local-selection/1"
RECEIPT = "fgmr-r07-source-baseline/1"
CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b"
FILE_LIMIT = 4 * 1024 * 1024
CHUNK = 32 * 1024
ID = re.compile(r"[a-z][a-z0-9_]{0,15}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
SLUG = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}\Z")


class EvidenceError(Exception):
    pass


def fail(code):
    raise EvidenceError(code)


def require(test, code):
    if not test:
        fail(code)


def keys(obj, expected, code):
    require(type(obj) is dict and set(obj) == set(expected), code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def limited_file(path, limit):
    # Защита от подмены обычного файла символической ссылкой или именованным каналом.
    try:
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "E_R07_LOCAL_INPUT_TYPE_OR_SIZE")
        with path.open("rb") as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, "E_R07_LOCAL_INPUT_TYPE_OR_SIZE")
    except OSError as error:
        raise EvidenceError("E_R07_LOCAL_INPUT_IO") from error
    return data


def load_selection(manifest):
    data = limited_file(manifest, 64 * 1024)
    try:
        doc = json.loads(data)
    except (UnicodeError, ValueError) as error:
        raise EvidenceError("E_R07_LOCAL_SELECTION_JSON") from error
    keys(doc, ("schema", "object_key", "membership", "files", "spec", "expected_source"),
         "E_R07_LOCAL_SELECTION_SCHEMA")
    require(doc["schema"] == SCHEMA and isinstance(doc["object_key"], str) and
            SLUG.fullmatch(doc["object_key"]), "E_R07_LOCAL_SELECTION_SCHEMA")
    keys(doc["membership"], ("status", "evidence_note"), "E_R07_LOCAL_MEMBERSHIP")
    require(doc["membership"]["status"] in ("explicit", "derived", "hypothesis", "unknown") and
            type(doc["membership"]["evidence_note"]) is str and
            len(doc["membership"]["evidence_note"]) <= 512, "E_R07_LOCAL_MEMBERSHIP")
    keys(doc["expected_source"], ("dataset_label", "local_index", "part"), "E_R07_LOCAL_SELECTION_SOURCE")
    expected = doc["expected_source"]
    require(type(expected["dataset_label"]) is str and ID.fullmatch(expected["dataset_label"].lower())
            and type(expected["local_index"]) is int and 0 <= expected["local_index"] <= 65535
            and expected["part"] in ("floor", "west_wall", "north_wall", "object"),
            "E_R07_LOCAL_SELECTION_SOURCE")
    spec = doc["spec"]
    keys(spec, ("algorithm", "coreRevision", "budget", "sourceBindings", "parameters"),
         "E_R07_LOCAL_SPEC")
    require(spec["algorithm"] == "r06-cell/1" and spec["coreRevision"] == CORE and
            type(spec["budget"]) is int and spec["budget"] == 6144, "E_R07_LOCAL_SPEC")
    binding = spec["sourceBindings"]
    keys(binding, ("map", "loft", "datasets", "sprite"), "E_R07_LOCAL_BINDING")
    require(type(binding["datasets"]) is list and 1 <= len(binding["datasets"]) <= 16,
            "E_R07_LOCAL_BINDING")
    for item in binding["datasets"]:
        keys(item, ("id", "file"), "E_R07_LOCAL_BINDING")
        require(type(item["id"]) is str and bool(ID.fullmatch(item["id"].lower())),
                "E_R07_LOCAL_BINDING")
    keys(binding["sprite"], ("dataset", "pck", "tab", "palette"), "E_R07_LOCAL_BINDING")
    ids = [binding["map"], binding["loft"],
           *(x["file"] for x in binding["datasets"]),
           *(binding["sprite"][k] for k in ("pck", "tab", "palette"))]
    require(all(type(x) is str and ID.fullmatch(x) for x in ids) and
            len(set(ids)) == len(ids), "E_R07_LOCAL_BINDING")
    require(type(doc["files"]) is dict and set(doc["files"]) == set(ids), "E_R07_LOCAL_BINDING")
    params = spec["parameters"]
    keys(params, ("tile", "part", "material", "frameSlot", "tabBits", "paletteIndex"),
         "E_R07_LOCAL_PARAMETERS")
    require(type(params["tile"]) is list and len(params["tile"]) == 3 and
            all(type(x) is int and 0 <= x <= 254 for x in params["tile"]) and
            params["part"] == expected["part"] and
            type(params["material"]) is str and ID.fullmatch(params["material"]) and
            type(params["frameSlot"]) is int and 0 <= params["frameSlot"] < 8 and
            params["tabBits"] in (16, 32) and type(params["paletteIndex"]) is int and
            0 <= params["paletteIndex"] <= 8191 and
            binding["sprite"]["dataset"] == expected["dataset_label"] and
            expected["dataset_label"] in [x["id"] for x in binding["datasets"]],
            "E_R07_LOCAL_PARAMETERS")
    return doc


def source_snapshot(doc, manifest):
    contents = {}
    metadata = {}
    for name in sorted(doc["files"]):
        entry = doc["files"][name]
        keys(entry, ("path", "sha256"), "E_R07_LOCAL_SOURCE_SPEC")
        require(type(entry["path"]) is str and 0 < len(entry["path"]) <= 1024 and
                type(entry["sha256"]) is str and SHA.fullmatch(entry["sha256"]),
                "E_R07_LOCAL_SOURCE_SPEC")
        path = Path(entry["path"])
        if not path.is_absolute():
            path = manifest.parent / path
        # До открытия отказываем любому симлинку в цепочке пути.
        for component in (path, *path.parents):
            if component.is_symlink():
                fail("E_R07_LOCAL_SOURCE_SYMLINK")
        size_limit = FILE_LIMIT if name == doc["spec"]["sourceBindings"]["sprite"]["pck"] else 1024 * 1024
        contents[name] = limited_file(path, size_limit)
        require(digest(contents[name]) == entry["sha256"], "E_R07_LOCAL_SOURCE_DIGEST")
        metadata[name] = {"sha256": digest(contents[name]), "bytes": len(contents[name])}
    require(sum(len(x) for x in contents.values()) <= FILE_LIMIT, "E_R07_LOCAL_TOTAL_LIMIT")
    return contents, metadata


def run_native(native, contents, spec):
    requests = [{"v": 1, "action": "clear"}]
    for name in sorted(contents):
        data = contents[name]
        for offset in range(0, len(data), CHUNK):
            requests.append({"v": 1, "action": "append", "file": name,
                             "offset": offset, "hex": data[offset:offset + CHUNK].hex()})
        if not data:
            # Пустой файл допустим как staged input; нативный API принимает hex="".
            requests.append({"v": 1, "action": "append", "file": name, "offset": 0, "hex": ""})
    requests.append({"v": 1, "action": "start", "spec": spec})
    # Для отдельной чистой сессии runId всегда равен 1, но проверяется по start reply.
    requests.append({"v": 1, "action": "step", "runId": 1})
    requests.append({"v": 1, "action": "finalize", "runId": 1})
    payload = b"\n".join(canonical(x) for x in requests) + b"\n"
    try:
        child = subprocess.run([str(native)], input=payload, capture_output=True,
                               timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise EvidenceError("E_R07_LOCAL_NATIVE_UNAVAILABLE") from error
    require(child.returncode == 0, "E_R07_LOCAL_NATIVE_FAILED")
    try:
        rows = [json.loads(s) for s in child.stdout.decode("utf-8").splitlines()]
    except (UnicodeError, ValueError) as error:
        raise EvidenceError("E_R07_LOCAL_NATIVE_PROTOCOL") from error
    require(len(rows) == len(requests), "E_R07_LOCAL_NATIVE_PROTOCOL")
    require(all(type(row) is dict and "error" not in row for row in rows),
            "E_R07_LOCAL_NATIVE_REJECTED")
    require(rows[-3].get("state") == "RUNNING" and rows[-3].get("runId") == 1 and
            rows[-2].get("state") == "COMPLETED" and rows[-1].get("state") == "COMPLETED",
            "E_R07_LOCAL_NATIVE_PROTOCOL")
    result = rows[-1].get("result")
    require(type(result) is dict and set(result) == {"model", "preview", "report", "proof", "visual"}
            and all(type(x) is str for x in result.values()), "E_R07_LOCAL_NATIVE_PROTOCOL")
    return result


def pixels(value):
    require(type(value) is list and len(value) <= 4096, "E_R07_LOCAL_MASK")
    seen = set()
    for pair in value:
        require(type(pair) is list and len(pair) == 2 and all(type(n) is int and abs(n) <= 50000 for n in pair),
                "E_R07_LOCAL_MASK")
        seen.add(tuple(pair))
    require(len(seen) == len(value), "E_R07_LOCAL_MASK")
    return seen


def boundary(points):
    return {p for p in points if any((p[0] + dx, p[1] + dy) not in points
                                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)))}


def contour_loss(a, b):
    if not a or not b:
        return None
    pa, pb = boundary(a), boundary(b)
    return (sum(min(abs(x - u) + abs(y - v) for u, v in pb) for x, y in pa) +
            sum(min(abs(x - u) + abs(y - v) for u, v in pa) for x, y in pb))


def verify_result(doc, snapshots, result):
    try:
        model, preview, report, proof, visual = (result[x] for x in ("model", "preview", "report", "proof", "visual"))
        r, p, v = json.loads(report), json.loads(proof), json.loads(visual)
    except (KeyError, ValueError) as error:
        raise EvidenceError("E_R07_LOCAL_RESULT_JSON") from error
    require(r.get("schema") == "fgmr-studio-cell/1" and
            p.get("schema") == "fgmr-studio-c05-proof/1" and
            v.get("schema") == "fgmr-studio-r05-observation/1" and
            v.get("coordinate_frame") == "r05-ufo-dimetric/1", "E_R07_LOCAL_RESULT_SCHEMA")
    require(r.get("source") == doc["expected_source"] and
            r.get("tile") == doc["spec"]["parameters"]["tile"] and
            r.get("slot") == doc["spec"]["parameters"]["frameSlot"],
            "E_R07_LOCAL_SOURCE_IDENTITY")
    require(p.get("evaluation") == "C05" and p.get("voxels_checked") == 6144 and
            r.get("voxel_checks") == 6144 and p.get("occupied") == r.get("occupied"),
            "E_R07_LOCAL_GAMEPLAY_PROOF")
    require(p.get("model_sha256") == digest(model.encode()) == r.get("package_bytes_sha256") and
            p.get("mesh_sha256") == digest(preview.encode()) and
            p.get("report_sha256") == digest(report.encode()) and
            p.get("r05_visual_sha256") == digest(visual.encode()),
            "E_R07_LOCAL_OUTPUT_DIGEST")
    inputs = r.get("input_sha256", {})
    binding = doc["spec"]["sourceBindings"]
    pairs = {"map": binding["map"], "loft": binding["loft"],
             "pck": binding["sprite"]["pck"], "tab": binding["sprite"]["tab"],
             "palette": binding["sprite"]["palette"]}
    require(all(inputs.get(kind) == snapshots[name]["sha256"] for kind, name in pairs.items()),
            "E_R07_LOCAL_INPUT_PROOF")
    active = next(x for x in binding["datasets"] if x["id"] == doc["expected_source"]["dataset_label"])
    require(inputs.get("selected_mcd") == snapshots[active["file"]]["sha256"] and
            r.get("dataset_order") == [{"id": x["id"], "sha256": snapshots[x["file"]]["sha256"]}
                                       for x in binding["datasets"]],
            "E_R07_LOCAL_DATASET_PROOF")
    predicted, observed = pixels(v.get("predicted")), pixels(v.get("observed"))
    common = len(predicted & observed)
    counts = {"common": common, "predicted_only": len(predicted) - common,
              "observed_only": len(observed) - common}
    require(v.get("silhouette") == counts and r.get("silhouette") == counts,
            "E_R07_LOCAL_MASK_INTEGRITY")
    total = len(predicted | observed)
    silhouette_iou = round(common / total, 8) if total else None
    contour_l1 = contour_loss(predicted, observed)
    return {"source": r["source"], "tile": r["tile"], "frame_id": r["frame_id"],
            "slot": r["slot"], "p_level": r["p_level"], "right_half": r["right_half"],
            "r05_coordinate_frame": v["coordinate_frame"],
            "c05": {"checked": p["voxels_checked"], "occupied": p["occupied"]},
            "metrics": {"common": common, "predicted_only": counts["predicted_only"],
                        "observed_only": counts["observed_only"],
                        "silhouette_iou": silhouette_iou, "contour_l1": contour_l1},
            "artifacts_sha256": {key: digest(result[key].encode()) for key in result}}


def write_local(output, result, receipt):
    require(not output.exists() and not output.is_symlink(), "E_R07_LOCAL_OUTPUT_EXISTS")
    parent = output.parent
    require(parent.is_dir(), "E_R07_LOCAL_OUTPUT_PARENT")
    tmp = Path(tempfile.mkdtemp(prefix=".r07-stage-", dir=parent))
    try:
        files = {"model.fgm.json": result["model"], "preview.obj": result["preview"],
                 "report.json": result["report"], "proof.json": result["proof"],
                 "visual.json": result["visual"],
                 "stage-a-baseline-receipt.json": canonical(receipt).decode("utf-8") + "\n"}
        for name, value in files.items():
            with (tmp / name).open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(value)
        tmp.rename(output)
    finally:
        if tmp.exists():
            shutil.rmtree(tmp)


def execute(manifest, native, output):
    require(not output.exists() and not output.is_symlink(), "E_R07_LOCAL_OUTPUT_EXISTS")
    require(native.is_file(), "E_R07_LOCAL_NATIVE_UNAVAILABLE")
    selection = load_selection(manifest)
    source, metadata = source_snapshot(selection, manifest)
    result = run_native(native, source, selection["spec"])
    evidence = verify_result(selection, metadata, result)
    receipt = {"schema": RECEIPT, "source_schema": SCHEMA, "object_key": selection["object_key"],
               "object_identity": "NOT_INDEPENDENTLY_ATTESTED",
               "membership_status": selection["membership"]["status"],
               "stage_a": "BASELINE_ONLY_NOT_FITTED", "local_only": True,
               "source_digests": metadata, **evidence,
               "limitations": ["no_parametric_fit", "no_object_level_membership_proof",
                               "single_cell_only", "no_four_novel_views", "not_for_publication"]}
    write_local(output, result, receipt)
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description="Локальный R07 Stage-A baseline на проверенных R04/R05/R06/C05 данных")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        receipt = execute(args.manifest.absolute(), args.native.absolute(), args.output.absolute())
    except EvidenceError as error:
        print(f"R07_LOCAL: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"stage_a": receipt["stage_a"], "object_identity": receipt["object_identity"],
                      "metrics": receipt["metrics"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())