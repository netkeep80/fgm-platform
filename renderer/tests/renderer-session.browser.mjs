import {localBrowserContext} from './local-browser.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright";

const js = readFileSync("build/renderer-session-runtime/runtime/renderer-session-v1.js");
const server = createServer((req,res)=>{
  res.setHeader("Content-Type",req.url==="/runtime.js"?"text/javascript":"text/html; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(req.url==="/runtime.js"?js:'<!doctype html><html lang="ru"><body><canvas id="out" width="300" height="200"></canvas></body></html>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url=`http://127.0.0.1:${server.address().port}`;
let browser,network;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.FGM_CHROMIUM,args:["--no-sandbox"]});
  network=await localBrowserContext(browser);
  await test("Chromium: whole-object Canvas2D session, SHA/bindings, no fake WebGPU", async()=>{
    const page=await network.context.newPage();
    await page.addInitScript(()=>Object.defineProperty(navigator,"gpu",{value:undefined}));
    await page.goto(url);
    const answer=await page.evaluate(async()=>{
      const {createRendererSessionV1}=await import("/runtime.js");
      const bytes=s=>new TextEncoder().encode(s);
      const sha=async a=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",a))].map(x=>x.toString(16).padStart(2,"0")).join("");
      const pkg=bytes(JSON.stringify({format:"fgm-package/1",synthetic:true,cells:2}));
      const obj=bytes("v 0 0 0\nv 32 0 0\nv 32 16 0\nv 0 16 0\nv 0 0 24\nv 32 0 24\nv 32 16 24\nv 0 16 24\n"+
        "f 1 2 3 4\nf 5 8 7 6\nf 1 5 6 2\nf 2 6 7 3\nf 3 7 8 4\nf 4 8 5 1\n");
      const packageHash=await sha(pkg),meshHash=await sha(obj),params=await sha(bytes("params"));
      const request={snapshot:{schema:"fgmv-scene-snapshot/1",revision:"s1",models:[{
        key:"m1",package:{format:"fgm-package/1",byteLength:pkg.length,packageSha256:packageHash}}],
        instances:[{instanceId:"i1",modelKey:"m1",stateRevision:"static",
          placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:0,units:"fgm-voxel"}}]},
        packages:[{modelKey:"m1",bytes:pkg}],geometries:[{bytes:obj,geometry:{
          schema:"fgmv-derived-geometry/1",sourcePackageSha256:packageHash,meshSha256:meshHash,
          meshFormat:"obj/1",cellBindings:[{x:0,y:0,z:0},{x:1,y:0,z:0}],
          recipe:{schema:"fgmv-geometry-recipe/1",algorithmId:"synthetic",algorithmVersion:"1",
            parametersSha256:params,deterministicSeed:"0",detailDepth:0}}}]};
      const canvas=document.getElementById("out");
      let strictReject=false;
      try{await createRendererSessionV1({canvas,preferredBackend:"webgpu",fallbackPolicy:"reject"})}
      catch(e){strictReject=/E_SESSION_BACKEND_UNSUPPORTED/.test(e.message)}
      const session=await createRendererSessionV1({canvas,preferredBackend:"webgpu",fallbackPolicy:"allow-diagnostic"});
      const scene=await session.loadScene(request);
      const view=session.setView({schema:"fgmv-view-state/1",revision:"v1",camera:{kind:"orbit-3d",yaw:0.6,
        pitch:0.4,distance:1,focusWorld:{x:16,y:8,z:12}},viewport:{width:300,height:200,pixelRatio:1},
        showCellGrid:true,selectedCell:{x:1,y:0,z:0}});
      const ctx={expectedSceneRevision:scene.sceneRevision,expectedViewRevision:view.viewRevision,sessionEpoch:view.sessionEpoch};
      const result=await session.renderFrame(ctx);
      const pixels=canvas.getContext("2d").getImageData(0,0,300,200).data;
      let changed=0;
      for(let i=0;i<pixels.length;i+=4){if(pixels[i]!==16||pixels[i+1]!==27||pixels[i+2]!==43)changed++}
      const stale=session.setView({schema:"fgmv-view-state/1",revision:"v2",camera:{kind:"orbit-3d",yaw:1,
        pitch:0.4,distance:1,focusWorld:{x:16,y:8,z:12}},viewport:{width:300,height:200,pixelRatio:1},
        showCellGrid:false});
      const staleFrame=await session.renderFrame(ctx);
      const bad={...request,snapshot:{...request.snapshot,models:[{...request.snapshot.models[0],package:{
        ...request.snapshot.models[0].package,packageSha256:"0".repeat(64)}}]}};
      let badDigest=false;
      try{await session.loadScene(bad)}catch(e){badDigest=/E_SESSION_BINDING|E_SESSION_DIGEST/.test(e.message)}
      await session.dispose();
      return {strictReject,backend:session.capabilities.backendKind,frame:result.status,
        cellCount:2,visiblePixels:changed,stale:staleFrame.status,badDigest};
    });
    assert.equal(answer.strictReject,true);
    assert.equal(answer.backend,"canvas2d-diagnostic");
    assert.equal(answer.frame,"rendered");
    assert.equal(answer.stale,"stale");
    assert.equal(answer.badDigest,true);
    assert.ok(answer.visiblePixels>500,JSON.stringify(answer));
    await page.screenshot({path:"build/renderer-session-browser.png"});
    await page.close();
    console.log("RENDERER_SESSION_S3_S2A_BROWSER_PASS",answer);
  });
} finally {
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
}

network?.assertLocal();
