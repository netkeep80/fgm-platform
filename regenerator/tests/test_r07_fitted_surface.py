"""Independent synthetic geometry oracle; real native fit and Studio protocol.

No UFO data, FGM evaluator or LOFT decoder is implemented here. Expected solids
are explicit analytic fixture boxes. Native Core alone evaluates FGM/C05.
"""
import copy
import itertools
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import r07_whole_joint_fit as joint

STUDIO, OBSERVER = map(Path, sys.argv[1:3])
BOXES = [([12, 4, 6], [20, 6, 7]), ([12, 6, 6], [14, 12, 7]),
         ([18, 6, 6], [20, 12, 7]), ([14, 10, 6], [18, 12, 7]),
         ([12, 4, 7], [14, 6, 10])]
PARTS = ["floor", "west_wall", "north_wall", "object"]
CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b"


def enc(value):
    return joint.canonical(value)


def inside(p, boxes):
    return any(all(a < x < b for x, a, b in zip(p, lo, hi)) for lo, hi in boxes)


def adjusted(delta):
    return [([x-delta for x in lo], [x+delta for x in hi]) for lo, hi in BOXES]


def analytic_pixels(tile, boxes):
    """Independent exact slab intersections in the original dimetric camera."""
    points = []
    for px, py in itertools.product(range(32), range(40)):
        d, h = px+.5-16, py+.5-20
        start, end = max(0, d, d/2+h), min(16, 16+d, 24+d/2+h)
        for lo, hi in boxes:
            enter = max(start, lo[0]-16*tile, lo[1]+d, lo[2]+d/2+h)
            leave = min(end, hi[0]-16*tile, hi[1]+d, hi[2]+d/2+h)
            if leave > enter+1e-9:
                points.append([px+16*tile, py+8*tile])
                break
    return sorted(points)


def fixture():
    bindings, lofts, cells = [], [], []
    for i in range(2):
        rows = [[0]*16 for _ in range(24)]
        for z, y, x in itertools.product(range(24), range(16), range(16)):
            if inside([16*i+x+.5, y+.5, z+.5], BOXES):
                rows[z][y] |= 1 << (15-x)
        tile = [i, 0, 0]
        bindings.append(dict(xyz=tile, local_xyz=tile, part="object", dataset="SYNTH", record=1, map_record=i))
        lofts.append(enc(dict(schema="fgm-regenerator/loft-terrain-v1", terrain_only=True,
            voxel_dimensions_xyz=[16, 16, 24], tile=dict(xyz=tile, record_index=i),
            sources=[dict(part=p, present=True, source_index=2, dataset_label="SYNTH", local_index=1,
                          loft_ids=[0]*12) if p == "object" else dict(part=p, present=False, source_index=0) for p in PARTS],
            part_rows=[[[0]*16 for _ in range(24)] for _ in range(3)]+[rows])))
        flat = list(itertools.chain.from_iterable(rows))
        observed = analytic_pixels(i, adjusted(.49))
        cells.append(dict(tile=tile, local_xyz=tile, reference_rows=flat,
            reference_rows_sha256=joint.sha(enc(flat)), p_level=0, right_half=False,
            observed_pixels_xy=observed, observed_sha256=joint.sha(enc(observed))))
    receipt = enc(dict(schema="fgm-regenerator/verified-membership-input-v1", status="verified_explicit_membership",
        instance="R07 синтетическое кольцо", prototype="synthetic", provenance=dict(kind="synthetic-test"),
        anchor_xyz=[0, 0, 0], cell_bindings=bindings))
    return receipt, lofts, cells


class Engine:
    def __init__(self):
        self.process = subprocess.Popen([str(STUDIO)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True, encoding="utf-8")

    def call(self, action, **kwargs):
        self.process.stdin.write(enc(dict(v=1, action=action, **kwargs)).decode()+"\n")
        self.process.stdin.flush()
        answer = self.process.stdout.readline()
        assert answer, "native Studio exited"
        return json.loads(answer)

    def stage(self, name, data):
        for offset in range(0, len(data), 16384):
            reply = self.call("append", file=name, offset=offset, hex=data[offset:offset+16384].hex())
            assert "error" not in reply, reply
        return dict(file=name, sha256=joint.sha(data))

    def start(self, receipt, lofts, fitted=None, fit_sha=None):
        self.call("clear")
        bindings = dict(receipt=self.stage("receipt", receipt),
                        lofts=[self.stage("loft"+str(i), d) for i, d in enumerate(lofts)])
        if fitted is not None:
            bindings["fitted"] = self.stage("fitted", fitted)
            if fit_sha:
                bindings["fitted"]["sha256"] = fit_sha
        return self.call("start", spec=dict(algorithm="r07-whole-preview/1" if fitted is not None else "r06-whole-build/1",
            coreRevision=CORE, budget=6144*len(lofts), sourceBindings=bindings, parameters=dict(material="stone")))

    def artifacts(self, run):
        finished = self.call("finalize", runId=run)
        assert "error" not in finished, finished
        files = {}
        for d in finished["result"]["build"]["artifacts"]:
            data = ""
            while len(data) < d["size"]:
                chunk = self.call("read-build", runId=run, artifact=d["name"], offset=len(data))["chunk"]
                data += chunk["bytes"]
            assert joint.sha(data.encode()) == d["sha256"]
            files[d["name"]] = data
        return files

    def close(self):
        self.process.stdin.close()
        assert self.process.wait(timeout=10) == 0
        assert not self.process.stderr.read()


def geometry_oracle(obj, boxes):
    vertices, triangles = [], []
    for line in obj.splitlines():
        if line.startswith("v "):
            vertices.append(list(map(float, line.split()[1:])))
        elif line.startswith("f "):
            face = [vertices[int(i)-1] for i in line.split()[1:]]
            triangles.extend([[face[0], face[i], face[i+1]] for i in range(1, len(face)-1)])
    assert vertices and triangles
    for a in range(3):
        assert abs(min(p[a] for p in vertices)-min(lo[a] for lo, _ in boxes)) < 1e-8
        assert abs(max(p[a] for p in vertices)-max(hi[a] for _, hi in boxes)) < 1e-8
    area = volume = 0
    for tri in triangles:
        a, b, c = tri
        u, v = ([b[i]-a[i] for i in range(3)], [c[i]-a[i] for i in range(3)])
        cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
        axes = [i for i, x in enumerate(cross) if abs(x) > 1e-12]
        assert len(axes) == 1, "degenerate or non-axis face"
        axis = axes[0]
        area += abs(cross[axis])/2
        volume += sum(a[i]*cross[i] for i in range(3))/6
        for weights in ((1/3, 1/3, 1/3), (.2, .3, .5), (.1, .7, .2)):
            p = [sum(weights[k]*tri[k][i] for k in range(3)) for i in range(3)]
            step = 1e-6 if cross[axis] > 0 else -1e-6
            inner, outer = p.copy(), p.copy()
            inner[axis] -= step
            outer[axis] += step
            assert inside(inner, boxes) and not inside(outer, boxes), "internal/duplicate/reversed face"
    # Independent Cartesian decomposition of the analytic fixture union.
    grid = [sorted({p[a] for lo, hi in boxes for p in (lo, hi)}) for a in range(3)]
    occupied = set()
    for index in itertools.product(*(range(len(g)-1) for g in grid)):
        if inside([(grid[a][index[a]]+grid[a][index[a]+1])/2 for a in range(3)], boxes):
            occupied.add(index)
    expected_area = expected_volume = 0
    for idx in occupied:
        size = [grid[a][idx[a]+1]-grid[a][idx[a]] for a in range(3)]
        expected_volume += size[0]*size[1]*size[2]
        for axis, sign in itertools.product(range(3), (-1, 1)):
            other = list(idx)
            other[axis] += sign
            if tuple(other) not in occupied:
                expected_area += size[(axis+1)%3]*size[(axis+2)%3]
    assert abs(area-expected_area) < 1e-7, (area, expected_area)
    assert abs(volume-expected_volume) < 1e-7, (volume, expected_volume)
    assert not inside([16, 8, 6.5], boxes), "fixture through-hole filled"
    # Independent slab distances vs actual triangle ray intersections, including
    # background/hole rays, nearest occlusion and the farthest boundary.
    rays = 0
    for axis in range(3):
        u, v = (axis+1)%3, (axis+2)%3
        span_u, span_v = grid[u][-1]-grid[u][0]+2, grid[v][-1]-grid[v][0]+2
        for i, j in itertools.product(range(17), repeat=2):
            x, y = grid[u][0]-1+(i+.317)*span_u/17, grid[v][0]-1+(j+.217)*span_v/17
            origin = grid[axis][-1]+5
            intervals = [(origin-hi[axis], origin-lo[axis]) for lo, hi in boxes
                         if lo[u] < x < hi[u] and lo[v] < y < hi[v]]
            hits = []
            for tri in triangles:
                if max(p[axis] for p in tri)-min(p[axis] for p in tri) > 1e-9:
                    continue
                signs = []
                for k in range(3):
                    a, b = tri[k], tri[(k+1)%3]
                    signs.append((b[u]-a[u])*(y-a[v])-(b[v]-a[v])*(x-a[u]))
                if all(s >= -1e-9 for s in signs) or all(s <= 1e-9 for s in signs):
                    hits.append(origin-tri[0][axis])
            assert bool(hits) == bool(intervals), "wrong silhouette/hole ray"
            if hits:
                assert abs(min(hits)-min(a for a, _ in intervals)) < 1e-8, "nearest depth/occlusion"
                assert abs(max(hits)-max(b for _, b in intervals)) < 1e-8, "farthest depth"
            rays += 1
    return dict(triangles=len(triangles), area=area, volume=volume,
                checked_face_points=3*len(triangles), analytic_depth_rays=rays)


def main(root):
    engine = Engine()
    try:
        receipt, lofts, cells = fixture()
        start = engine.start(receipt, lofts)
        assert engine.call("step", runId=start["runId"])["state"] == "COMPLETED"
        baseline = engine.artifacts(start["runId"])
        package = baseline["model.fgm.json"].encode()
        model = json.loads(package)
        nodes = model["model"]["contributions"][0]["field"]["program"]["nodes"]
        assert len(nodes) == 5*len(BOXES)-1, "fixture greedy decomposition changed; review analytic oracle"
        for i, (lo, hi) in enumerate(BOXES):
            assert nodes[4*i]["value"] == [(b-a)/2 for a, b in zip(lo, hi)]
            assert nodes[4*i+1]["value"] == [(b+a)/2 for a, b in zip(lo, hi)]
        request = dict(schema=joint.SCHEMA, synthetic_only=True, baseline_package=package.decode(),
            baseline_sha256=joint.sha(package), membership_sha256=joint.sha(receipt), material="stone", cells=cells)
        output = root / "fit"
        result = joint.execute(request, OBSERVER, joint.sha(OBSERVER.read_bytes()), output)
        assert result["best_delta"] == .49 and result["strictly_improved"], result
        fitted = (output / "fit-preview.json").read_bytes()
        payload = json.loads(fitted)
        start = engine.start(receipt, lofts, fitted)
        assert engine.call("step", runId=start["runId"])["state"] == "COMPLETED"
        files = engine.artifacts(start["runId"])
        report = json.loads(files["report.json"])
        assert report["checked_centers"] == 12288
        assert report["model_sha256"] == result["winner_sha256"]
        assert report["fit"]["before"]["micro"] == result["baseline_loss"]["micro"]
        assert report["fit"]["after"]["micro"] == result["winner_loss"]["micro"]
        assert files["preview.obj"] != baseline["preview.obj"]
        oracle = geometry_oracle(files["preview.obj"], adjusted(.49))
        geometry_oracle(baseline["preview.obj"], BOXES)
        # The oracle must reject the old voxel OBJ attached to a fitted FGM.
        try:
            geometry_oracle(baseline["preview.obj"], adjusted(.49))
        except AssertionError:
            pass
        else:
            raise AssertionError("old voxel mesh escaped oracle")
        # Neighbor centers remain empty under the actual Core evaluator.
        candidate = payload["winner_package"]
        neighbor = subprocess.run([str(OBSERVER)], input=enc(dict(schema="fgmr-r07-whole-surface-request/1",
            package=candidate, package_sha256=joint.sha(candidate.encode()), material="stone",
            cells=[dict(tile=[5+i, 4, 0], local_xyz=[i, 0, 0], reference_rows=[0]*384,
                        p_level=0, right_half=False) for i in (-1, 2)])), capture_output=True, timeout=30)
        assert neighbor.returncode == 0, neighbor.stderr
        assert json.loads(neighbor.stdout)["c05"]["checked"] == 12288
        negatives = []

        def reject(name, data, expected, digest=None):
            s = engine.start(receipt, lofts, enc(data), digest)
            assert s.get("state") == "RUNNING", s
            reply = engine.call("step", runId=s["runId"])
            assert reply.get("error") == expected, (name, reply, expected)
            assert "error" in engine.call("finalize", runId=s["runId"])
            negatives.append(name)

        reject("wrong outer SHA", payload, "E_FIT_INPUT_SHA", "0"*64)
        for key, code in (("baseline_sha256", "E_FIT_BASELINE"), ("membership_sha256", "E_FIT_MEMBERSHIP"),
                          ("winner_sha256", "E_FIT_PACKAGE_SHA")):
            bad = copy.deepcopy(payload)
            bad[key] = "0"*64
            reject(key, bad, code)
        bad = copy.deepcopy(payload)
        bad["cells"][0]["local_xyz"] = [1, 0, 0]
        reject("false cell membership", bad, "E_FIT_CELLS")
        bad = copy.deepcopy(payload)
        bad["cells"][0]["reference_rows"][0] = 1
        bad["cells"][0]["reference_rows_sha256"] = joint.sha(enc(bad["cells"][0]["reference_rows"]))
        reject("rehash wrong LOFT rows", bad, "E_FIT_ROWS")
        bad = copy.deepcopy(payload)
        bad["fit_receipt"]["winner_loss"]["micro"]["common"] += 1
        reject("fabricated metric", bad, "E_FIT_METRICS")
        for delta, code in ((.98, "E_B0_C05_ALL_CELLS_MISMATCH"), (-.49, "E_FIT_REGRESSION")):
            bad = copy.deepcopy(payload)
            changed = joint.candidate(model, len(BOXES), (-.49, -.49, 0) if delta < 0 else delta,
                                      package, kind="axis_extent" if delta < 0 else "isotropic_extent")
            bad["winner_package"] = changed.decode()
            bad["winner_sha256"] = joint.sha(changed)
            reject("candidate "+str(delta), bad, code)
        bad = copy.deepcopy(payload)
        doc = json.loads(bad["winner_package"])
        doc["model"]["contributions"][0]["field"]["program"]["nodes"][0]["value"][0] += .01
        bad["winner_package"] = enc(doc).decode()
        bad["winner_sha256"] = joint.sha(enc(doc))
        reject("non-common box deformation", bad, "E_FIT_GRAMMAR")
        bad = copy.deepcopy(payload)
        bad["cells"][0]["observed_pixels_xy"].append(bad["cells"][0]["observed_pixels_xy"][0])
        bad["cells"][0]["observed_sha256"] = joint.sha(enc(bad["cells"][0]["observed_pixels_xy"]))
        reject("duplicate observation", bad, "E_FIT_OBSERVATION")
        bad = copy.deepcopy(payload)
        bad["cells"][0]["p_level"] = 256
        reject("out-of-domain source camera", bad, "E_B0_RANGE")
        bad = copy.deepcopy(payload)
        bad["fit_receipt"]["winner_sha256"] = "0"*64
        reject("wrong receipt identity", bad, "E_FIT_RECEIPT")
        oversized = engine.start(receipt, lofts, b" "*(256*1024+1))
        assert oversized.get("error") == "E_STUDIO_LIMIT", oversized
        negatives.append("oversize import before execution")
        # Existing axis-fit output variants and unchanged winner also retain a
        # valid path. Core/R07 generate observations; analytic solids test geometry.
        variants = []
        for kind, delta in (("axis_extent", (0, .49, 0)),
                            ("axis_translation", (.49, -.49, 0)), ("unchanged", 0)):
            updated = package if kind == "unchanged" else joint.candidate(model, len(BOXES), delta, package, kind=kind)
            current_cells = copy.deepcopy(cells)
            predictions = joint.native_observe(OBSERVER, updated, "stone", current_cells, 0)
            for c, pred in zip(current_cells, predictions):
                c["observed_pixels_xy"] = sorted(map(list, pred))
                c["observed_sha256"] = joint.sha(enc(c["observed_pixels_xy"]))
            before_loss = joint.evaluate(joint.native_observe(OBSERVER, package, "stone", current_cells, 0), current_cells)
            after_loss = joint.evaluate(predictions, current_cells)
            variant_receipt = dict(baseline_sha256=joint.sha(package), winner_sha256=joint.sha(updated),
                membership_sha256=joint.sha(receipt), baseline_loss=before_loss, winner_loss=after_loss)
            imported = enc(joint.preview_input(package, updated, variant_receipt, current_cells))
            s = engine.start(receipt, lofts, imported)
            reply = engine.call("step", runId=s["runId"])
            assert reply["state"] == "COMPLETED", (kind, reply)
            artifacts = engine.artifacts(s["runId"])
            variant_boxes = BOXES if kind == "unchanged" else [
                ([x+(delta[a] if kind == "axis_translation" else -delta[a]) for a, x in enumerate(lo)],
                 [x+delta[a] for a, x in enumerate(hi)]) for lo, hi in BOXES]
            geometry_oracle(artifacts["preview.obj"], variant_boxes)
            variants.append(kind)
        # Replay same candidate deterministically; an old run cannot read its artifacts.
        first = engine.start(receipt, lofts, fitted)
        assert engine.call("cancel", runId=first["runId"])["state"] == "CANCELLED"
        assert "error" in engine.call("step", runId=first["runId"])
        second = engine.start(receipt, lofts, fitted)
        assert "error" in engine.call("read-build", runId=first["runId"], artifact="preview.obj", offset=0)
        assert engine.call("step", runId=second["runId"])["state"] == "COMPLETED"
        assert engine.artifacts(second["runId"]) == files
        (root / "receipt.json").write_bytes(receipt)
        for i, data in enumerate(lofts):
            (root / ("loft-"+str(i)+".json")).write_bytes(data)
        (root / "fit-preview.json").write_bytes(fitted)
        expectation = dict(boxes=adjusted(.49), baseline_boxes=BOXES, c05=12288,
            before=report["fit"]["before"], after=report["fit"]["after"], model_sha256=report["model_sha256"],
            mesh_sha256=report["preview_sha256"], baseline_sha256=joint.sha(package),
            baseline_mesh_sha256=joint.sha(baseline["preview.obj"].encode()), geometry=oracle)
        (root / "expected.json").write_bytes(enc(expectation))
        print("R07_FITTED_SURFACE_ANALYTIC_PASS", json.dumps(dict(**expectation, negatives=negatives,
            variants=variants, neighbor_centers=12288, stage_a="NOT_ACCEPTED"), sort_keys=True))
    finally:
        engine.close()


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[3] == "--fixtures":
        root = Path(sys.argv[4])
        root.mkdir()
        main(root)
    else:
        with tempfile.TemporaryDirectory(prefix="fgmr-fitted-") as temp:
            main(Path(temp))
