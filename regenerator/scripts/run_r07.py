"""Запуск синтетического эксперимента обратной реконструкции."""
import argparse
import json
from pathlib import Path
import subprocess
import sys

from reconstruct_r06 import canonical, digest

SIDE = 32


def sixteenths(steps):
    whole, remainder = divmod(steps, 16)
    return steps / 16 if remainder else whole


def fgm_pack(fit, reference):
    left, right, top = fit
    bottom = -5
    nodes = [
        {"id":"outer_extent", "op":"constant", "type":"vec3", "value":[1.5, 1.5, 0.25]},
        {"id":"outer", "op":"box", "halfSize":"outer_extent"},
        {"id":"hole_extent", "op":"constant", "type":"vec3",
         "value":[sixteenths(right-left), sixteenths(top-bottom), 0.5]},
        {"id":"hole_center", "op":"constant", "type":"vec3",
         "value":[sixteenths(right+left), sixteenths(top+bottom), 0]},
        {"id":"hole", "op":"box", "halfSize":"hole_extent"},
        {"id":"move", "op":"translate", "field":"hole", "offset":"hole_center"},
        {"id":"panel", "op":"subtract", "left":"outer", "right":"move"},
    ]
    generation = {"algorithm":"r07_panel_fit", "version":"1.0.0",
                  "parameters":{"opening_steps":fit},
                  "resources":{"front_mask":digest(reference.encode("ascii"))}}
    seed = digest(canonical(["fgm:seed:1", {"generation":generation, "purpose":"model"}]))
    return canonical({
        "format":"fgm-package/1", "interpreter":"fgm-0/1", "generation":generation,
        "model":{"seed":seed, "volumes":{}, "contributions":[
            {"id":"panel", "material":"steel", "priority":0,
             "field":{"op":"program", "parameters":{},
                      "program":{"nodes":nodes, "root":"panel", "version":"fgm-0"}}} ]},
    })


def image(masks):
    pixel_bytes = bytes(255 if pixel == "1" else 0
                        for y in range(SIDE) for mask in masks
                        for pixel in mask[y * SIDE:(y + 1) * SIDE])
    return f"P5\n{3 * SIDE} {SIDE}\n255\n".encode("ascii") + pixel_bytes


def run(executable, output):
    if output.exists() or output.is_symlink():
        raise FileExistsError(output)
    binary = executable.resolve()
    raw = subprocess.run([binary], capture_output=True, check=True, timeout=60).stdout
    report = json.loads(raw)
    images = report.pop("images")
    package = fgm_pack(report["fit"], images["front"][0])
    subprocess.run([binary, "--verify"], input=canonical({
        "fit":report["fit"], "package":package.decode("ascii"),
    }), capture_output=True, check=True, timeout=60)
    report["c05_verified"] = True
    report["program_nodes"] = 7
    report["package_bytes_sha256"] = digest(package)
    payloads = {"panel.fgm.json":package, "report.json":canonical(report)}
    payloads.update({f"{name}.pgm":image(masks) for name, masks in images.items()})
    output.mkdir()
    created = []
    try:
        for name, payload in payloads.items():
            path = output / name
            with path.open("xb") as file:
                created.append(path)
                file.write(payload)
    except OSError:
        for path in created:
            path.unlink(missing_ok=True)
        output.rmdir()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        run(args.fit, args.output)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print("R07:", error, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
