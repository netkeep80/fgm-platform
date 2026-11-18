import {localBrowserContext} from './local-browser.mjs';
/** S3-S2B: pinned C++20 WASM BuildWholeObject output -> exact bytes -> RendererSession. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {execFileSync} from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root=resolve(process.argv[2] ?? "build/pages-studio");
const lock=JSON.parse(readFileSync("studio/engine-lock.json","utf8"));
const manifest=JSON.parse(readFileSync(join(root,"studio-manifest.json"),"utf8"));
assert.equal(lock.workerProtocol,1);
assert.equal(lock.wholeBuild,"r06-whole-build/1");
assert.equal(manifest.engine.core,lock.core);
assert.ok(["fgmp-studio-bundle/1","fgmp-studio-pages/1"].includes(manifest.schema));
assert.equal(manifest.platform.revision,execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim());
assert.equal(manifest.platform.tree,execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim());
assert.equal("regenerator" in manifest,false);
const files=new Map();
for(const name of ["engine/worker.mjs","engine/fgmr-studio.mjs","engine/fgmr-studio.wasm"]){
  const bytes=readFileSync(join(root,name));
  assert.equal(createHash("sha256").update(bytes).digest("hex"),manifest.assets[name],name+" pinned SHA");
  files.set("/"+name,bytes);
}
const runtime=readFileSync("build/renderer-session-runtime/runtime/renderer-session-v1.js");
files.set("/runtime.js",runtime);
files.set("/",Buffer.from('<!doctype html><html lang="ru"><body><canvas id="out" width="420" height="280"></canvas></body></html>'));
const types={".wasm":"application/wasm",".mjs":"text/javascript",".js":"text/javascript"};
const unknown=[];
const server=createServer((req,res)=>{
  const bytes=files.get(req.url??"");
  if(!bytes || req.method!=="GET"){
    if(req.url!=="/favicon.ico")unknown.push(req.url);
    res.writeHead(404).end();return;
  }
  const mime=Object.entries(types).find(([ext])=>req.url?.endsWith(ext))?.[1] ?? "text/html; charset=utf-8";
  res.writeHead(200,{"Content-Type":mime,"Cache-Control":"no-store","Cross-Origin-Resource-Policy":"same-origin"}).end(bytes);
});
await new Promise(done=>server.listen(0,"127.0.0.1",done));
let browser,network;
try {
  browser=await chromium.launch({headless:true,channel:process.env.FGM_CHROMIUM?undefined:"chromium",
    executablePath:process.env.FGM_CHROMIUM,args:[
    "--no-sandbox","--enable-unsafe-webgpu","--use-angle=swiftshader","--enable-unsafe-swiftshader"
  ]});
  network=await localBrowserContext(browser);
  await test("Chromium: pinned C++20/WASM -> RendererSession WebGPU (2, 4, 8 cells; bounded readback)",{
    timeout:180000
  },async()=>{
    const page=await network.context.newPage();
    const errors=[];
    page.on("pageerror",e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const report=await page.evaluate(async ({core,wholeBuild})=>{
      const {createRendererSessionV1,geometryCacheKey,sceneCacheKey,presentationCacheKey}=await import("/runtime.js");
      const enc=new TextEncoder();
      const bytes=s=>enc.encode(s);
      const sha=async a=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",a))]
        .map(x=>x.toString(16).padStart(2,"0")).join("");
      const hex=x=>[...x].map(y=>y.toString(16).padStart(2,"0")).join("");
      const parts=["floor","west_wall","north_wall","object"];
      function fixture(world,name){
        const tiles=new Map();
        for(const [x,y,z] of world){
          const tile=[Math.floor(x/16),Math.floor(y/16),Math.floor(z/24)],key=tile.join(",");
          if(!tiles.has(key))tiles.set(key,{tile,voxels:[]});
          tiles.get(key).voxels.push([x%16,y%16,z%24]);
        }
        if(![2,4,8].includes(tiles.size))throw Error("E_TEST_CELLS");
        const records=[...tiles.values()].sort((a,b)=>a.tile[0]-b.tile[0]||a.tile[1]-b.tile[1]||a.tile[2]-b.tile[2]);
        const lofts=[],bindings=[];
        for(const [i,{tile,voxels}] of records.entries()){
          const rows=parts.map(()=>Array.from({length:24},()=>Array(16).fill(0)));
          for(const [x,y,z] of voxels)rows[3][z][y]|=1<<(15-x);
          const sources=parts.map(part=>part==="object"
            ? {part,source_index:2,present:true,dataset_label:"SYNTH",local_index:1,loft_ids:Array(12).fill(0)}
            : {part,source_index:0,present:false});
          lofts.push(bytes(JSON.stringify({schema:"fgm-regenerator/loft-terrain-v1",
            voxel_dimensions_xyz:[16,16,24],terrain_only:true,
            tile:{xyz:tile,record_index:i},sources,part_rows:rows})));
          bindings.push({xyz:tile,local_xyz:tile,part:"object",dataset:"SYNTH",record:1,map_record:i});
        }
        const receipt=bytes(JSON.stringify({schema:"fgm-regenerator/verified-membership-input-v1",
          status:"verified_explicit_membership",instance:name,prototype:"synthetic",
          provenance:{kind:"synthetic-test"},anchor_xyz:[0,0,0],cell_bindings:bindings}));
        return {receipt,lofts,count:records.length};
      }
      function communicate(worker,request){
        return new Promise((resolve,reject)=>{
          const onMessage=e=>{cleanup();if(typeof e.data!=="string")return reject(Error("E_WORKER_TYPE"));
            try{const parsed=JSON.parse(e.data);if(parsed.error)reject(Error(parsed.error));else resolve(parsed)}
            catch(error){reject(error)}};
          const onError=e=>{cleanup();reject(Error("E_WORKER_ERROR:"+e.message))};
          const cleanup=()=>{worker.removeEventListener("message",onMessage);worker.removeEventListener("error",onError)};
          worker.addEventListener("message",onMessage,{once:true});
          worker.addEventListener("error",onError,{once:true});
          worker.postMessage(JSON.stringify({v:1,...request}));
        });
      }
      async function build(worker,fixture){
        const send=(action,rest={})=>communicate(worker,{action,...rest});
        await send("clear");
        const input=[fixture.receipt,...fixture.lofts];
        const hashes=await Promise.all(input.map(sha));
        for(const [i,blob] of input.entries()){
          const key=i===0?"receipt":"loft"+(i-1);
          for(let offset=0;offset<blob.length;offset+=16384)
            await send("append",{file:key,offset,hex:hex(blob.subarray(offset,offset+16384))});
        }
        const spec={algorithm:wholeBuild,coreRevision:core,budget:6144*fixture.count,
          sourceBindings:{receipt:{file:"receipt",sha256:hashes[0]},
            lofts:fixture.lofts.map((_,i)=>({file:"loft"+i,sha256:hashes[i+1]}))},
          parameters:{material:"stone"}};
        const started=await send("start",{spec});
        if(started.state!=="RUNNING")throw Error("E_WASM_START");
        const stepped=await send("step",{runId:started.runId});
        if(stepped.state!=="COMPLETED")throw Error("E_WASM_STEP");
        const finalized=await send("finalize",{runId:started.runId});
        if(finalized.state!=="COMPLETED")throw Error("E_WASM_FINALIZE");
        const descriptors=finalized.result?.build?.artifacts;
        const names=["model.fgm.json","slices.json","preview.obj","report.json","input-proof.json"];
        if(!Array.isArray(descriptors)||descriptors.length!==names.length||
           descriptors.some((x,i)=>x.name!==names[i]||!Number.isSafeInteger(x.size)||x.size<1||
             x.size>1048576||!/^[a-f0-9]{64}$/.test(x.sha256)))throw Error("E_WASM_DESCRIPTOR");
        const output={};
        for(const item of descriptors){
          let off=0,value="";
          while(off<item.size){
            const response=await send("read-build",{runId:started.runId,artifact:item.name,offset:off});
            const chunk=response.chunk;
            if(chunk?.artifact!==item.name||chunk.offset!==off||typeof chunk.bytes!=="string"||
               !chunk.bytes.length||chunk.bytes.length>32768||chunk.bytes.length>item.size-off||
               chunk.eof!==(off+chunk.bytes.length===item.size))throw Error("E_WASM_CHUNK");
            off+=chunk.bytes.length;value+=chunk.bytes;
          }
          const raw=bytes(value);
          if(raw.length!==item.size || await sha(raw)!==item.sha256)throw Error("E_WASM_DIGEST");
          output[item.name]=raw;
        }
        const parse=name=>JSON.parse(new TextDecoder().decode(output[name]));
        const model=parse("model.fgm.json"),slices=parse("slices.json"),report=parse("report.json"),proof=parse("input-proof.json");
        if(model.format!=="fgm-package/1"||slices.schema!=="fgm-regenerator/slice-by-cell-v1"||
           slices.cells.length!==fixture.count||report.checked_centers!==6144*fixture.count||
           proof.schema!=="fgm-regenerator/whole-build-proof-v1"||proof.receipt_sha256!==hashes[0]||
           proof.verification_scope!=="transport_integrity_binding_c05"||
           proof.reran_b1!==false||proof.rederived_r03!==false||
           report.model_sha256!==await sha(output["model.fgm.json"])||
           report.preview_sha256!==await sha(output["preview.obj"])||
           proof.package_sha256!==report.model_sha256)throw Error("E_WASM_PROOF");
        return {output,model,slices,report,proof,spec};
      }
      function viewFor(count,selected){return {schema:"fgmv-view-state/1",revision:"view-1",
        camera:{kind:"orbit-3d",yaw:0.7,pitch:0.5,distance:count===8?2:3,focusWorld:{x:16,y:count>=4?16:8,z:12}},
        viewport:{width:count===8?3840:420,height:count===8?2160:280,pixelRatio:1},showCellGrid:true,selectedCell:selected};}
      async function sceneFromBuild(built,label){
        const pkg=built.output["model.fgm.json"],obj=built.output["preview.obj"];
        const pkgSha=await sha(pkg),objSha=await sha(obj),pSha=await sha(bytes(JSON.stringify(built.spec)));
        const geometry={schema:"fgmv-derived-geometry/1",sourcePackageSha256:pkgSha,
          meshSha256:objSha,meshFormat:"obj/1",cellBindings:built.slices.cells.map(x=>({
            x:x.local_xyz[0],y:x.local_xyz[1],z:x.local_xyz[2]})),
          recipe:{schema:"fgmv-geometry-recipe/1",algorithmId:"r06-whole-build",
            algorithmVersion:"1",parametersSha256:pSha,
            deterministicSeed:String(built.model.model?.seed??"none"),detailDepth:0}};
        const snapshot={schema:"fgmv-scene-snapshot/1",revision:label,models:[{
          key:"whole",package:{format:"fgm-package/1",packageSha256:pkgSha,byteLength:pkg.length}}],
          instances:[{instanceId:"obj-1",modelKey:"whole",stateRevision:"static",
            placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:0,units:"fgm-voxel"}}]};
        return {snapshot,packages:[{modelKey:"whole",bytes:pkg}],geometries:[{geometry,bytes:obj}]};
      }
      const canvas=document.getElementById("out"),ctx=canvas.getContext("2d");
      const visible=()=>{const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        let pixels=0;for(let i=0;i<data.length;i+=4){
          if(data[i+3]!==0 && (data[i]!==16||data[i+1]!==27||data[i+2]!==43))pixels++;
        }return pixels;};
      const cleared=()=>{const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
        for(let i=3;i<data.length;i+=4)if(data[i]!==0)return false;return true;};
      const result=[];
      for(const [name,world] of [
        ["neighbor-2x1",[[15,6,4],[16,6,4]]],
        ["ring-2x2",Array.from({length:3},(_,i)=>14+i).flatMap(x=>
          Array.from({length:3},(_,i)=>14+i).filter(y=>x!==15||y!==15).map(y=>[x,y,3]))],
        ["span-4x2",Array.from({length:34},(_,i)=>15+i).flatMap(x=>[[x,15,4],[x,16,4]])]]){
        const source=fixture(world,name),worker=new Worker("/engine/worker.mjs",{type:"module"});
        let built;
        try { built=await build(worker,source); } finally {worker.terminate()}
        const sceneRequest=await sceneFromBuild(built,name);
        const firstPkg=sceneRequest.packages[0].bytes.slice(),firstObj=sceneRequest.geometries[0].bytes.slice();
        const session=await createRendererSessionV1({canvas,preferredBackend:"canvas2d-diagnostic",fallbackPolicy:"reject"});
        const pending=session.loadScene(sceneRequest);
        sceneRequest.packages[0].bytes.fill(88);sceneRequest.geometries[0].bytes.fill(88);
        const scene=await pending;
        const selected=sceneRequest.geometries[0].geometry.cellBindings.at(-1);
        const view=viewFor(source.count,selected),v=session.setView(view);
        const context={expectedSceneRevision:scene.sceneRevision,expectedViewRevision:v.viewRevision,sessionEpoch:v.sessionEpoch};
        const rendered=await session.renderFrame(context);
        if(rendered.status!=="rendered"||visible()<20)throw Error("E_WASM_SESSION_RENDER");
        const geom=sceneRequest.geometries[0].geometry;
        const meshKey=geometryCacheKey(geom),sKey=sceneCacheKey(geom,sceneRequest.snapshot);
        const moved={...sceneRequest.snapshot,instances:[{...sceneRequest.snapshot.instances[0],
          placement:{...sceneRequest.snapshot.instances[0].placement,translation:{x:8,y:0,z:0}}}]};
        if(meshKey!==geometryCacheKey(geom)||sKey===sceneCacheKey(geom,moved)||
           presentationCacheKey(geom,sceneRequest.snapshot,view)===
             presentationCacheKey(geom,sceneRequest.snapshot,{...view,revision:"view-next"}))
          throw Error("E_WASM_CACHE_IDENTITY");
        const poison=(key)=>{const request={...sceneRequest,packages:[{modelKey:"whole",bytes:firstPkg.slice()}],
          geometries:[{geometry:geom,bytes:firstObj.slice()}]};
          if(key==="obj")request.geometries[0].bytes[0]^=1;
          if(key==="pkg")request.packages[0].bytes[0]^=1;
          if(key==="binding")request.snapshot={...sceneRequest.snapshot,instances:[{
            ...sceneRequest.snapshot.instances[0],modelKey:"missing"}]};
          if(key==="source")request.geometries[0].geometry={...geom,
            sourcePackageSha256:"0".repeat(64)};
          return request;};
        for(const kind of ["obj","pkg","binding","source"]){
          // First redraw, so each failed load must clear a *visible* previous frame.
          const newValid=poison("none");
          const loaded=await session.loadScene(newValid), vv=session.setView(view);
          await session.renderFrame({expectedSceneRevision:loaded.sceneRevision,
            expectedViewRevision:vv.viewRevision,sessionEpoch:vv.sessionEpoch});
          if(visible()<20)throw Error("E_WASM_PRENEGATIVE");
          try{await session.loadScene(poison(kind));throw Error("E_WASM_NEGATIVE_MISSED_"+kind)}
          catch(error){if(!/^E_SESSION_(DIGEST|BINDING)$/.test(error.message))throw error}
          if(!cleared())throw Error("E_WASM_OLD_FRAME_"+kind);
        }
        await session.dispose();if(!cleared())throw Error("E_WASM_DISPOSE_FRAME");
        const gpuCanvas=document.createElement("canvas");
        document.body.append(gpuCanvas);
        const requestDevice=GPUAdapter.prototype.requestDevice;
        let device;
        let gpu;
        GPUAdapter.prototype.requestDevice=async function(...args){
          device=await requestDevice.apply(this,args);
          return device;
        };
        try {
          gpu=await createRendererSessionV1({canvas:gpuCanvas,preferredBackend:"webgpu",fallbackPolicy:"reject"});
        } finally {
          GPUAdapter.prototype.requestDevice=requestDevice;
        }
        if(gpu.capabilities.backendKind!=="webgpu")throw Error("E_TEST_WEBGPU_FALLBACK");
        const gpuScene=await gpu.loadScene(poison("none")), gpuView=gpu.setView(view);
        const gpuContext={expectedSceneRevision:gpuScene.sceneRevision,
          expectedViewRevision:gpuView.viewRevision,sessionEpoch:gpuView.sessionEpoch};
        const startedAt=performance.now();
        const gpuFrame=await gpu.renderFrame(gpuContext);
        const frameMs=Math.round(performance.now()-startedAt);
        const presentation=gpuCanvas.getContext("2d");
        const pixels=()=>presentation.getImageData(0,0,gpuCanvas.width,gpuCanvas.height).data;
        const framePixels=pixels();
        let geometryPixels=0,selectedPixels=0;
        for(let i=0;i<framePixels.length;i+=4){
          const r=framePixels[i],g=framePixels[i+1],b=framePixels[i+2];
          if((r===102&&g===140&&b===156)||(r===81&&g===116&&b===133))geometryPixels++;
          if(r===255&&g===202&&b===98)selectedPixels++;
        }
        if(gpuFrame.status!=="rendered"||geometryPixels<20||selectedPixels===0)
          throw Error("E_TEST_WEBGPU_PIXELS:"+gpuFrame.status+":"+geometryPixels+":"+selectedPixels);
        const blank=()=>!pixels().some((value,index)=>index%4===3&&value!==0);
        let faults;
        if(source.count===2){
          const map=GPUBuffer.prototype.mapAsync;
          const createBuffer=GPUDevice.prototype.createBuffer;
          const createTexture=GPUDevice.prototype.createTexture;
          const destroyBuffer=GPUBuffer.prototype.destroy;
          const renderFailure=async reason=>{
            const result=await gpu.renderFrame(gpuContext);
            if(result.status!=="failed"||result.reason!==reason||!blank())
              throw Error("E_TEST_GPU_FAILURE:"+JSON.stringify(result));
          };
          const retry=async()=>{
            if((await gpu.renderFrame(gpuContext)).status!=="rendered"||blank())
              throw Error("E_TEST_GPU_RETRY");
          };
          try {
            GPUBuffer.prototype.mapAsync=function(){
              return Promise.reject(new DOMException("Synthetic readback rejection","OperationError"));
            };
            await renderFailure("E_SESSION_GPU_READBACK");
          } finally {
            GPUBuffer.prototype.mapAsync=map;
          }
          await retry();
          const destroyTexture=GPUTexture.prototype.destroy;
          const cleanupCase=async rejectReadback=>{
            let readBuffer,throwCount=0;
            const destroyed={read:0,vertex:0,textures:0};
            try{
              GPUBuffer.prototype.mapAsync=function(...args){
                if((this.usage&GPUBufferUsage.MAP_READ)!==0){
                  readBuffer=this;
                  if(rejectReadback)return Promise.reject(new DOMException("Injected readback rejection","OperationError"));
                }
                return map.apply(this,args);
              };
              GPUBuffer.prototype.destroy=function(...args){
                const value=destroyBuffer.apply(this,args);
                if((this.usage&GPUBufferUsage.MAP_READ)!==0)destroyed.read++;
                else destroyed.vertex++;
                if(this===readBuffer){
                  throwCount++;
                  throw new Error("Injected GPUBuffer.destroy failure");
                }
                return value;
              };
              GPUTexture.prototype.destroy=function(...args){
                destroyed.textures++;
                return destroyTexture.apply(this,args);
              };
              await renderFailure(rejectReadback?"E_SESSION_GPU_READBACK":"E_SESSION_GPU_FRAME");
              if(throwCount!==1||destroyed.read!==1||destroyed.vertex!==1||destroyed.textures!==2)
                throw Error("E_TEST_GPU_CLEANUP_ALL:"+JSON.stringify({throwCount,...destroyed}));
            }finally{
              GPUBuffer.prototype.mapAsync=map;
              GPUBuffer.prototype.destroy=destroyBuffer;
              GPUTexture.prototype.destroy=destroyTexture;
            }
            await retry();
          };
          await cleanupCase(true);
          await cleanupCase(false);
          // Старый отказ cleanup должен оставаться stale, не стирая новый кадр.
          {
            let enter,release,firstRead;
            let throwCount=0,readbackCalls=0;
            const entered=new Promise(resolve=>{enter=resolve});
            const gate=new Promise(resolve=>{release=resolve});
            const pending=[];
            try{
              GPUBuffer.prototype.mapAsync=function(...args){
                if((this.usage&GPUBufferUsage.MAP_READ)===0)return map.apply(this,args);
                if(++readbackCalls!==1)return map.apply(this,args);
                firstRead=this;
                const native=map.apply(this,args);
                enter();
                return native.then(()=>gate);
              };
              GPUBuffer.prototype.destroy=function(...args){
                const value=destroyBuffer.apply(this,args);
                if(this===firstRead){
                  throwCount++;
                  throw new Error("Injected stale-frame cleanup failure");
                }
                return value;
              };
              const stale=gpu.renderFrame(gpuContext);pending.push(stale);
              await entered;
              const newest=gpu.renderFrame(gpuContext);pending.push(newest);
              await Promise.resolve();
              release();
              const olderResult=await stale,newerResult=await newest;
              if(olderResult.status!=="stale"||newerResult.status!=="rendered"||
                 throwCount!==1||readbackCalls!==2||blank())
                throw Error("E_TEST_GPU_CLEANUP_STALE:"+JSON.stringify({
                  olderResult,newerResult,throwCount,readbackCalls
                }));
            }finally{
              release?.();
              await Promise.allSettled(pending);
              GPUBuffer.prototype.mapAsync=map;
              GPUBuffer.prototype.destroy=destroyBuffer;
            }
          }
          await retry();
          let partial, destroyed=false;
          try {
            GPUDevice.prototype.createBuffer=function(...args){
              partial=createBuffer.apply(this,args);
              return partial;
            };
            GPUDevice.prototype.createTexture=function(){throw new RangeError("Synthetic allocation rejection")};
            GPUBuffer.prototype.destroy=function(){
              if(this===partial)destroyed=true;
              return destroyBuffer.call(this);
            };
            await renderFailure("E_SESSION_GPU_FRAME");
            if(!partial||!destroyed)throw Error("E_TEST_GPU_PARTIAL_RESOURCE");
          } finally {
            GPUDevice.prototype.createBuffer=createBuffer;
            GPUDevice.prototype.createTexture=createTexture;
            GPUBuffer.prototype.destroy=destroyBuffer;
          }
          await retry();
          try {
            GPUDevice.prototype.createTexture=function(descriptor){
              return createTexture.call(this,{...descriptor,size:[0,1]});
            };
            await renderFailure("E_SESSION_GPU_FRAME");
          } finally {
            GPUDevice.prototype.createTexture=createTexture;
          }
          await retry();
          faults={readback:"failed",allocation:"failed",validation:"failed",cleanup:"failed-and-recoverable",cleanupStale:"stale-preserved"};
        }
        let burst;
        if(source.count===8){
          const map=GPUBuffer.prototype.mapAsync;
          let enter,release,started=0,peak=0,inFlight=0,mappedBytes=0;
          const entered=new Promise(resolve=>{enter=resolve});
          const gate=new Promise(resolve=>{release=resolve});
          GPUBuffer.prototype.mapAsync=function(...args){
            if((this.usage&GPUBufferUsage.MAP_READ)===0)return map.apply(this,args);
            const index=++started;
            peak=Math.max(peak,++inFlight);
            mappedBytes=Math.max(mappedBytes,this.size);
            const running=map.apply(this,args);
            if(index===1)enter();
            return running.then(async()=>{if(index===1)await gate;})
              .finally(()=>{inFlight--;});
          };
          const pending=[];
          const request=options=>{
            const promise=gpu.renderFrame({...gpuContext,...options});
            pending.push(promise);
            return promise;
          };
          try {
            const active=request();
            await entered;
            const abort=new AbortController();
            const cancelled=request({signal:abort.signal});
            await Promise.resolve();
            abort.abort();
            const replaced=request();
            const newest=request();
            await Promise.resolve();
            if(started!==1)throw Error("E_TEST_GPU_READBACK_OVERLAP:"+started);
            if((await cancelled).status!=="aborted"||(await replaced).status!=="stale")
              throw Error("E_TEST_GPU_PENDING_OUTCOME");
            release();
            if((await active).status!=="stale"||(await newest).status!=="rendered")
              throw Error("E_TEST_GPU_PUBLICATION_ORDER");
            if(started!==2||peak!==1||mappedBytes!==3840*2160*4)
              throw Error("E_TEST_GPU_READBACK_BOUND:"+started+":"+peak+":"+mappedBytes);
            burst={requests:4,readbacks:started,peak,mappedBytes};
          } finally {
            release();
            await Promise.allSettled(pending);
            GPUBuffer.prototype.mapAsync=map;
          }
        }
        try{await gpu.loadScene(poison("obj"));throw Error("E_TEST_WEBGPU_DIGEST_MISSED")}
        catch(error){if(error.message!=="E_SESSION_DIGEST")throw error}
        if(!blank())throw Error("E_TEST_WEBGPU_STALE_PIXELS");
        if(faults){
          const scene=await gpu.loadScene(poison("none")), activeView=gpu.setView(view);
          const active={expectedSceneRevision:scene.sceneRevision,
            expectedViewRevision:activeView.viewRevision,sessionEpoch:activeView.sessionEpoch};
          if((await gpu.renderFrame(active)).status!=="rendered"||blank())throw Error("E_TEST_GPU_PRELOSS");
          const map=GPUBuffer.prototype.mapAsync;
          try {
            GPUBuffer.prototype.mapAsync=function(...args){
              device.destroy();
              return map.apply(this,args);
            };
            const loss=await gpu.renderFrame(active);
            if(loss.status!=="device-lost"||loss.reason!=="E_SESSION_DEVICE_LOST"||!blank())
              throw Error("E_TEST_GPU_LOSS:"+JSON.stringify(loss));
          } finally {
            GPUBuffer.prototype.mapAsync=map;
          }
          if((await device.lost).reason!=="destroyed")throw Error("E_TEST_GPU_LOSS_REASON");
          if((await gpu.renderFrame(active)).status!=="device-lost")throw Error("E_TEST_GPU_AFTER_LOSS");
          faults.loss="device-lost";
        }
        await gpu.dispose();
        gpuCanvas.remove();
        result.push({name,cellCount:source.count,checkedCenters:built.report.checked_centers,
          packageSha256:await sha(firstPkg),objSha256:await sha(firstObj),
          backend:session.capabilities.backendKind,rendered:rendered.status,proofScope:built.proof.verification_scope,
          gpu:gpuFrame.status,geometryPixels,selectedPixels,frameMs,burst,faults});
      }
      return result;
    },{core:lock.core,wholeBuild:lock.wholeBuild});
    assert.equal(report.length,3);
    assert.deepEqual(report.map(x=>x.cellCount),[2,4,8]);
    assert.deepEqual(report.map(x=>x.checkedCenters),[12288,24576,49152]);
    assert.deepEqual(report[2].burst,{requests:4,readbacks:2,peak:1,mappedBytes:33177600});
    assert.deepEqual(report[0].faults,{readback:"failed",allocation:"failed",validation:"failed",cleanup:"failed-and-recoverable",cleanupStale:"stale-preserved",loss:"device-lost"});
    assert.ok(report.every(x=>x.rendered==="rendered"&&x.backend==="canvas2d-diagnostic"));
    assert.ok(report.every(x=>x.gpu==="rendered"&&x.geometryPixels>20&&x.selectedPixels>0));
    assert.deepEqual(errors,[]);
    assert.deepEqual(unknown,[]);
    console.log("RENDERER_SESSION_S3_S2B_REAL_WASM_BROWSER_PASS",report);
    console.log("RENDERER_SESSION_S3_S2C_REAL_WEBGPU_BROWSER_PASS");
    console.log("RENDERER_SESSION_S3_S2D_BOUNDED_READBACK_PASS",report[2].burst);
    console.log("RENDERER_SESSION_S3_S2E_GPU_FAILURES_PASS",report[0].faults);
    await page.close();
  });
} finally {
  await browser?.close();
  await new Promise(done=>server.close(done));
}

network?.assertLocal();
