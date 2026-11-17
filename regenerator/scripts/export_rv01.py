"""Локальный диагностический экспорт пары R07-S1 для RV01; не нормативный исполнитель FGM."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

from run_r07 import fgm_pack

HEADER = b"P5\n96 32\n255\n"
LIMIT = 1024 * 1024
VIEWS = ("front", "rear", "left_yaw", "right_yaw", "upper_pitch")


class ExportError(Exception):
    pass


def read_limited(path):
    if path.is_symlink() or not path.is_file():
        raise ExportError("E_RV01_INPUT")
    with path.open("rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ExportError("E_RV01_LIMIT")
    return data


def parameters(value):
    if (not isinstance(value, list) or len(value) != 3
            or any(type(x) is not int for x in value)):
        raise ExportError("E_RV01_PARAMETERS")
    left, right, top = value
    if not (-7 <= left <= -2 and 2 <= right <= 8 and 2 <= top <= 8 and left < right):
        raise ExportError("E_RV01_PARAMETERS")
    return value


def target_from_front(blob):
    if not blob.startswith(HEADER) or len(blob) != len(HEADER) + 96 * 32:
        raise ExportError("E_RV01_PGM")
    pixels = blob[len(HEADER):]
    target = bytearray()
    for y in range(32):
        row = pixels[y * 96:y * 96 + 32]
        if any(x not in (0, 255) for x in row):
            raise ExportError("E_RV01_PGM")
        target.extend(ord("1") if x == 255 else ord("0") for x in row)
    return target.decode("ascii")


def quad(points, vertices, faces):
    start = len(vertices) + 1
    vertices.extend(points)
    faces.append([start, start + 1, start + 2, start + 3])


def rect(x0, x1, y0, y1, z, front, vertices, faces):
    p = [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)]
    quad(p if front else list(reversed(p)), vertices, faces)


def side_x(x, y0, y1, z0, z1, vertices, faces, reverse=False):
    corners = [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)]
    quad(list(reversed(corners)) if reverse else corners, vertices, faces)


def side_y(y, x0, x1, z0, z1, vertices, faces, reverse=False):
    corners = [(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)]
    quad(list(reversed(corners)) if reverse else corners, vertices, faces)


def diagnostic_obj(fit):
    """Только специальная проверенная панель с проёмом: 4 лицевых участка и 8 боковин."""
    left, right, top = (x / 8 for x in fit)
    e, bottom, dz = 1.5, -0.625, 0.25
    strips = [
        (-e, e, -e, bottom),
        (-e, left, bottom, top),
        (right, e, bottom, top),
        (-e, e, top, e),
    ]
    vertices, faces = [], []
    for x0, x1, y0, y1 in strips:
        rect(x0, x1, y0, y1, dz, True, vertices, faces)
        rect(x0, x1, y0, y1, -dz, False, vertices, faces)
    # Наружные нормали: x=-e/-x, x=e/+x; проём x=left/+x, x=right/-x.
    for x, lo, hi, reverse in ((-e, -e, e, False), (e, -e, e, True),
                               (left, bottom, top, True), (right, bottom, top, False)):
        side_x(x, lo, hi, -dz, dz, vertices, faces, reverse)
    # Наружные нормали: y=-e/-y, y=e/+y; проём bottom/+y, top/-y.
    for y, lo, hi, reverse in ((-e, -e, e, True), (e, -e, e, False),
                               (bottom, left, right, False), (top, left, right, True)):
        side_y(y, lo, hi, -dz, dz, vertices, faces, reverse)
    lines = ["o r07_panel"]
    lines.extend("v " + " ".join(format(v, ".9g") for v in p) for p in vertices)
    lines.extend("f " + " ".join(map(str, p)) for p in faces)
    return ("\n".join(lines) + "\n").encode("ascii")


def checked_model(executable, fit, ref):
    model = fgm_pack(fit, ref)
    test = json.dumps({"fit": fit, "package": model.decode("ascii")}, separators=(",", ":"))
    result = subprocess.run([str(executable.resolve()), "--verify"], input=test.encode("ascii"),
                            capture_output=True, timeout=60, check=False)
    if result.returncode != 0:
        raise ExportError("E_RV01_C05")
    return model


def export(source, executable, output):
    if output.exists() or output.is_symlink():
        raise ExportError("E_RV01_OUTPUT_EXISTS")
    if not source.is_dir() or not executable.is_file():
        raise ExportError("E_RV01_INPUT")
    report_bytes = read_limited(source / "report.json")
    report = json.loads(report_bytes)
    if report.get("schema") != "fgm-regenerator/panel-fit-v1":
        raise ExportError("E_RV01_REPORT")
    fitted = parameters(report.get("fit"))
    starts = report.get("starts")
    if not isinstance(starts, list) or len(starts) != 3:
        raise ExportError("E_RV01_REPORT")
    initial = parameters(starts[0].get("initial"))
    images = {view: read_limited(source / (view + ".pgm")) for view in VIEWS}
    front_ref = target_from_front(images["front"])
    if not report.get("c05_verified"):
        raise ExportError("E_RV01_UNVERIFIED")
    original = read_limited(source / "panel.fgm.json")
    models = [("baseline", initial), ("reconstructed", fitted)]
    payloads = {"report.json": report_bytes, **{n + ".pgm": d for n, d in images.items()}}
    entries = []
    for role, fit in models:
        model = checked_model(executable, fit, front_ref)
        if role == "reconstructed" and original != model:
            raise ExportError("E_RV01_MISMATCH")
        mesh = diagnostic_obj(fit)
        payloads[role + ".fgm.json"] = model
        payloads[role + ".obj"] = mesh
        entries.append({
            "role": role, "object_id": "r07_panel", "observation_id": "front",
            "fgm": role + ".fgm.json", "mesh": role + ".obj",
            "sha256": hashlib.sha256(model).hexdigest(),
            "mesh_sha256": hashlib.sha256(mesh).hexdigest(), "parameters": fit
        })
    manifest = {
        "schema": "fgmr-view-session/1", "source": "synthetic-r07",
        "projection": "R07-synthetic-front", "units": "fgm-model",
        "models": entries, "diagnostics": "report.json",
        "diagnostics_sha256": hashlib.sha256(report_bytes).hexdigest(),
        "mesh_profile": "r07_panel_diagnostic_obj/2",
        "coordinate_frame": {"axes": ["x", "y", "z"], "unit": "fgm-model", "scale": 1},
        "camera": {"id": "R07-synthetic-front", "projection": "orthographic",
                   "image_size": [96, 32], "observation_columns": 3},
        "observation_sha256": {view + ".pgm": hashlib.sha256(images[view]).hexdigest()
                               for view in VIEWS},
        "observations": list(n + ".pgm" for n in VIEWS),
        "uncertainty": "hypothesis",
    }
    payloads["viewer-session.json"] = json.dumps(
        manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    output.mkdir(parents=False, exist_ok=False)
    created = []
    try:
        for name, data in payloads.items():
            path = output / name
            with path.open("xb") as stream:
                stream.write(data)
            created.append(path)
    except OSError:
        for path in created:
            path.unlink(missing_ok=True)
        output.rmdir()
        raise
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Каталог вывода R07-S1")
    parser.add_argument("--fit", type=Path, required=True, help="Собранный fgmr-r07-fit")
    parser.add_argument("--output", type=Path, required=True, help="Новый локальный каталог")
    args = parser.parse_args()
    try:
        export(args.source, args.fit, args.output)
    except (ExportError, OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired,
            json.JSONDecodeError) as error:
        print("RV01:", error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
