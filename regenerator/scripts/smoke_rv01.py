"""RV01: Chromium/WebGL2 smoke с настоящими синтетическими R06/R07 и отказами."""
import argparse
import base64
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import sys
import tempfile


def run(command):
    result = subprocess.run(command, capture_output=True, timeout=60, check=False)
    if result.returncode:
        raise RuntimeError(repr(result.stderr[-1200:]))


def fixtures(root, args):
    (root / "fixtures").mkdir()
    saved = sys.argv[:]
    try:
        sys.argv = [str(args.r06_test), str(args.r06_script), str(args.sampler),
                    str(args.loft), str(args.sprite)]
        functions = runpy.run_path(str(args.r06_test.resolve()))
    finally:
        sys.argv = saved
    for kind in ("slab", "arch", "boulder", "empty"):
        source = root / ("source-" + kind)
        source.mkdir()
        functions["input_files"](source, kind)
        target = root / "fixtures" / kind
        result = functions["generate"](
            source, "slab" if kind == "empty" else kind, target)
        if result.returncode:
            raise RuntimeError("R06 " + kind + ": " + repr(result.stderr[-1000:]))
        for name in ("loft.json", "sprite.json"):
            shutil.copyfile(source / name, target / name)
    source = root / "r07-source"
    output = root / "fixtures" / "r07"
    run([sys.executable, str(args.r07_script), "--fit", str(args.fit), "--output", str(source)])
    run([sys.executable, str(args.export), "--source", str(source),
         "--fit", str(args.fit), "--output", str(output)])
    return {p.relative_to(root).as_posix(): base64.b64encode(p.read_bytes()).decode("ascii")
            for p in (root / "fixtures").rglob("*") if p.is_file()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("html", "browser-script", "cdp-script", "r06-script", "r06-test", "sampler",
                 "loft", "sprite", "r07-script", "export", "fit"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    browser = next((shutil.which(name) for name in
                    ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
                    if shutil.which(name)), None)
    if not browser:
        print("RV01_BROWSER_MISSING", file=sys.stderr)
        return 2
    try:
        with tempfile.TemporaryDirectory(prefix="fgmr-rv01-browser-") as tmp:
            root = Path(tmp)
            data = fixtures(root, args)
            html = args.html.read_text(encoding="utf-8")
            script = args.browser_script.read_text(encoding="utf-8")
            if html.count("</body>") != 1:
                raise ValueError("E_RV01_BROWSER_HTML")
            page = html.replace("</body>", "<script>\nwindow.__rv01Fixtures=" +
                json.dumps(data, separators=(",", ":")) +
                ";\n</script><script>\n" + script + "\n</script>\n</body>")
            document = root / "smoke.html"
            document.write_text(page, encoding="utf-8")
            node = shutil.which("node")
            if not node:
                raise RuntimeError("RV01_NODE_MISSING")
            cmd = [node, str(args.cdp_script), browser, document.as_uri(),
                   str(root / "chrome-profile")]
            result = subprocess.run(cmd, capture_output=True, timeout=150, check=False)
            if result.returncode:
                print(result.stderr.decode("utf-8", errors="replace")[-1800:],
                      file=sys.stderr)
                return 2
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as error:
        print("RV01_BROWSER_ERROR:", error, file=sys.stderr)
        return 2
    print("RV01_BROWSER_PASS: R06 slab/arch/boulder/empty; R07 pair;")
    print("4 cameras, drag/zoom/pan; WebGL2; 6 negative consistency tests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
