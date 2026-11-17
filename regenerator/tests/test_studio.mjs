import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const [native, workerModule] = process.argv.slice(2);
const revision = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const seed = "0".repeat(64);
const packageInput = {
  format: "fgm-package/1", interpreter: "fgm-0/1",
  generation: { algorithm: "studio_synthetic", version: "1.0.0", parameters: {}, resources: {} },
  model: { seed, volumes: {}, contributions: [{
    id: "box", material: "stone", priority: 0,
    field: { op: "program", parameters: {}, program: { version: "fgm-0", root: "shape", nodes: [
      { id: "size", op: "constant", type: "vec3", value: [2,3,4] },
      { id: "shape", op: "box", halfSize: "size" },
    ] } },
  }] },
};
const specification = {
  algorithm: "r06-occupancy/1", coreRevision: revision, seed, budget: 6144,
  sourceBindings: [{ role: "model", bytes: JSON.stringify(packageInput) }],
  parameters: { material: "stone" },
};
const cmd = (action, fields = {}) => JSON.stringify({ v: 1, action, ...fields });
const run = (action, runId = 1) => cmd(action, { runId });
const start = (overrides = {}) => cmd("start", { spec: { ...specification, ...overrides } });
const boundarySphere = structuredClone(packageInput);
boundarySphere.model.contributions[0].field.program.nodes = [
  { id: "radius", op: "constant", type: "length", value: 16.20956507744733 },
  { id: "shape", op: "sphere", radius: "radius" },
];
const requests = [
  cmd("status"), run("step"), start({ budget: 6143 }), start(),
  start(), run("pause"), run("step"), run("resume"), run("step", 2), run("step"),
  run("finalize"), run("finalize"), run("cancel"), start(), run("cancel", 2),
  run("finalize", 2), start({ parameters: { material: "brick" } }), run("step", 3),
  start({ sourceBindings: [{ role: "model", bytes: "private input must not leak" }] }), run("step", 4),
  start({ coreRevision: "unknown" }), cmd("status", { v: 2 }), "{",
  start({ sourceBindings: [{ role: "model", bytes: "x".repeat(32769) }] }),
  start({ sourceBindings: [{ role: "model", bytes: "[".repeat(40)+"0"+"]".repeat(40) }] }), run("step", 5),
  start({ seed: "1".repeat(64) }), run("step", 6),
  '{"v":1,"v":1,"action":"status"}', "x".repeat(128*1024+1),
  cmd("status") + "\0suffix",
  start({ sourceBindings: [{ role: "model", bytes: JSON.stringify(packageInput)+"\0suffix" }] }),
  run("step", 7),
  start({ sourceBindings: [{ role: "model", bytes: JSON.stringify(boundarySphere) }] }),
  run("step", 8),
];
const processResult = () => {
  const child = spawnSync(native, { input: requests.join("\n")+"\n", encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.error?.message ?? child.stderr);
  assert.equal(child.stderr, "");
  return child.stdout.trimEnd().split(/\r?\n/);
};
const output = processResult();
assert.deepEqual(processResult(), output);
const statusCommand = cmd("status");
const atLimit = " ".repeat(128*1024-statusCommand.length)+statusCommand;
const crlf = spawnSync(native, { input: atLimit+"\r\n", encoding: "utf8", timeout: 30000 });
assert.equal(crlf.status,0);
assert.equal(crlf.stdout.trimEnd(),output[0],"CRLF не входит в лимит команды");
assert.equal(output.length, requests.length);
const rows = output.map(line => JSON.parse(line));
assert.deepEqual(rows.map(row => row.state), [
  "READY","READY","READY","RUNNING","RUNNING","PAUSED","PAUSED","RUNNING","RUNNING","COMPLETED",
  "COMPLETED","COMPLETED","COMPLETED","RUNNING","CANCELLED","CANCELLED","RUNNING","FAILED",
  "RUNNING","FAILED","FAILED","FAILED","FAILED","FAILED","RUNNING","FAILED",
  "RUNNING","FAILED","FAILED","FAILED",
  "FAILED","RUNNING","FAILED",
  "RUNNING","FAILED",
]);
for (const [i, code] of [
  [1,"E_STUDIO_RUN"], [2,"E_STUDIO_BUDGET"], [4,"E_STUDIO_STATE"], [6,"E_STUDIO_STATE"],
  [8,"E_STUDIO_RUN"], [12,"E_STUDIO_STATE"], [15,"E_STUDIO_STATE"], [17,"E_STUDIO_MATERIAL"],
  [19,"E_STUDIO_MODEL"], [20,"E_STUDIO_VERSION"], [21,"E_STUDIO_VERSION"], [22,"E_STUDIO_REQUEST"],
  [23,"E_STUDIO_LIMIT"], [25,"E_STUDIO_LIMIT"],
  [27,"E_STUDIO_BINDING"], [28,"E_STUDIO_REQUEST"], [29,"E_STUDIO_LIMIT"],
  [30,"E_STUDIO_REQUEST"], [32,"E_STUDIO_MODEL"],
  [34,"E_STUDIO_PROFILE"],
]) assert.equal(rows[i].error, code, "код запроса "+i);
const result = rows[10].result;
let mask = "";
for (let z=0; z<24; ++z) for (let y=0; y<16; ++y) for (let x=0; x<16; ++x)
  mask += x<2 && y<3 && z<4 ? "1" : "0";
assert.deepEqual(result, { mask, occupied: 24, samples: 6144 });
assert.equal(output[10], output[11]);
assert.equal(rows[3].runId,1);
assert.equal(rows[13].runId,2);
assert.ok(!output.join("").includes("private input"));
if (workerModule) {
  const url = pathToFileURL(resolve(workerModule)).href;
  const source = `
    import { parentPort, workerData } from "node:worker_threads";
    globalThis.self = { postMessage: value => parentPort.postMessage(value) };
    await import(workerData);
    parentPort.on("message", data => self.onmessage({ data }));
  `;
  const worker = new Worker(new URL("data:text/javascript,"+encodeURIComponent(source)), { workerData: url });
  const timer = setTimeout(() => worker.terminate(),30000);
  const stopped = once(worker,"exit").then(([code]) => { throw new Error("Worker завершился: "+code); });
  try {
    for (let i=0; i<requests.length; ++i) {
      const reply = Promise.race([
        once(worker,"message").then(([message]) => message),
        stopped,
      ]);
      worker.postMessage(requests[i]);
      assert.equal(await reply,output[i],"побайтовая эквивалентность ответа "+i);
    }
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
console.log(`STUDIO_S0_PASS: ${requests.length} команд; 6144 пробы, 24 занятых вокселя; ${workerModule ? "native/WASM Worker parity" : "native"}`);
