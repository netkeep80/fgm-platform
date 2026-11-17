import assert from "node:assert/strict";
import {spawn,spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {once} from "node:events";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {Worker} from "node:worker_threads";

// S43-S1: an accepted B2 Python fixture is the independent input oracle.
// The same C++ sampling function is executed by native CLI, native Studio and WASM Studio.
const [native,sampler,...options]=process.argv.slice(2);
const builderFlag=options.indexOf("--builder");
const builder=builderFlag<0?null:options.splice(builderFlag,2)[1];
assert.ok(builderFlag<0 || builder);
const [workerModule]=options;
assert.ok(native && sampler);
const python=process.env.PYTHON ?? (process.platform==="win32"?"python":"python3");
const coreRevision="ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const canonical=value=>JSON.stringify(value);
const command=(action,fields={})=>JSON.stringify({v:1,action,...fields});
const ctl=(action,runId)=>command(action,{runId});
const requests=[],scenarios=[],tmp=mkdtempSync(join(tmpdir(),"fgmr-s43-s1-"));
const parts=["floor","west_wall","north_wall","object"];

function fixture(name,world,anchor=[0,0,0]) {
  const root=join(tmp,name);
  const mkdir=spawnSync(python,["-c","from pathlib import Path; import sys; Path(sys.argv[1]).mkdir() ",root],{encoding:"utf8"});
  assert.equal(mkdir.status,0,mkdir.stderr);
  const tiles=new Map();
  for(const [x,y,z] of world) {
    const tile=[Math.floor(x/16),Math.floor(y/16),Math.floor(z/24)];
    const key=tile.join(",");
    if(!tiles.has(key))tiles.set(key,{tile,voxels:[]});
    tiles.get(key).voxels.push([x%16,y%16,z%24]);
  }
  assert.ok(tiles.size>=2 && tiles.size<=8);
  const files=[],bindings=[];
  for(const [i,{tile,voxels}] of [...tiles.values()].sort((a,b)=>
    a.tile[0]-b.tile[0]||a.tile[1]-b.tile[1]||a.tile[2]-b.tile[2]).entries()) {
    const xyz=tile.map((x,j)=>x+anchor[j]);
    const rows=Array.from({length:4},()=>Array.from({length:24},()=>Array(16).fill(0)));
    for(const [x,y,z] of voxels)rows[3][z][y]|=(1<<(15-x));
    const sources=parts.map(part=>part==="object"
      ? {part,source_index:2,present:true,dataset_label:"SYNTH",local_index:1,loft_ids:Array(12).fill(0)}
      : {part,source_index:0,present:false});
    const loft={schema:"fgm-regenerator/loft-terrain-v1",voxel_dimensions_xyz:[16,16,24],
      terrain_only:true,tile:{xyz,record_index:i},sources,part_rows:rows};
    const path=join(root,"loft-"+i+".json");
    writeFileSync(path,canonical(loft));
    files.push(path);
    bindings.push({xyz,local_xyz:tile,part:"object",dataset:"SYNTH",record:1,map_record:i});
  }
  const receipt={schema:"fgm-regenerator/verified-membership-input-v1",
    status:"verified_explicit_membership",instance:name,prototype:"synthetic",
    provenance:{kind:"synthetic-test"},anchor_xyz:anchor,cell_bindings:bindings};
  const verified=join(root,"receipt.json");
  writeFileSync(verified,canonical(receipt));
  const result=join(root,"result");
  const args=["scripts/assemble_r06_multicell.py","--verified",verified,
    "--verified-sha256",hash(readFileSync(verified)), "--sampler",sampler,
    "--sampler-sha256",hash(readFileSync(sampler)), "--material","stone",
    "--output",result];
  for(const f of files)args.push("--loft",f);
  const run=spawnSync(python,args,{encoding:"utf8",timeout:90000,maxBuffer:2*1024*1024});
  assert.equal(run.status,0,name+": "+(run.error?.message??run.stderr));
  const model=readFileSync(join(result,"model.fgm.json"),"utf8");
  const slices=JSON.parse(readFileSync(join(result,"slices.json"),"utf8"));
  const cells=slices.cells.map(({local_xyz})=>({local_xyz}));
  const requestFile=join(root,"cells.json");
  writeFileSync(requestFile,canonical({schema:"fgm-regenerator/whole-object-sampling-v1",cells}));
  const cli=spawnSync(sampler,[join(result,"model.fgm.json"),requestFile,"stone"],
    {encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});
  assert.equal(cli.status,0,name+": "+(cli.error?.message??cli.stderr));
  const sample=JSON.parse(cli.stdout);
  assert.equal(sample.cells.length,slices.cells.length);
  for(let i=0;i<sample.cells.length;++i) {
    const rows=slices.cells[i].rows;
    let expected="";
    for(let z=0;z<24;++z)for(let y=0;y<16;++y)for(let x=0;x<16;++x)
      expected+=(rows[z][y] & (1<<(15-x)))?"1":"0";
    assert.equal(sample.cells[i].mask,expected,name+" cell "+i);
  }
  return {model,seed:JSON.parse(model).model.seed,cells,sample,verified,files,result};
}

try {
  const fixtures=[
    fixture("neighbor",[[15,6,4],[16,6,4]]),
    fixture("hole",Array.from({length:3},(_,i)=>14+i).flatMap(x=>
      Array.from({length:3},(_,i)=>14+i).filter(y=>x!==15||y!==15).map(y=>[x,y,3]))),
    fixture("z",[[2,2,23],[2,2,24]],[3,5,7]),
  ];
  for(const [i,c] of fixtures.entries()) {
    const spec={algorithm:"r06-whole-sample/1",coreRevision,seed:c.seed,
      budget:6144*c.cells.length,sourceBindings:[{role:"model",bytes:c.model}],
      parameters:{material:"stone",cells:c.cells}};
    c.spec=spec;
    c.start=requests.push(command("start",{spec}))-1;
    c.step=requests.push(ctl("step",i+1))-1;
    c.done=requests.push(ctl("finalize",i+1))-1;
  }
  const first=fixtures[0];
  const neg=[];
  function negative(name,spec,expected) {
    neg.push({name,index:requests.push(command("start",{spec}))-1,expected});
  }
  negative("wrong seed",{...first.spec,seed:"0".repeat(64)},"E_STUDIO_MODEL");
  negative("incorrect budget",{...first.spec,budget:6143},"E_STUDIO_BUDGET");
  negative("duplicate local",{...first.spec,
    parameters:{...first.spec.parameters,cells:[first.cells[0],first.cells[0]]}},"E_STUDIO_BINDING");
  negative("bad core",{...first.spec,coreRevision:"0".repeat(40)},"E_STUDIO_VERSION");
  // Native B2 supports 49..80; Studio ABI intentionally retains <=48.
  negative("Studio rejects 49-character material",{...first.spec,
    parameters:{...first.spec.parameters,material:"m"+"a".repeat(48)}},"E_STUDIO_BINDING");
  // A semantically wrong material starts successfully, then C05 rejects it.
  const materialCase=requests.push(command("start",{spec:{...first.spec,
    parameters:{...first.spec.parameters,material:"brick"}}}))-1;
  const materialStep=requests.push(ctl("step",4))-1;
  const cancelCase=requests.push(command("start",{spec:first.spec}))-1;
  const cancelStep=requests.push(ctl("cancel",5))-1;
  const staleStep=requests.push(ctl("step",4))-1;
  const cancelledStep=requests.push(ctl("step",5))-1;

  const buildChecks=[];
  if(builder) {
    let nextRun=6;
    const files=["model.fgm.json","slices.json","preview.obj","report.json","input-proof.json"];
    const expect=(request,check)=>buildChecks.push([requests.push(request)-1,check]);
    function stage(file,bytes,chunk=32768) {
      for(let offset=0;offset<bytes.length;offset+=chunk) {
        expect(command("append",{file,offset,hex:bytes.subarray(offset,offset+chunk).toString("hex")}),
          reply=>assert.equal(reply.error,undefined));
      }
      return {file,sha256:hash(bytes)};
    }
    function stageFixture(c, chunk=32768) {
      const receipt=stage("receipt",readFileSync(c.verified),chunk);
      const lofts=c.files.map((path,i)=>stage("loft-"+i,readFileSync(path)));
      return {algorithm:"r06-whole-build/1",coreRevision,budget:6144*lofts.length,
        sourceBindings:{receipt,lofts:[...lofts].reverse()},parameters:{material:"stone"}};
    }
    const dense=fixture("dense",Array.from({length:32*16*24},(_,i)=>[i%32,Math.floor(i/32)%16,Math.floor(i/(32*16))]));
    const artifactFixture=[...fixtures,dense];
    let firstArtifacts;
    for (const [i,c] of artifactFixture.entries()) {
      const spec=stageFixture(c,i===0?91:32768);
      if(i===0) {
        expect(command("start",{spec:{...spec,budget:0}}),r=>assert.equal(r.error,"E_STUDIO_BUDGET"));
        expect(command("start",{spec:{...spec,sourceBindings:{...spec.sourceBindings,
          lofts:[spec.sourceBindings.lofts[0],spec.sourceBindings.lofts[0]]}}}),
          r=>assert.equal(r.error,"E_STUDIO_BINDING"));
      }
      const runId=nextRun++;
      expect(command("start",{spec}),r=>assert.equal(r.state,"RUNNING"));
      expect(command("append",{file:"receipt",offset:0,hex:"00"}),r=>assert.equal(r.error,"E_STUDIO_STATE"));
      expect(ctl("pause",runId),r=>assert.equal(r.state,"PAUSED"));
      expect(ctl("step",runId),r=>assert.equal(r.error,"E_STUDIO_STATE"));
      expect(ctl("resume",runId),r=>assert.equal(r.state,"RUNNING"));
      expect(ctl("step",runId),r=>assert.equal(r.state,"COMPLETED"));
      const cliOutput=join(tmp,"builder-"+i);
      const cli=spawnSync(builder,[c.verified,hash(readFileSync(c.verified)),"stone",cliOutput,
        ...c.files.flatMap(path=>[path,hash(readFileSync(path))])],{encoding:"utf8",timeout:30000});
      assert.equal(cli.status,0,cli.error?.message??cli.stderr);
      const items=files.map((name,index)=>{
        const bytes=readFileSync(join(cliOutput,name));
        if(index<4)assert.deepEqual(bytes,readFileSync(join(c.result,name)),"native CLI vs Python B2");
        return {name,bytes,size:bytes.length,sha256:hash(bytes)};
      });
      if(i===3)assert.ok(items.find(x=>x.name==="preview.obj").size>32768);
      const descriptors=items.map(({name,size,sha256})=>({name,size,sha256}));
      if(i===0)firstArtifacts=descriptors;
      expect(ctl("finalize",runId),r=>assert.deepEqual(r.result.build.artifacts,descriptors));
      for(const {name,bytes,size} of items) {
        for(let offset=0;offset<size;offset+=32768) {
          expect(command("read-build",{runId,artifact:name,offset}),r=>assert.deepEqual(r.chunk,{
            artifact:name,offset,bytes:bytes.subarray(offset,offset+32768).toString("ascii"),eof:offset+32768>=size
          }));
        }
      }
      expect(command("read-build",{runId,artifact:files[0],offset:items[0].size+1}),
        r=>assert.equal(r.error,"E_STUDIO_OFFSET"));
      expect(command("read-build",{runId,artifact:files[0],offset:items[0].size}),
        r=>assert.deepEqual(r.chunk,{artifact:files[0],offset:items[0].size,bytes:"",eof:true}));
      expect(command("read-build",{runId,artifact:"unknown",offset:0}),
        r=>assert.equal(r.error,"E_STUDIO_BINDING"));
      expect(command("read-build",{runId:runId-1,artifact:files[0],offset:0}),r=>assert.equal(r.error,"E_STUDIO_RUN"));
    }
    const spec=stageFixture(first);
    let runId=nextRun++;
    expect(command("start",{spec}),r=>assert.equal(r.state,"RUNNING"));
    expect(ctl("cancel",runId),r=>assert.equal(r.state,"CANCELLED"));
    expect(ctl("step",runId),r=>assert.equal(r.error,"E_STUDIO_STATE"));
    expect(command("read-build",{runId,artifact:files[0],offset:0}),r=>assert.equal(r.error,"E_STUDIO_STATE"));
    const retry=stageFixture(first);
    const retryId=nextRun++;
    expect(command("start",{spec:retry}),r=>assert.equal(r.runId,retryId));
    expect(ctl("step",retryId),r=>assert.equal(r.state,"COMPLETED"));
    expect(ctl("finalize",retryId),r=>assert.deepEqual(r.result.build.artifacts,firstArtifacts));

    const tampered=stageFixture(first);
    tampered.sourceBindings.receipt.sha256="0".repeat(64);
    runId=nextRun++;
    expect(command("start",{spec:tampered}),r=>assert.equal(r.state,"RUNNING"));
    expect(ctl("step",runId),r=>{assert.equal(r.state,"FAILED");assert.equal(r.error,"E_STUDIO_BUILD");});
    expect(ctl("finalize",runId),r=>assert.equal(r.error,"E_STUDIO_STATE"));

    const oversized=stageFixture(first);
    oversized.sourceBindings.receipt=stage("large",Buffer.alloc(65537));
    expect(command("start",{spec:oversized}),r=>assert.equal(r.error,"E_STUDIO_LIMIT"));
    expect(command("clear"),r=>assert.equal(r.error,undefined));
    const fragmented=fixture("fragmented",Array.from({length:32*4*4},(_,i)=>[i%32,Math.floor(i/32)%4,Math.floor(i/(32*4))])
      .filter(p=>p.reduce((a,b)=>a+b,0)%2===0));
    const overBoxes=stageFixture(fragmented);
    runId=nextRun++;
    expect(command("start",{spec:overBoxes}),r=>assert.equal(r.state,"RUNNING"));
    expect(ctl("step",runId),r=>{assert.equal(r.state,"FAILED");assert.equal(r.error,"E_STUDIO_LIMIT");});
  }

  function nativeRun() {
    const proc=spawnSync(native,{input:requests.join("\n")+"\n",encoding:"utf8",
      timeout:60000,maxBuffer:4*1024*1024});
    assert.equal(proc.status,0,proc.error?.message??proc.stderr);
    assert.equal(proc.stderr,"");
    const replies=proc.stdout.trimEnd().split(/\r?\n/);
    assert.equal(replies.length,requests.length);
    return replies;
  }
  const output=nativeRun();
  assert.deepEqual(nativeRun(),output,"native is deterministic");
  const rows=output.map(JSON.parse);
  for(const [index,check] of buildChecks)check(rows[index]);
  for(const [i,c] of fixtures.entries()) {
    assert.equal(rows[c.start].state,"RUNNING");
    assert.equal(rows[c.start].runId,i+1);
    assert.equal(rows[c.step].state,"COMPLETED");
    assert.equal(rows[c.done].state,"COMPLETED");
    assert.deepEqual(rows[c.done].result.whole,c.sample,"same C05 as native CLI");
  }
  for(const {name,index,expected} of neg)assert.equal(rows[index].error,expected,name);
  assert.equal(rows[materialCase].state,"RUNNING");
  assert.equal(rows[materialStep].state,"FAILED");
  assert.equal(rows[materialStep].error,"E_STUDIO_WHOLE");
  assert.equal(rows[cancelCase].state,"RUNNING");
  assert.equal(rows[cancelStep].state,"CANCELLED");
  assert.equal(rows[staleStep].error,"E_STUDIO_RUN");
  assert.equal(rows[cancelledStep].error,"E_STUDIO_STATE");

  if(workerModule) {
    const workerUrl=pathToFileURL(resolve(workerModule)).href;
    const source=`
      import {parentPort,workerData} from "node:worker_threads";
      globalThis.self={postMessage: value=>parentPort.postMessage(value)};
      await import(workerData);
      parentPort.on("message",data=>self.onmessage({data}));
    `;
    const worker=new Worker(new URL("data:text/javascript,"+encodeURIComponent(source)),{workerData:workerUrl});
    const timeout=setTimeout(()=>worker.terminate(),90000);
    const died=once(worker,"exit").then(([code])=>{throw new Error("Worker exited: "+code);});
    try {
      for(let i=0;i<requests.length;++i) {
        const reply=Promise.race([once(worker,"message").then(([message])=>message),died]);
        worker.postMessage(requests[i]);
        assert.equal(await reply,output[i],"native/WASM response byte parity "+i);
      }
    } finally {clearTimeout(timeout);await worker.terminate();}
  }
  if(workerModule && process.env.STUDIO_CHROMIUM) {
    const wasmDir=dirname(resolve(workerModule));
    const page=`<!doctype html><meta charset="utf-8"><body><script type="module">
      const worker=new Worker("./worker.mjs",{type:"module"});
      const pairs=await fetch("./test.json").then(r=>r.json());
      try {
        for(const [request,expected] of pairs) {
          const reply=new Promise((resolve,reject)=>{
            worker.onmessage=e=>resolve(e.data);worker.onerror=reject;
          });
          worker.postMessage(request);
          if(await reply!==expected)throw new Error("parity mismatch");
        }
        document.body.dataset.studioSmoke="PASS";
      }catch{document.body.dataset.studioSmoke="FAIL";}
      finally{worker.terminate();}
    </script></body>`;
    const resources=new Map([
      ["/",["text/html",page]],
      ["/test.json",["application/json",JSON.stringify(requests.map((q,i)=>[q,output[i]]))]],
      ["/worker.mjs",["text/javascript",readFileSync(join(wasmDir,"worker.mjs"))]],
      ["/fgmr-studio.mjs",["text/javascript",readFileSync(join(wasmDir,"fgmr-studio.mjs"))]],
      ["/fgmr-studio.wasm",["application/wasm",readFileSync(join(wasmDir,"fgmr-studio.wasm"))]],
    ]);
    const unknown=[];
    const server=createServer((request,response)=>{
      const item=resources.get(request.url);
      if(!item || request.method!=="GET") {
        if(request.url!=="/favicon.ico")unknown.push(request.url);
        response.writeHead(404).end();return;
      }
      response.writeHead(200,{"Content-Type":item[0]}).end(item[1]);
    });
    const profile=mkdtempSync(join(tmpdir(),"fgmr-s43-browser-"));
    await new Promise(done=>server.listen(0,"127.0.0.1",done));
    try {
      const proc=spawn(process.execPath,["scripts/rv01-cdp.mjs",process.env.STUDIO_CHROMIUM,
        `http://127.0.0.1:${server.address().port}/`,profile,"studio"],{stdio:"inherit"});
      const [code]=await once(proc,"exit");
      assert.equal(code,0);
      assert.deepEqual(unknown,[]);
    } finally {server.close();rmSync(profile,{recursive:true,force:true});}
  }
  if(builder)console.log(`R06_ABI_S2B_PASS: 4 builds, ${buildChecks.length} commands, native CLI/Python B2${workerModule?"/WASM Worker":""} parity`);
  console.log(`R06_ABI_S1_PASS: 3 accepted B2 synthetic fixtures; ${requests.length} commands; exact native/CLI${workerModule?"/WASM Worker":""} parity`);
} finally {
  rmSync(tmp,{recursive:true,force:true});
}
