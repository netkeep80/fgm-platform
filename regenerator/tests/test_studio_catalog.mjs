import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

const [native, workerPath] = process.argv.slice(2);
const request = (action, args = {}) => ({v: 1, action, ...args});
const paths = [
  "ROOT/GEOGRAPH/INTICON.MAP", "ROOT/UNITS/BARN.PCK", "ROOT/README.TXT",
  "ROOT/Maps/Culta00.map", "ROOT/MAPS/MAP3.MAP", "ROOT/MAPS/FOREST00.MAP",
  "ROOT/GeoData/Loftemps.dat", "ROOT/GEODATA/PALETTES.DAT",
  ...["BARN", "BLANKS", "CULTIVAT"].flatMap(id => ["MCD", "PCK", "TAB"].map(ext => "ROOT/TERRAIN/" + id + "." + ext)),
];
const record = () => {const b = Buffer.alloc(62); b[42] = 1; return b;};
const door = record();
door[35] = 1;
const map = Buffer.from([1, 2, 2, 0, 0, 3, 0, 0, 3, 3, 0, 2, 0, 0, 0, 2, 3, 0, 0]);
const data = [["map", map], ["ds0", Buffer.concat([record(), record()])],
  ["ds1", record()], ["ds2", door]];
const append = ([file,bytes]) => request("append",{file,offset:0,hex:bytes.toString("hex")});
const loft = Buffer.alloc(32);
loft.writeUInt16LE(1);
const requests = [
  request("catalog-directory", {paths: [...paths, ...Array.from({length:1383},(_,i)=>`ROOT/SOUND/${i}.DAT`)]}),
  request("catalog-directory", {paths: [...paths, "other/MAPS/CULTA00.MAP"]}),
  request("catalog-directory", {paths: [...paths, "ROOT/TERRAIN/barn.pck"]}),
  request("catalog-directory", {paths: ["ROOT/GEOGRAPH/INTICON.MAP"]}),
  request("catalog-directory", {paths: ["ROOT/MAPS/../CULTA00.MAP"]}),
  ...data.map(append),
  request("catalog-map",{map:"CULTA00"}),
  request("catalog-map",{map:"MAP3"}),
  request("status"),
  ...[["loft",loft],["pck",Buffer.from([0,1,255])],["tab",Buffer.alloc(2)],["palette",Buffer.alloc(3864)]].map(append),
  request("start",{spec:{
    algorithm:"r06-cell/1", coreRevision:"ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b", budget:6144,
    sourceBindings:{map:"map",loft:"loft",datasets:[
      {id:"BLANKS",file:"ds0"}, {id:"CULTIVAT",file:"ds1"}, {id:"BARN",file:"ds2"}
    ],sprite:{dataset:"BARN",pck:"pck",tab:"tab",palette:"palette"}},
    parameters:{tile:[1,0,1],part:"north_wall",material:"stone",frameSlot:0,tabBits:16,paletteIndex:4}
  }}),
  request("step",{runId:1}),
  request("finalize",{runId:1}),
];
const inputs = requests.map(x=>JSON.stringify(x));
const run = spawnSync(native,{input:inputs.join("\n")+"\n",encoding:"utf8",maxBuffer:1024*1024});
assert.equal(run.status,0,run.stderr);
const replies = run.stdout.trimEnd().split("\n");
assert.equal(replies.length,requests.length);
const responses = replies.map(x=>JSON.parse(x));
assert.equal(responses[0].error,undefined,"directory catalog is available");
const catalog = responses[0].catalog;
assert.equal(catalog.schema,"fgmr-ufo-library/1");
assert.deepEqual(catalog.maps.map(m=>m.id),["CULTA00","FOREST00","MAP3"]);
assert.equal(catalog.loft,"ROOT/GeoData/Loftemps.dat");
assert.equal(catalog.palette,"ROOT/GEODATA/PALETTES.DAT");
assert.equal(catalog.paletteIndex,4);
assert.equal(catalog.maps[0].path,"ROOT/Maps/Culta00.map");
assert.deepEqual(catalog.maps[0].datasets,["BLANKS","CULTIVAT","BARN"]);
assert.deepEqual(catalog.maps[0].missing,[]);
assert.deepEqual(catalog.maps[1].missing,["TERRAIN/FOREST.MCD","TERRAIN/FOREST.PCK","TERRAIN/FOREST.TAB"]);
assert.equal(catalog.maps[2].datasets,null);
assert.equal(catalog.terrain.BARN.pck,"ROOT/TERRAIN/BARN.PCK");
assert.equal(responses[1].error,"E_STUDIO_CATALOG_ROOT");
assert.equal(responses[2].error,"E_STUDIO_CATALOG_DUPLICATE");
assert.equal(responses[3].error,"E_STUDIO_CATALOG_ROOT");
assert.equal(responses[4].error,"E_STUDIO_CATALOG_PATH");
const inspected = responses[9].catalog;
assert.equal(inspected.schema,"fgmr-ufo-map-elements/1");
assert.deepEqual(inspected.dimensions,[2,1,2]);
assert.equal(inspected.elements.length,4);
assert.deepEqual(inspected.elements.filter(e=>e.dataset==="CULTIVAT"),[
  {dataset:"CULTIVAT",record:0,part:"floor",tile:[0,0,0],kind:"floor",name:"Пол",instances:2,rightHalf:false}
]);
assert.deepEqual(inspected.elements.filter(e=>e.part==="north_wall").map(e=>[e.tile,e.kind,e.rightHalf]),
  [[[0,0,1],"door",false],[[1,0,1],"door",true]]);
assert.equal(responses[10].error,"E_STUDIO_CATALOG_PROFILE");
assert.equal(responses[11].state,"READY");
assert.equal(responses.at(-1).state,"COMPLETED");
const report = JSON.parse(responses.at(-1).result.report);
assert.equal(report.source.dataset_label, "BARN");
assert.equal(report.source.local_index, 0);
assert.equal(report.right_half, true);

if (workerPath) {
  const {Worker} = await import("node:worker_threads");
  const {once} = await import("node:events");
  const {resolve} = await import("node:path");
  const {pathToFileURL} = await import("node:url");
  const module = pathToFileURL(resolve(workerPath)).href;
  const bootstrap = 'import {parentPort} from "node:worker_threads"; globalThis.self={postMessage:x=>parentPort.postMessage(x)}; await import('+JSON.stringify(module)+'); parentPort.on("message",data=>self.onmessage({data})); parentPort.postMessage("ready");';
  const worker = new Worker(new URL("data:text/javascript,"+encodeURIComponent(bootstrap)));
  try {
    assert.deepEqual(await once(worker,"message"),["ready"]);
    for(const [i,input] of inputs.entries()){
      const reply = once(worker,"message");
      worker.postMessage(input);
      assert.deepEqual(await reply,[replies[i]],"native/WASM reply "+i);
    }
  } finally {
    await worker.terminate();
  }
}
console.log("STUDIO_UFO_CATALOG_PASS");
