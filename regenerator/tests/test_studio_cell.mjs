import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync,readFileSync,rmSync,writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const [native, workerModule] = process.argv.slice(2);
const coreRevision = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const hash = x => createHash("sha256").update(x).digest("hex");
const command = (action, fields = {}) => JSON.stringify({ v: 1, action, ...fields });
const control = (action, runId) => command(action,{runId});
const fixture = () => {
  const map = Buffer.from([1,1,1,0,1,2,2]);
  const blanks = Buffer.alloc(2*62);
  blanks[42] = blanks[62+42] = 1;
  const terrain = Buffer.alloc(62);
  terrain[42] = 1;
  terrain.fill(1,8,20);
  terrain[8] = 0;
  const loft = Buffer.alloc(64);
  for (let y = 3; y < 6; ++y) loft.writeUInt16LE(0x3800,y*2);
  const pck = Buffer.from([0,42,255]);
  return {map,blanks,terrain,loft,pck,tab:Buffer.alloc(2),palette:Buffer.alloc(768)};
};
const spec = () => ({
  algorithm:"r06-cell/1", coreRevision, budget:6144,
  sourceBindings:{map:"map",loft:"loft",datasets:[{id:"BLANKS",file:"blanks"},{id:"TERRAIN",file:"terrain"}],
    sprite:{dataset:"TERRAIN",pck:"pck",tab:"tab",palette:"palette"}},
  parameters:{tile:[0,0,0],part:"north_wall",material:"stone",frameSlot:0,tabBits:16,paletteIndex:0},
});
const append = (file, bytes, offset=0) => command("append",{file,offset,hex:bytes.toString("hex")});
const requests = [];
const cases = [];
function scenario(name, change, expected) {
  const pack=fixture(), input=spec();
  change(pack,input);
  requests.push(command("clear"));
  for (const [file,bytes] of Object.entries(pack)) requests.push(append(file,bytes));
  const start=requests.push(command("start",{spec:input}))-1;
  if (expected?.start) {
    cases.push({name,start,expected});
  } else {
    const runId=cases.filter(c=>!c.expected?.start).length+1;
    const step=requests.push(control("step",runId))-1;
    const done=requests.push(control("finalize",runId))-1;
    cases.push({name,start,step,done,expected,pack,input});
  }
}

scenario("north",()=>{});
scenario("object",(_,s)=>{s.parameters.part="object";});
scenario("zero as absent MAP id",(_,s)=>{s.parameters.part="floor";},{step:"E_STUDIO_PART"});
scenario("explicit order",(_,s)=>{s.sourceBindings.datasets.reverse();},{step:"E_STUDIO_SPRITE_BINDING"});
scenario("missing palette",(f)=>{delete f.palette;},{start:"E_STUDIO_BINDING"});
scenario("invalid map",(f)=>{f.map=f.map.subarray(0,-1);},{step:"E_R02_MAP_LENGTH"});
scenario("invalid PCK",(f)=>{f.pck[2]=0;},{step:"E_R04_FRAME_TERMINATOR"});
scenario("invalid TAB",(f)=>{f.tab[0]=1;},{step:"E_R04_TAB_OFFSET"});
scenario("out-of-range LOFT",(f)=>{f.terrain[8]=9;},{step:"E_R03_LOFT_REFERENCE"});
scenario("empty cell mask",(f)=>{f.loft.fill(0);});

const hole=requests.push(append("hole",Buffer.from([1]),1))-1;
const large=requests.push(append("large",Buffer.alloc(32769)))-1;
const badHex=requests.push(command("append",{file:"x",offset:0,hex:"zz"}))-1;
requests.push(command("clear"));
const blocked=[];
for(let index=0;index<=128;index++) blocked.push(requests.push(append("full",Buffer.alloc(32768),index*32768))-1);
requests.push(command("clear"));

const child=spawnSync(native,{input:requests.join("\n")+"\n",encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024});
assert.equal(child.status,0,child.error?.message ?? child.stderr);
assert.equal(child.stderr,"");
const output=child.stdout.trimEnd().split(/\r?\n/);
assert.equal(output.length,requests.length);
const rows=output.map(x=>JSON.parse(x));
assert.equal(rows[hole].error,"E_STUDIO_OFFSET");
assert.equal(rows[large].error,"E_STUDIO_LIMIT");
assert.equal(rows[badHex].error,"E_STUDIO_HEX");
assert.equal(rows[blocked.at(-2)].error,undefined);
assert.equal(rows[blocked.at(-1)].error,"E_STUDIO_LIMIT");

for (const c of cases) {
  if(c.expected?.start) {
    assert.equal(rows[c.start].error,c.expected.start,c.name);
    assert.deepEqual(Object.keys(rows[c.start]).sort(),["error","runId","state","v"]);
    continue;
  }
  assert.equal(rows[c.start].state,"RUNNING",c.name);
  if(c.expected?.step) {
    assert.equal(rows[c.step].state,"FAILED",c.name);
    assert.equal(rows[c.step].error,c.expected.step,c.name);
    assert.deepEqual(Object.keys(rows[c.step]).sort(),["error","runId","state","v"]);
    assert.equal(rows[c.done].result,undefined);
    continue;
  }
  assert.equal(rows[c.step].state,"COMPLETED",c.name);
  const {model,preview,report,proof,visual}=rows[c.done].result;
  const parsed=JSON.parse(report);
  const observed=JSON.parse(visual);
  const proofJson=JSON.parse(proof);
  assert.equal(proofJson.r05_visual_sha256,hash(visual),c.name);
  assert.equal(observed.schema,"fgmr-studio-r05-observation/1",c.name);
  assert.equal(observed.coordinate_frame,"r05-ufo-dimetric/1",c.name);
  assert.deepEqual(observed.tile,[0,0,0],c.name);
  assert.deepEqual(observed.tile_anchor,[0,0],c.name);
  assert.deepEqual(observed.sprite.anchor,[0,0],c.name);
  assert.equal(observed.sprite.width,32,c.name);
  assert.equal(observed.sprite.height,40,c.name);
  assert.equal(observed.sprite.indices_hex.length,32*40*2,c.name);
  assert.equal(observed.sprite.indices_hex.slice(0,4),"2a00",c.name);
  assert.equal(observed.sprite.palette_rgb8.length,256,c.name);
  assert.deepEqual(observed.sprite.palette_rgb8[42],[0,0,0],c.name);
  assert.equal(observed.sprite.transparent_index,0,c.name);
  assert.equal(observed.sprite.right_half,parsed.right_half,c.name);
  assert.deepEqual(observed.silhouette,parsed.silhouette,c.name);
  const asKey=([x,y])=>x+","+y;
  const predictedKeys=new Set(observed.predicted.map(asKey));
  const observedKeys=new Set(observed.observed.map(asKey));
  assert.equal(predictedKeys.size,observed.predicted.length,c.name);
  assert.equal(observedKeys.size,observed.observed.length,c.name);
  for(const key of [...predictedKeys,...observedKeys])
    assert.match(key,/^-?\d+,-?\d+$/,c.name);
  const common=[...predictedKeys].filter(key=>observedKeys.has(key)).length;
  assert.deepEqual(observed.silhouette,{
    common,predicted_only:predictedKeys.size-common,
    observed_only:observedKeys.size-common
  },c.name);
  assert.deepEqual(observed.observed,c.name==="object"?[[0,0]]:[],c.name);
  const order=(a,b)=>a[0]-b[0]||a[1]-b[1];
  assert.deepEqual(observed.predicted,[...observed.predicted].sort(order),c.name);
  assert.deepEqual(observed.observed,[...observed.observed].sort(order),c.name);
  assert.equal(parsed.occupied,c.name==="empty cell mask"?0:18,c.name);
  assert.deepEqual(parsed.source,{dataset_label:"TERRAIN",local_index:0,part:c.input.parameters.part});
  assert.equal(parsed.right_half,c.input.parameters.part==="north_wall");
  assert.equal(parsed.package_bytes_sha256,hash(model));
  assert.equal(JSON.parse(proof).mesh_sha256,hash(preview));
  assert.equal(JSON.parse(proof).report_sha256,hash(report));
  assert.equal(parsed.input_sha256.map,hash(c.pack.map));
  assert.equal(parsed.input_sha256.palette,hash(c.pack.palette));
  assert.equal(parsed.input_sha256.selected_mcd,hash(c.pack.terrain));
  assert.deepEqual(parsed.dataset_order,[{id:"BLANKS",sha256:hash(c.pack.blanks)},{id:"TERRAIN",sha256:hash(c.pack.terrain)}]);
  const fg=JSON.parse(model);
  const seedInput=JSON.stringify(["fgm:seed:1",{generation:fg.generation,purpose:"model"}]);
  assert.equal(fg.model.seed,hash(seedInput));
  if(c.name!=="empty cell mask") {
    assert.match(preview,/v 2 3 0\n/);
    assert.equal(preview.split("\n").filter(line=>line.startsWith("f ")).length,42);
  } else assert.equal(preview,"o terrain\n");
}

// The previous native R06 command acts as a separate oracle for frozen export bytes.
for (const c of cases.filter(x=>!x.expected)) {
  const target=mkdtempSync(join(tmpdir(),"fgmr-s1-"));
  const bin=dirname(resolve(native));
  const exe=name=>join(bin,name+(process.platform==="win32"?".exe":""));
  const path=name=>join(target,name);
  function legacy(file,args) {
    const result=spawnSync(file,args,{encoding:"utf8",timeout:30000});
    assert.equal(result.status,0,result.error?.message ?? result.stderr);
    return result.stdout;
  }
  try {
    for (const [id,bytes] of Object.entries(c.pack)) writeFileSync(path(id),bytes);
    writeFileSync(path("loft.json"),legacy(exe("fgmr-r03"),[
      "--map",path("map"),"--mcd",`BLANKS=${path("blanks")}`,"--mcd",`TERRAIN=${path("terrain")}`,
      "--loft",path("loft"),"--tile","0,0,0"]));
    writeFileSync(path("sprite.json"),legacy(exe("fgmr-r04"),[
      "--pck",path("pck"),"--tab",path("tab"),"--palette",path("palette"),"--mcd",path("terrain"),
      "--tab-bits","16","--palette-index","0","--record","0"]));
    legacy(process.env.PYTHON ?? "python",[
      "scripts/reconstruct_r06.py","--loft",path("loft.json"),"--sprite",path("sprite.json"),
      "--sampler",exe("fgmr-r06-sample"),"--output",path("legacy"),
      "--part",c.input.parameters.part,"--material","stone","--slot","0","--p-level","0"]);
    const {model,preview,report}=rows[c.done].result;
    assert.equal(model,readFileSync(path("legacy/model.fgm.json"),"utf8"));
    assert.equal(preview,readFileSync(path("legacy/preview.obj"),"utf8"));
    assert.deepEqual(JSON.parse(report).silhouette,
      JSON.parse(readFileSync(path("legacy/report.json"),"utf8")).silhouette);
    if (c.name==="north") {
      const binding=Object.fromEntries(Object.keys(c.pack).map(id=>[id,path(id)]));
      writeFileSync(path("local.json"),JSON.stringify({files:binding,spec:c.input}));
      const smoke=spawnSync(process.execPath,["scripts/smoke_studio_cell.mjs",native,path("local.json")],{encoding:"utf8",timeout:30000});
      assert.equal(smoke.status,0);
      assert.equal(smoke.stderr,"");
      assert.equal(smoke.stdout.trim(),"STUDIO_S1_LOCAL_PASS");
    }
  } finally {rmSync(target,{recursive:true,force:true});}
}

if(workerModule) {
  const source=`
    import { parentPort,workerData } from "node:worker_threads";
    globalThis.self={postMessage: value=>parentPort.postMessage(value)};
    await import(workerData);
    parentPort.on("message",data=>self.onmessage({data}));
  `;
  const worker=new Worker(new URL("data:text/javascript,"+encodeURIComponent(source)),{workerData:pathToFileURL(resolve(workerModule)).href});
  const stopped=once(worker,"exit").then(([code])=>{throw new Error("Worker exited "+code);});
  const timer=setTimeout(()=>worker.terminate(),60000);
  try {
    for(let i=0;i<requests.length;++i) {
      const next=Promise.race([once(worker,"message").then(([message])=>message),stopped]);
      worker.postMessage(requests[i]);
      assert.equal(await next,output[i],"parity "+i);
    }
  } finally {clearTimeout(timer); await worker.terminate();}
}
if (process.env.STUDIO_CHROMIUM) {
  const wasmDir=dirname(resolve(workerModule));
  const page=`<!doctype html><meta charset="utf-8"><body><script type="module">
  const worker=new Worker("./worker.mjs",{type:"module"});
  const list=await fetch("./test.json").then(response=>response.json());
  try {
    for (const [request,expected] of list) {
      const reply=new Promise((resolve,reject)=>{
        worker.onmessage=e=>resolve(e.data);
        worker.onerror=reject;
      });
      worker.postMessage(request);
      if (await reply!==expected) throw new Error("worker parity");
    }
    document.body.dataset.studioSmoke="PASS";
  } catch {
    document.body.dataset.studioSmoke="FAIL";
  } finally {worker.terminate();}
  </script></body>`;
  const fixtureBounds=cases.at(-1).done+1;
  const available=new Map([
    ["/",["text/html",page]],
    ["/test.json",["application/json",JSON.stringify(requests.slice(0,fixtureBounds).map((request,i)=>[request,output[i]]))]],
    ["/worker.mjs",["text/javascript",readFileSync(join(wasmDir,"worker.mjs"))]],
    ["/fgmr-studio.mjs",["text/javascript",readFileSync(join(wasmDir,"fgmr-studio.mjs"))]],
    ["/fgmr-studio.wasm",["application/wasm",readFileSync(join(wasmDir,"fgmr-studio.wasm"))]],
  ]);
  const unexpected=[];
  const server=createServer((request,response)=>{
    const asset=available.get(request.url);
    if (!asset || request.method!=="GET") {
      if (request.url!=="/favicon.ico") unexpected.push(request.url);
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200,{"Content-Type":asset[0]}).end(asset[1]);
  });
  const profile=mkdtempSync(join(tmpdir(),"fgmr-s1-chromium-"));
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const child=spawn(process.execPath,["scripts/rv01-cdp.mjs",process.env.STUDIO_CHROMIUM,
      `http://127.0.0.1:${server.address().port}/`,profile,"studio"],{stdio:"inherit"});
    const [status]=await once(child,"exit");
    assert.equal(status,0);
    assert.deepEqual(unexpected,[]);
  } finally {
    server.close();
    rmSync(profile,{recursive:true,force:true});
  }
}
console.log(`STUDIO_S1_PASS: ${cases.length} fixtures, ${requests.length} commands, ordered dataset, hashes and export ${workerModule?"native/WASM parity":"native"}`);
