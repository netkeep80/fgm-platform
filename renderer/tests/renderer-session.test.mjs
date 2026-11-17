import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRendererSessionV1, geometryCacheKey, sceneCacheKey, presentationCacheKey } from "../build/renderer-session-runtime/runtime/renderer-session-v1.js";

const b=s=>new TextEncoder().encode(s);
const sha=x=>createHash("sha256").update(x).digest("hex");
// Две смежные кубические клетки: 10 внешних граней (без общей внутренней).
function twoCellObj(){
 const v=[];let faces=[];
 for(let k=0;k<2;k++){
  const x=k*16,base=v.length;
  v.push([x,0,0],[x+16,0,0],[x+16,16,0],[x,16,0],
         [x,0,24],[x+16,0,24],[x+16,16,24],[x,16,24]);
  const facesLocal=[ [1,2,3,4],[5,8,7,6], [1,5,6,2], [2,6,7,3], [3,7,8,4], [4,8,5,1] ];
  for(let i=0;i<6;i++)if(!(k===0&&i===3)&&!(k===1&&i===5))faces.push(facesLocal[i].map(n=>n+base));
 }
 assert.equal(faces.length,10);
 return b(v.map(p=>"v "+p.join(" ")).concat(faces.map(f=>"f "+f.join(" "))).join("\n")+"\n");
}
function fixture(){
 const pkg=b(JSON.stringify({format:"fgm-package/1",version:1,schema:"synthetic-test",cells:2}));
 const obj=twoCellObj(),packageHash=sha(pkg),meshHash=sha(obj);
 const geometry={schema:"fgmv-derived-geometry/1",sourcePackageSha256:packageHash,
  meshFormat:"obj/1",meshSha256:meshHash,cellBindings:[{x:0,y:0,z:0},{x:1,y:0,z:0}],
  recipe:{schema:"fgmv-geometry-recipe/1",algorithmId:"accepted-whole-build",algorithmVersion:"1",
    parametersSha256:sha(b("params")),deterministicSeed:"0",detailDepth:0}};
 const request={snapshot:{schema:"fgmv-scene-snapshot/1",revision:"scene-v1",models:[{
    key:"whole",package:{format:"fgm-package/1",packageSha256:packageHash,byteLength:pkg.length}}],
    instances:[{instanceId:"instance-0",modelKey:"whole",stateRevision:"static",
      placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:0,units:"fgm-voxel"}}]},
    packages:[{modelKey:"whole",bytes:pkg}],geometries:[{geometry,bytes:obj}]};
 const view={schema:"fgmv-view-state/1",revision:"view-1",showCellGrid:true,
   camera:{kind:"orbit-3d",yaw:.7,pitch:.5,distance:1,focusWorld:{x:16,y:8,z:12}},
   viewport:{width:640,height:400,pixelRatio:1},selectedCell:{x:1,y:0,z:0}};
 return {request,view};
}
class FakeCtx {
 constructor(){this.commits=0;this.fills=0;this.clears=0}
 beginPath(){}moveTo(){}lineTo(){}closePath(){}fill(){this.fills++}stroke(){}
 fillRect(){}clearRect(){this.clears++}drawImage(){this.commits++}
}
class FakeCanvas {
 constructor(){this.width=320;this.height=240;this.ctx=new FakeCtx()}
 getContext(kind){return kind==="2d"?this.ctx:null}
}
globalThis.document={createElement(name){return name==="canvas"?new FakeCanvas():null}};
const factory=(opts={})=>createRendererSessionV1({canvas:new FakeCanvas(),preferredBackend:"canvas2d-diagnostic",fallbackPolicy:"reject",...opts});

const context=(scene,view)=>({expectedSceneRevision:scene.sceneRevision,expectedViewRevision:view.viewRevision,sessionEpoch:view.sessionEpoch});
test("whole-object 2×1, exact SHA, diagnostic draw, stable inputs and view",async()=>{
 const s=await factory(),f=fixture();
 assert.equal(s.capabilities.backendKind,"canvas2d-diagnostic");
 const before=f.request.packages[0].bytes.slice();
 const scene=await s.loadScene(f.request),view=s.setView(f.view);
 f.request.packages[0].bytes.fill(88);f.request.geometries[0].bytes.fill(88);
 assert.notDeepEqual(before,f.request.packages[0].bytes);
 assert.deepEqual(await s.renderFrame(context(scene,view)),{
  status:"rendered",sceneRevision:"scene-v1",viewRevision:"view-1",sessionEpoch:view.sessionEpoch,frameNumber:1});
 const camera2={...f.view,revision:"view-2",camera:{...f.view.camera,yaw:1.2},showCellGrid:false};
 const second=s.setView(camera2);
 assert.equal((await s.renderFrame(context(scene,view))).status,"stale");
 assert.equal((await s.renderFrame(context(scene,second))).status,"rendered");
 await s.dispose();await s.dispose();
 await assert.rejects(s.loadScene(f.request),/E_SESSION_DISPOSED/);
 await assert.rejects(s.renderFrame(context(scene,second)),/E_SESSION_DISPOSED/);
});
test("fail closed SHA / C04 / binding / resource / OBJ / abort",async()=>{
 const cases=[
  ["sha",x=>{x.request.snapshot.models[0].package.packageSha256="0".repeat(64)},/E_SESSION_DIGEST|E_SESSION_BINDING/],
  ["mesh",x=>{x.request.geometries[0].geometry.meshSha256="0".repeat(64)},/E_SESSION_DIGEST/],
  ["c04",x=>{x.request.snapshot.models[0].package.verifiedC04Identity="fake"},/E_SESSION_PACKAGE/],
  ["binding",x=>{x.request.snapshot.instances[0].modelKey="absent"},/E_SESSION_BINDING/],
  ["length",x=>{x.request.snapshot.models[0].package.byteLength++},/E_SESSION_LIMIT/],
  ["oversize",x=>{x.request.packages[0].bytes=new Uint8Array(1024*1024+1)},/E_SESSION_LIMIT/],
  ["shared",x=>{x.request.packages[0].bytes=new Uint8Array(new SharedArrayBuffer(128))},/E_SESSION_SHARED_MEMORY/],
  ["wrong format",x=>{const v=b('{"format":"wrong"}');x.request.packages[0].bytes=v;
    x.request.snapshot.models[0].package.packageSha256=sha(v);x.request.snapshot.models[0].package.byteLength=v.length;
    x.request.geometries[0].geometry.sourcePackageSha256=sha(v)},/E_SESSION_PACKAGE/],
  ["invalid obj",x=>{const v=b('v 0 0 0\nf 1 2 3\n');x.request.geometries[0].bytes=v;
    x.request.geometries[0].geometry.meshSha256=sha(v)},/E_SESSION_OBJ/]
 ];
 for(const [name,mutate,error] of cases){
  const session=await factory(),item=fixture();mutate(item);
  await assert.rejects(session.loadScene(item.request),error,name);
  assert.throws(()=>session.setView(item.view),/E_SESSION_NO_SCENE/,name);
  await session.dispose();
 }
 const aborted=await factory(),ctrl=new AbortController();ctrl.abort();
 await assert.rejects(aborted.loadScene(fixture().request,{signal:ctrl.signal}),/E_SESSION_ABORTED/);
 await aborted.dispose();
});
test("epoch races, cancellation, no stale-frame publishing",async()=>{
 const canvas=new FakeCanvas(),s=await factory({canvas}),f=fixture();
 const scene=await s.loadScene(f.request),view=s.setView(f.view);
 const cancel=new AbortController();cancel.abort();
 assert.equal((await s.renderFrame({...context(scene,view),signal:cancel.signal})).status,"aborted");
 const pending=s.renderFrame(context(scene,view));
 const next=s.setView({...f.view,revision:"view-2",camera:{...f.view.camera,yaw:2}});
 assert.equal((await pending).status,"stale");
 assert.equal(canvas.ctx.commits,0);
 assert.equal((await s.renderFrame(context(scene,next))).status,"rendered");
 assert.equal(canvas.ctx.commits,1);
 const beforeInvalid=canvas.ctx.clears;
 assert.throws(()=>s.setView({...f.view,revision:"bad",camera:{kind:"r05-isometric",quarterTurns:0,zoom:1,focusWorld:{x:0,y:0,z:0}}}),/E_SESSION_VIEW/);
 assert.equal((await s.renderFrame(context(scene,next))).status,"stale");
 assert.equal(canvas.ctx.clears,beforeInvalid+1,"invalid view clears published pixels");
 await assert.rejects(s.recoverDevice(),/E_SESSION_BACKEND_UNSUPPORTED/);
 await s.dispose();
});
test("strict WebGPU no false backend, explicit fallback; cache key dimensions",async()=>{
 await assert.rejects(factory({preferredBackend:"webgpu",fallbackPolicy:"reject"}),/E_SESSION_BACKEND_UNSUPPORTED/);
 const s=await factory({preferredBackend:"webgpu",fallbackPolicy:"allow-diagnostic"});
 assert.equal(s.capabilities.backendKind,"canvas2d-diagnostic");await s.dispose();
 const f=fixture(),g=f.request.geometries[0].geometry,k=geometryCacheKey(g);
 for(const r of [{algorithmVersion:"2"},{parametersSha256:sha(b("other"))},
   {deterministicSeed:"3"},{detailDepth:2},{geometryProfileSha256:sha(b("profile"))}]){
   assert.notEqual(geometryCacheKey({...g,recipe:{...g.recipe,...r}}),k);
 }
 assert.notEqual(geometryCacheKey({...g,meshSha256:sha(b("mesh 2"))}),k);
 const scene=f.request.snapshot, view=f.view;
 const sceneKey=sceneCacheKey(g,scene), viewKey=presentationCacheKey(g,scene,view);
 assert.notEqual(sceneCacheKey({...g,cellBindings:[{x:0,y:0,z:0},{x:2,y:0,z:0}]},scene),sceneKey);
 const instance=scene.instances[0];
 const translated={...scene,instances:[{...instance,placement:{...instance.placement,
   translation:{x:12,y:0,z:0}}}]};
 assert.equal(geometryCacheKey(g),k,"same geometry reusable for different instance translations");
 assert.notEqual(sceneCacheKey(g,translated),sceneKey);
 assert.notEqual(presentationCacheKey(g,translated,view),viewKey);
 assert.notEqual(presentationCacheKey(g,scene,{...view,revision:"view-other"}),viewKey);
 assert.notEqual(presentationCacheKey(g,scene,{...view,revision:"view-1",camera:{...view.camera,yaw:1.3}}),viewKey);
});
test("previous frame cleared by failed load and idempotent dispose",async()=>{
 const canvas=new FakeCanvas(),s=await factory({canvas}),f=fixture();
 const sc=await s.loadScene(f.request),v=s.setView(f.view);
 assert.equal((await s.renderFrame(context(sc,v))).status,"rendered");
 const c=canvas.ctx.clears;
 const corrupt=fixture(); corrupt.request.geometries[0].bytes[0]^=1;
 await assert.rejects(s.loadScene(corrupt.request),/E_SESSION_DIGEST/);
 assert.equal(canvas.ctx.clears,c+1,"failed load visually invalidates previous frame");
 await s.dispose();assert.equal(canvas.ctx.clears,c+2);
 await s.dispose();assert.equal(canvas.ctx.clears,c+2);
});
console.log("RENDERER_SESSION_S3_S2A_RUNTIME_TESTS_PASS");