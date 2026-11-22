import {localBrowserContext} from './local-browser.mjs';
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve,join,extname } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { studioCellFixture, writeStudioUfoCatalogFixture } from "./studio-ufo-catalog.fixture.mjs";

const root=resolve(process.argv[2]||"build/studio");
const MIME={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",
  ".wasm":"application/wasm",".json":"application/json; charset=utf-8"};
const allowed=new Set(["/","/index.html","/studio-app.mjs","/synthetic.mjs","/r05-view.mjs",
  "/engine/worker.mjs","/engine/fgmr-studio.mjs","/engine/fgmr-studio.wasm",
  "/studio-manifest.json","/ufo-catalog.mjs","/whole-ui.mjs","/favicon.ico"]);
const unexpected=[];
const server=createServer(async(request,response)=>{
  const url=new URL(request.url||"/","http://localhost");
  if(request.method!=="GET"||!allowed.has(url.pathname)){
    unexpected.push(request.method+" "+url.pathname);response.writeHead(404).end();return;
  }
  if(url.pathname==="/favicon.ico"){response.writeHead(204).end();return}
  try{
    const file=url.pathname==="/"?"/index.html":url.pathname;
    const bytes=await readFile(join(root,file));
    response.writeHead(200,{"Content-Type":MIME[extname(file)]||"application/octet-stream","Cache-Control":"no-store"}).end(bytes);
  }catch{response.writeHead(404).end()}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const url="http://127.0.0.1:"+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.FGM_CHROMIUM,args:["--no-sandbox","--enable-unsafe-webgpu","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
const network=await localBrowserContext(browser);
try{
  const page=await network.context.newPage();
  // Deterministic adversarial scheduling: only delay dispatch of the genuine
  // WASM Worker's step request. No mock engine, synthetic replies or fake FGM.
  // The optional proof mutation operates on a real finalize reply.
  await page.addInitScript(() => {
    const NativeWorker=globalThis.Worker;
    globalThis.__u6DialogDecision=true;
    globalThis.confirm=()=>globalThis.__u6DialogDecision;
    globalThis.__studioGateStep=false;
    globalThis.__studioStepGated=false;
    globalThis.__studioReleaseStep=null;
    globalThis.__studioGateCatalog=false;
    globalThis.__studioReleaseCatalog=null;
    globalThis.__studioU3PlacementCalls=[];
    globalThis.__studioGatePlacements=false;
    globalThis.__studioPlacementsGated=false;
    globalThis.__studioReleasePlacements=null;
    globalThis.__studioBadPlacementDigest=false;
    globalThis.__studioGateThumb=false;globalThis.__studioThumbGated=false;
    globalThis.__studioReleaseThumb=null;
    globalThis.__u5WholeEvents=[];
    globalThis.__u5SourceEvents=[];
    document.addEventListener("fgm-studio:whole-evidence",e=>globalThis.__u5WholeEvents.push(e.detail));
    document.addEventListener("fgm-studio:source-evidence",e=>globalThis.__u5SourceEvents.push(e.detail));
    globalThis.__studioReads={};
    globalThis.__studioFileReadCalls=[];
    const readFileBytes=File.prototype.arrayBuffer;
    File.prototype.arrayBuffer=function(){
      globalThis.__studioFileReadCalls.push(this.name);
      const path=this.webkitRelativePath;
      if(path)globalThis.__studioReads[path]=(globalThis.__studioReads[path]??0)+1;
      return readFileBytes.call(this);
    };
    globalThis.__studioTamperProof=false;
    globalThis.__studioVisualFault="";
    // Capture only real devices returned by the existing GPU backend.
    if(globalThis.GPUAdapter?.prototype){
      const originalRequestDevice=GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice=async function(...args){
        const device=await originalRequestDevice.apply(this,args);
        globalThis.__studioU0Device=device;
        return device;
      };
    }
    globalThis.Worker=class InstrumentedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        this._wrappedListeners=new WeakMap();
      }
      postMessage(data,...args) {
        const request=typeof data==="string"?JSON.parse(data):null;
        if(request?.action==="catalog-placements")
          globalThis.__studioU3PlacementCalls.push({
            map:request.map,floor:request.floor,offset:request.offset,
            digest:request.sourceDigest
          });
        if(globalThis.__studioBadPlacementDigest && request?.action==="catalog-placements")
          return super.postMessage(JSON.stringify({...request,sourceDigest:"0".repeat(64)}),...args);
        if(globalThis.__studioGatePlacements && request?.action==="catalog-placements") {
          globalThis.__studioPlacementsGated=true;
          globalThis.__studioReleasePlacements=()=>super.postMessage(data,...args);
          return;
        }
        if(globalThis.__studioGateCatalog && request?.action==="catalog-map") {
          globalThis.__studioReleaseCatalog=()=>super.postMessage(data,...args);
          return;
        }
        if(globalThis.__studioGateThumb && request?.action==="catalog-thumbnails") {
          globalThis.__studioThumbGated=true;
          globalThis.__studioReleaseThumb=()=>super.postMessage(data,...args);
          return;
        }
        if(globalThis.__studioGateStep && request?.action==="step") {
          globalThis.__studioStepGated=true;
          globalThis.__studioReleaseStep=()=>super.postMessage(data,...args);
          return;
        }
        return super.postMessage(data,...args);
      }
      addEventListener(type,listener,options) {
        if(type!=="message" || typeof listener!=="function")
          return super.addEventListener(type,listener,options);
        const wrapped=event=>{
          let original=event;
          if((globalThis.__studioTamperProof || globalThis.__studioVisualFault) && typeof event.data==="string") {
            const response=JSON.parse(event.data);
            if(response.result?.proof) {
              const proof=JSON.parse(response.result.proof);
              if(globalThis.__studioTamperProof)proof.mesh_sha256="0".repeat(64);
              if(globalThis.__studioVisualFault==="digest")proof.r05_visual_sha256="0".repeat(64);
              if(globalThis.__studioVisualFault==="bytes")response.result.visual+=" ";
              if(globalThis.__studioVisualFault==="missing")delete response.result.visual;
              response.result.proof=JSON.stringify(proof);
              original=new MessageEvent("message",{data:JSON.stringify(response)});
            }
          }
          listener(original);
        };
        this._wrappedListeners.set(listener,wrapped);
        return super.addEventListener(type,wrapped,options);
      }
      removeEventListener(type,listener,options) {
        return super.removeEventListener(type,this._wrappedListeners.get(listener)||listener,options);
      }
    };
  });
  const waitState=state=>page.waitForFunction(s=>
    document.querySelector("#status").dataset.state===s,state,{timeout:60000});
  const assertNoResult=async()=>{
    assert.equal(await page.locator("#downloads button").count(),0);
    assert.equal(await page.locator("#metrics").textContent(),"Результатов пока нет");
  };
  const pixelsWithColor=color=>page.locator("#preview").evaluate((canvas,[r,g,b])=>{
    const data=canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
    let count=0;
    for(let i=0;i<data.length;i+=4)if(data[i]===r && data[i+1]===g && data[i+2]===b)count++;
    return count;
  },color);
  const browserErrors=[],requests=[];
  page.on("pageerror",e=>browserErrors.push(e.message));
  page.on("request",request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(url+"/");
  assert.match(await page.title(),/Reconstruction Studio/);
  if (process.env.STUDIO_RENDERER_REV) {
    const revision = process.env.STUDIO_RENDERER_REV;
    const expectedVersion = process.env.STUDIO_VERSION;
    assert.match(expectedVersion, /^[1-9][0-9]*\.(0|[1-9][0-9]*)$/);
    const version = page.locator("#studio-version");
    assert.equal(await version.isVisible(), true);
    assert.equal(await version.textContent(), "Версия " + expectedVersion);
    assert.equal(await version.getAttribute("title"), revision);
  }

  const workspace=key=>page.locator('#studio-workspaces [data-workspace="'+key+'"]');
  assert.equal(await page.locator('#studio-workspaces button').count(),5);
  assert.equal(await workspace('source').getAttribute('aria-current'),'page');
  await workspace('source').focus();
  await workspace('source').press('ArrowRight');
  assert.equal(await workspace('object').getAttribute('aria-current'),'page');
  assert.equal(await workspace('object').evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.locator('#preview').isVisible(),false);
  assert.equal(await page.locator('#studio-workspace-placeholder').isVisible(),true);
  await workspace('mapblock').click();
  assert.equal(await page.locator('#mapblock-inspector').isVisible(),true);
  assert.equal(await page.locator('#studio-workspace-placeholder').isVisible(),false);
  assert.match(await page.locator('#mapblock-status').textContent(),/NO_SOURCE/);
  assert.equal(await page.locator('#whole-preview').isVisible(),false);
  await workspace('map').click();
  assert.equal(await page.locator('#battlescape-panel').isVisible(),true);
  assert.match(await page.locator('#battlescape-heading').textContent(),/50×50/);
  assert.equal(await page.locator('#studio-workspace-placeholder').isVisible(),false);
  await workspace('world').click();
  assert.match(await page.locator('#studio-workspace-heading').textContent(),/RESEARCH_ONLY/);
  await workspace('source').click();
  assert.equal(await page.locator('#preview').isVisible(),true);
  await page.locator('#preview').evaluate(el=>{window.__studioU0OriginalPreview=el});
  await page.setViewportSize({width:390,height:844});
  assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
  await page.setViewportSize({width:1280,height:900});
  console.log("STUDIO_D4_U0_NAV_AND_ACCESSIBILITY_PASS");
  await page.locator("#demo").click();
  await page.locator("#run").click();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="COMPLETED",null,{timeout:60000});
  let metrics=JSON.parse(await page.locator("#metrics").textContent());
  assert.equal(metrics.occupied,18);
  assert.equal(metrics.voxels_checked,6144);
  assert.equal(metrics.silhouette.common,1);
  assert.equal(metrics.silhouette.observed_only,1);
  assert.equal(await page.locator("#downloads button").count(),4);
  assert.equal(await page.locator("#file-summary").textContent().then(x=>x.includes("7 выбранных")),true);
  console.log("STUDIO_S2A_SYNTHETIC_PASS");

  const sourceBefore=await page.locator('#metrics').textContent();
  await workspace('object').click();
  await workspace('source').click();
  assert.equal(await page.locator('#metrics').textContent(),sourceBefore);
  assert.equal(await page.locator('#downloads button').count(),4);
  assert.equal(await page.locator('#preview').isVisible(),true);
  assert.equal(await page.locator('#preview').evaluate(el=>el===window.__studioU0OriginalPreview),true);
  console.log("STUDIO_D4_U0_SOURCE_HIDE_SHOW_PASS");

  const view=page.locator("#view-mode");
  const green=[159,223,163], blue=[102,218,255], amber=[255,188,107], purple=[227,175,255];
  for(const [mode,colors] of [
    ["original",[[252,160,72],[176,224,252]]],
    ["reconstructed",[blue]],["overlay",[green,blue,amber]],
    ["difference",[blue,amber]],["collision",[purple]]
  ]){
    await view.selectOption(mode);
    for(const color of colors)assert.ok(await pixelsWithColor(color)>0,mode+" "+color);
    if(mode==="difference")assert.equal(await pixelsWithColor(green),0);
  }
  await view.selectOption("mesh");
  assert.match(await page.locator("#hint").textContent(),/OBJ/);
  await view.selectOption("overlay");
  console.log("STUDIO_S2B_R05_VIEWS_PASS");
  // The same content enters via the real input[type=file] rather than the Demo button.
  const fixtures=studioCellFixture();
  const manual=page.locator("#manual-bindings");
  if(await manual.count())await manual.locator("summary").click();
  await page.locator("#local-files").setInputFiles(Object.entries(fixtures).map(([name,buffer])=>
    ({name,mimeType:"application/octet-stream",buffer})));
  for(const id of ["map","loft","pck","tab","palette"])await page.locator("#"+id).selectOption(id);
  await page.locator("#dataset-lines").fill("BLANKS=blanks\nTERRAIN=terrain");
  await page.locator("#sprite-dataset").fill("TERRAIN");
  await page.locator("#run").click();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="COMPLETED",null,{timeout:60000});
  metrics=JSON.parse(await page.locator("#metrics").textContent());
  assert.equal(metrics.occupied,18);
  console.log("STUDIO_S2A_LOCAL_FILE_PASS");
  // Negative source identity: valid bytes are not enough when the binding is wrong.
  await page.locator("#sprite-dataset").fill("UNKNOWN");
  await page.locator("#run").click();
  await page.waitForFunction(()=>document.querySelector("#status").dataset.state==="ERROR",null,{timeout:10000});
  assert.match(await page.locator("#status").textContent(),/E_STUDIO_SPRITE_BINDING/);
  assert.equal(await page.locator("#downloads button").count(),0);
  // BLOCK P2-02: invalid repeated source selection must fail closed.
  await page.locator("#demo").click();
  await page.locator("#run").click();
  await waitState("COMPLETED");
  assert.equal(await page.locator("#downloads button").count(),4);
  await page.locator("#local-files").setInputFiles([
    {name:"duplicate.map",mimeType:"application/octet-stream",buffer:Buffer.from([1])},
    {name:"duplicate.map",mimeType:"application/octet-stream",buffer:Buffer.from([2])}
  ]);
  await waitState("ERROR");
  assert.match(await page.locator("#status").textContent(),/E_STUDIO_DUPLICATE_FILE/);
  await assertNoResult();
  assert.equal(await page.locator("#file-summary").textContent(),"Нет выбранных файлов");
  assert.equal(await page.locator("#map option").count(),1);
  console.log("STUDIO_S2A_DUPLICATE_SELECTION_PASS");

  // BLOCK P2-01: replace A by B while the real Worker has a step pending.
  await page.locator("#demo").click();
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false});
  await page.locator("#run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await page.locator("#local-files").setInputFiles([
    {name:"replacement.map",mimeType:"application/octet-stream",buffer:Buffer.from([1,1,1,0,1,2,2])}
  ]);
  await waitState("READY");
  await assertNoResult();
  assert.match(await page.locator("#file-summary").textContent(),/1 выбранных файлов/);
  assert.equal(await page.locator("#run").isEnabled(),true);
  assert.equal(await page.locator("#cancel").isDisabled(),true);
  await page.evaluate(()=>{
    window.__studioGateStep=false;
    try {window.__studioReleaseStep?.()}catch{/* terminated Worker */}
  });
  await page.waitForTimeout(300);
  assert.match(await page.locator("#status").textContent(),/^READY/);
  await assertNoResult();
  console.log("STUDIO_S2A_SOURCE_RACE_PASS");

  // U0-V03: real R06 step held across source/object/mapblock navigation.
  await page.locator("#demo").click();
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false;window.__studioReleaseStep=null});
  await page.locator("#run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  assert.match(await page.locator("#status").textContent(),/^RUNNING/);
  const r06Binding=await page.locator("#file-summary").textContent();
  await workspace("object").click();
  await workspace("mapblock").click();
  assert.equal(await page.locator("#preview").isVisible(),false);
  await workspace("source").click();
  assert.equal(await page.locator("#preview").isVisible(),true);
  assert.match(await page.locator("#status").textContent(),/^RUNNING/);
  assert.equal(await page.locator("#file-summary").textContent(),r06Binding);
  assert.equal(await page.locator("#cancel").isDisabled(),false);
  assert.equal(await page.locator("#downloads button").count(),0);
  await page.evaluate(()=>{window.__studioGateStep=false;window.__studioReleaseStep?.()});
  await waitState("COMPLETED");
  assert.equal(JSON.parse(await page.locator("#metrics").textContent()).voxels_checked,6144);
  assert.equal(await page.locator("#downloads button").count(),4);
  assert.equal(await page.locator("#view-mode").inputValue(),"overlay");
  assert.equal(await page.locator("#preview").evaluate(c=>c===window.__studioU0OriginalPreview),true);
  console.log("STUDIO_D4_U0_PENDING_R06_NAV_PASS");

  // U0-V04: real File API replacement while Source is hidden; old run is stale.
  await page.locator("#demo").click();
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false;window.__studioReleaseStep=null});
  await page.locator("#run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await workspace("mapblock").click();
  await page.locator("#local-files").setInputFiles([
    {name:"revision-switch.map",mimeType:"application/octet-stream",buffer:Buffer.from([1,1,1,0,1,2,2])}
  ]);
  await workspace("source").click();
  assert.match(await page.locator("#status").textContent(),/^READY/);
  await page.evaluate(()=>{window.__studioGateStep=false;try{window.__studioReleaseStep?.()}catch{/* terminated */}});
  await page.waitForTimeout(250);
  assert.match(await page.locator("#file-summary").textContent(),/1 выбранных файлов/);
  await assertNoResult();
  assert.match(await page.locator("#status").textContent(),/^READY/);
  console.log("STUDIO_D4_U0_HIDDEN_SOURCE_MUTATION_PASS");

  // A second adversarial branch: Cancel must prevent any stale result.
  await page.locator("#demo").click();
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false});
  await page.locator("#run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await page.locator("#cancel").click();
  await waitState("CANCELLED");
  await page.evaluate(()=>{
    window.__studioGateStep=false;
    try {window.__studioReleaseStep?.()}catch{/* terminated Worker */}
  });
  await page.waitForTimeout(300);
  await assertNoResult();
  assert.match(await page.locator("#status").textContent(),/^CANCELLED/);
  console.log("STUDIO_S2A_CANCEL_STALE_PASS");

  // Changing RunSpec while displaying a completed model invalidates the pack.
  await page.locator("#demo").click();
  await page.locator("#run").click();
  await waitState("COMPLETED");
  assert.equal(await page.locator("#downloads button").count(),4);
  await page.locator("#tile-x").fill("1");
  await waitState("READY");
  await assertNoResult();
  console.log("STUDIO_S2A_PARAMETER_INVALIDATION_PASS");

  // A structurally invalid local PCK is rejected by the actual decoder.
  const damaged={...fixtures,pck:Buffer.from([0,42,0])};
  await page.locator("#local-files").setInputFiles(Object.entries(damaged).map(([name,buffer])=>
    ({name,mimeType:"application/octet-stream",buffer})));
  for(const id of ["map","loft","pck","tab","palette"])await page.locator("#"+id).selectOption(id);
  await page.locator("#dataset-lines").fill("BLANKS=blanks\nTERRAIN=terrain");
  await page.locator("#sprite-dataset").fill("TERRAIN");
  // Reset the nonzero X left by the previous parameter-invalidation regression.
  await page.locator("#tile-x").fill("0");
  await page.locator("#run").click();
  await waitState("ERROR");
  assert.match(await page.locator("#status").textContent(),/E_R04_FRAME_TERMINATOR/);
  await assertNoResult();
  console.log("STUDIO_S2A_INVALID_PCK_PASS");

  // Integrity check: mutate only an actual Worker finalize message in transit.
  await page.locator("#demo").click();
  await page.evaluate(()=>{window.__studioTamperProof=true});
  await page.locator("#run").click();
  await waitState("ERROR");
  assert.match(await page.locator("#status").textContent(),/E_STUDIO_PROOF/);
  await assertNoResult();
  await page.evaluate(()=>{window.__studioTamperProof=false});
  console.log("STUDIO_S2A_TAMPERED_PROOF_PASS");

  for(const [fault,code] of [["missing",/^E_STUDIO_VISUAL$/],["bytes",/^E_STUDIO_VISUAL_DIGEST$/],
    ["digest",/^E_STUDIO_VISUAL_DIGEST$/]]){
    await page.locator("#demo").click();
    await page.evaluate(value=>{window.__studioVisualFault=value},fault);
    await page.locator("#run").click();
    await waitState("ERROR");
    assert.match((await page.locator("#status").textContent()).split(" · ")[1],code);
    await assertNoResult();
    assert.equal(await pixelsWithColor(green),0);
  }
  console.log("STUDIO_S2B_VISUAL_INTEGRITY_PASS");


  // Whole-object UI uses the real packaged Worker and the same C++20 builder.
  await page.reload();
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled,null,{timeout:20000});
  // U0-V03/whole: keep the native whole Worker pending across task tabs.
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false;window.__studioReleaseStep=null});
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await workspace("object").click();
  assert.equal(await page.locator("#studio-workspace-placeholder").isVisible(),true);
  assert.match(await page.locator("#studio-workspace-description").textContent(),/RUNNING/);
  await workspace("mapblock").click();
  await workspace("source").click();
  await workspace("object").click();
  assert.match(await page.locator("#whole-status").textContent(),/^RUNNING/);
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  await page.evaluate(()=>{window.__studioGateStep=false;window.__studioReleaseStep?.()});
  await page.waitForFunction(()=>["COMPLETED","ERROR"].includes(document.querySelector("#whole-status").dataset.state),null,{timeout:60000});
  assert.match(await page.locator("#whole-status").textContent(),/^COMPLETED/);
  console.log("STUDIO_D4_U0_PENDING_WHOLE_NAV_PASS");
  const whole=JSON.parse(await page.locator("#whole-metrics").textContent());
  assert.equal(whole.cells,4);
  assert.equal(whole.occupied,8);
  assert.equal(whole.checked_centers,24576);
  assert.equal(whole.reran_b1,false);
  assert.equal(whole.rederived_r03,false);
  assert.equal(await page.locator("#whole-downloads button").count(),5);
  assert.equal(await page.locator("#whole-preview").isVisible(),true);

  await workspace('object').click();
  assert.equal(await page.locator('#whole-preview').isVisible(),true);
  await workspace('mapblock').click();
  assert.equal(await page.locator('#whole-preview').isVisible(),false);
  assert.equal(await page.locator('#mapblock-inspector').isVisible(),true);
  assert.equal(await page.locator('#studio-workspace-placeholder').isVisible(),false);
  await workspace('object').click();
  assert.equal(await page.locator('#whole-preview').isVisible(),true);
  await workspace('source').click();
  assert.equal(await page.locator('#preview').isVisible(),true);
  assert.equal(await page.locator('#whole-status').getAttribute('data-state'),'COMPLETED');
  console.log("STUDIO_D4_U0_WHOLE_HIDE_SHOW_PASS");

  // U0-V02: the same verified model and owner canvas survive viewport resize.
  const wholeProofBefore=await page.locator("#whole-metrics").textContent();
  await page.locator("#whole-preview").evaluate(c=>{window.__studioU0WholeCanvas=c});
  await page.setViewportSize({width:390,height:844});
  assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
  await workspace("map").click();
  await workspace("object").click();
  await page.setViewportSize({width:1280,height:900});
  assert.equal(await page.locator("#whole-metrics").textContent(),wholeProofBefore);
  assert.equal(await page.locator("#whole-preview").evaluate(c=>c===window.__studioU0WholeCanvas),true);
  assert.equal(await page.locator("#whole-preview").isVisible(),true);
  console.log("STUDIO_D4_U0_WHOLE_RESIZE_RETURN_PASS");

  await page.locator("#whole-cell").selectOption("0");
  await page.locator("#whole-z").fill("3");
  assert.match(await page.locator("#whole-slice").textContent(),/#/);
  console.log("STUDIO_WHOLE_UI_BROWSER_PASS");

  // Real local File API path, two adjacent cells, externally supplied SHA values
  // in reverse JSON field order. Shared boundary must yield ten exterior faces.
  const hashLocal=buffer=>createHash("sha256").update(buffer).digest("hex");
  const kinds=["floor","west_wall","north_wall","object"];
  const inputFiles=[];
  const receipt={schema:"fgm-regenerator/verified-membership-input-v1",
    status:"verified_explicit_membership",instance:"local_pair",prototype:"synthetic",
    provenance:{kind:"synthetic-test"},anchor_xyz:[0,0,0],cell_bindings:[]};
  for(let i=0;i<2;i++){
    const rows=kinds.map(()=>Array.from({length:24},()=>Array(16).fill(0)));
    rows[3][1][2]=i===0?1:32768;
    const loft={schema:"fgm-regenerator/loft-terrain-v1",voxel_dimensions_xyz:[16,16,24],
      terrain_only:true,tile:{xyz:[i,0,0],record_index:i},part_rows:rows,
      sources:kinds.map(part=>part==="object"
        ? {part,source_index:2,present:true,dataset_label:"SYNTH",local_index:1,loft_ids:Array(12).fill(0)}
        : {part,source_index:0,present:false})};
    receipt.cell_bindings.push({xyz:[i,0,0],local_xyz:[i,0,0],
      part:"object",dataset:"SYNTH",record:1,map_record:i});
    const bytes=Buffer.from(JSON.stringify(loft));
    inputFiles.push({name:"loft-"+i+".json",mimeType:"application/json",buffer:bytes});
  }
  const receiptBytes=Buffer.from(JSON.stringify(receipt));
  await page.locator("#whole-files").setInputFiles([
    {name:"receipt.json",mimeType:"application/json",buffer:receiptBytes},...inputFiles]);
  await page.waitForFunction(()=>document.querySelector("#whole-status").dataset.state==="READY"&&
    !document.querySelector("#whole-run").disabled,null,{timeout:60000});
  await page.locator("#whole-expected").fill(JSON.stringify({
    lofts:inputFiles.map(f=>hashLocal(f.buffer)),receipt:hashLocal(receiptBytes)}));
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>["COMPLETED","ERROR"].includes(document.querySelector("#whole-status").dataset.state),null,{timeout:60000});
  assert.match(await page.locator("#whole-status").textContent(),/^COMPLETED/);
  const localWhole=JSON.parse(await page.locator("#whole-metrics").textContent());
  assert.equal(localWhole.cells,2);
  assert.equal(localWhole.occupied,2);
  const downloading=page.waitForEvent("download");
  await page.locator("#whole-downloads button").filter({hasText:"preview.obj"}).click();
  const downloaded=await downloading;
  assert.equal(downloaded.suggestedFilename(),"preview.obj");
  const obj=await readFile(await downloaded.path(),"utf8");
  assert.equal(obj.split(/\r?\n/).filter(line=>line.startsWith("f ")).length,10);
  console.log("STUDIO_WHOLE_LOCAL_FILE_API_PASS");


  // P2-01: every invalid selection must fail before the first File.arrayBuffer().
  // The test resets the global instrumentation before each attempted import;
  // no engine or File API read is permitted in these negative cases.
  const tiny=Buffer.from("{}");
  const upload=(name,buffer=tiny)=>({name,mimeType:"application/json",buffer});
  const assertRejectedBeforeRead=async (files,error,label)=>{
    await page.evaluate(()=>{window.__studioFileReadCalls=[]});
    await page.locator("#whole-files").setInputFiles(files);
    await page.waitForFunction(()=>document.querySelector("#whole-status").dataset.state==="ERROR",
      null,{timeout:10000});
    assert.match(await page.locator("#whole-status").textContent(),new RegExp(error));
    assert.deepEqual(await page.evaluate(()=>window.__studioFileReadCalls),[],
      label+": invalid files must never reach File.arrayBuffer()");
    assert.equal(await page.locator("#whole-run").isDisabled(),true,label);
    assert.equal(await page.locator("#whole-downloads button").count(),0,label);
    assert.equal(await page.locator("#whole-preview").isVisible(),false,label);
    assert.equal(await page.locator("#whole-expected").inputValue(),"",label);
  };
  await assertRejectedBeforeRead([
    upload("receipt.json",Buffer.alloc(65537)),upload("loft-0.json"),upload("loft-1.json")
  ],"E_WHOLE_LIMIT","one file exceeds 64 KiB");
  await assertRejectedBeforeRead([
    upload("receipt.json",Buffer.alloc(65536)),
    ...Array.from({length:4},(_,i)=>upload("loft-"+i+".json",Buffer.alloc(65536)))
  ],"E_WHOLE_LIMIT","aggregate exceeds 256 KiB");
  await assertRejectedBeforeRead([
    upload("receipt.json"),
    ...Array.from({length:9},(_,i)=>upload("loft-"+i+".json"))
  ],"E_WHOLE_FILES","more than 8 LOFT files");
  await assertRejectedBeforeRead([
    upload("receipt.json"),upload("loft-0.json"),upload("loft-2.json")
  ],"E_WHOLE_FILES","missing LOFT index");
  await assertRejectedBeforeRead([
    upload("receipt.json"),upload("loft-0.json"),upload("loft-0.json")
  ],"E_WHOLE_DUPLICATE","duplicate name");
  console.log("STUDIO_WHOLE_PREFLIGHT_NO_READ_PASS");

  // Invalid imports intentionally clear the active selection. Restore a valid
  // synthetic source before exercising the independent expected-SHA failure.
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled);
  // Wrong operator-provided SHA must fail closed without publishing stale data.
  await page.locator("#whole-expected").fill(JSON.stringify({
    receipt:"0".repeat(64),lofts:Array(4).fill("0".repeat(64))}));
  await workspace("object").click();
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>document.querySelector("#whole-status").dataset.state==="ERROR",null,{timeout:10000});
  assert.match(await page.locator("#whole-status").textContent(),/E_WHOLE_DIGEST/);
  assert.equal(await page.locator("#studio-workspace-placeholder").isVisible(),true);
  assert.match(await page.locator("#studio-workspace-description").textContent(),/ERROR.*E_WHOLE_DIGEST/);
  console.log("STUDIO_D4_U0_WHOLE_TERMINAL_STATUS_SYNC_PASS");
  await workspace("source").click();
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  console.log("STUDIO_WHOLE_BAD_SHA_PASS");
  // An atomic C++ step can only be stopped by Worker termination.
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled);
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false});
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await page.locator("#whole-cancel").click();
  assert.match(await page.locator("#whole-status").textContent(),/^CANCELLED/);
  await page.evaluate(()=>{
    window.__studioGateStep=false;
    try{window.__studioReleaseStep?.()}catch{/* terminated */}
  });
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  console.log("STUDIO_WHOLE_CANCEL_STALE_PASS");

  // U0-V04/whole: change the actual local whole input while hidden and gated.
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled);
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false;window.__studioReleaseStep=null});
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await workspace("mapblock").click();
  await page.locator("#whole-files").setInputFiles([
    {name:"invalid-only.json",mimeType:"application/json",buffer:Buffer.from("{}")}
  ]);
  await page.waitForFunction(()=>document.querySelector("#whole-status").dataset.state==="ERROR");
  await workspace("object").click();
  await page.evaluate(()=>{window.__studioGateStep=false;try{window.__studioReleaseStep?.()}catch{/* terminated */}});
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  assert.equal(await page.locator("#whole-preview").isVisible(),false);
  assert.equal(await page.locator("#whole-view-receipt").textContent(),"");
  assert.match(await page.locator("#studio-workspace-description").textContent(),/ERROR/);
  console.log("STUDIO_D4_U0_HIDDEN_WHOLE_MUTATION_PASS");
  await workspace("source").click();

  // Switching to the previous single-cell workflow while whole step is pending
  // must invalidate and terminate the original Worker (not leak stale output).
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled);
  await page.evaluate(()=>{window.__studioGateStep=true;window.__studioStepGated=false});
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>window.__studioStepGated,null,{timeout:30000});
  await page.locator("#demo").click();
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  await page.evaluate(()=>{
    window.__studioGateStep=false;
    try{window.__studioReleaseStep?.()}catch{/* terminated */}
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#whole-downloads button").count(),0);
  assert.equal(await page.locator("#whole-preview").isVisible(),false);
  console.log("STUDIO_WHOLE_SOURCE_SWITCH_PASS");

  // The pre-existing single-cell R05/R06 path remains intact.
  await page.locator("#demo").click();
  await page.locator("#run").click();
  await waitState("COMPLETED");
  assert.equal(JSON.parse(await page.locator("#metrics").textContent()).voxels_checked,6144);
  console.log("STUDIO_WHOLE_SINGLE_FALLBACK_PASS");

  // U0-V06: destroy the *real* WebGPU device during a MapBlock tab visit.
  await page.locator("#whole-demo").click();
  await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled);
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>["COMPLETED","ERROR"].includes(document.querySelector("#whole-status").dataset.state),null,{timeout:60000});
  assert.match(await page.locator("#whole-status").textContent(),/^COMPLETED/);
  const beforeGpuLoss=await page.locator("#whole-metrics").textContent();
  assert.equal(await page.evaluate(()=>Boolean(window.__studioU0Device)),true,"GPU test requires real RendererSession device");
  await workspace("source").click();
  await page.locator("#u5-view-choice").selectOption("compare");
  await page.waitForFunction(()=>document.querySelector("#u5-compare-status").textContent.includes("WHOLE_FRAME_READY"),null,{timeout:60000});
  assert.match(await page.locator("#u5-compare-status").textContent(),/UNBOUND_DIAGNOSTIC · NOT_PIXEL_COMPARABLE/);
  assert.match(await page.locator("#u5-source-capability").textContent(),/R05_READY/);
  assert.equal(await page.locator("#u5-source-pane").isVisible(),true);
  assert.equal(await page.locator("#u5-whole-pane").isVisible(),true);
  const successfulFrames=await page.evaluate(()=>window.__u5WholeEvents.filter(e=>e.state==="WHOLE_FRAME_READY").length);
  await workspace("mapblock").click();
  await page.evaluate(async()=>{window.__studioU0Device.destroy();await window.__studioU0Device.lost});
  await page.waitForFunction(()=>window.__u5WholeEvents.some(e=>e.state==="WHOLE_FRAME_UNAVAILABLE"),null,{timeout:30000});
  assert.equal(await page.evaluate(()=>window.__u5WholeEvents.filter(e=>e.state==="WHOLE_FRAME_READY").length),successfulFrames,
    "passive loss cannot invoke hidden background redraw");
  await workspace("object").click();
  const alpha=await page.locator("#whole-preview").evaluate(c=>{
    const bytes=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
    let nontransparent=0;
    for(let i=3;i<bytes.length;i+=4)if(bytes[i])nontransparent++;
    return nontransparent;
  });
  assert.equal(alpha,0,"lost GPU republished an old visible frame");
  assert.equal(await page.locator("#whole-metrics").textContent(),beforeGpuLoss,
    "GPU loss must not invalidate independently verified C++/WASM model");
  await workspace("source").click();
  await page.locator("#u5-view-choice").selectOption("compare");
  assert.match(await page.locator("#u5-compare-status").textContent(),/WHOLE_FRAME_UNAVAILABLE/);
  assert.match(await page.locator("#u5-source-capability").textContent(),/R05_READY/);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
  assert.equal(await page.locator("#u5-whole-pane").isVisible(),true);
  await page.setViewportSize({width:1280,height:900});
  await page.locator("#u5-view-choice").focus();
  assert.equal(await page.evaluate(()=>document.activeElement?.id),"u5-view-choice");
  assert.equal(await page.locator("#whole-metrics").textContent(),beforeGpuLoss);
  console.log("STUDIO_D4_U0_GPU_LOSS_RETURN_PASS");
  console.log("STUDIO_D4_U5_COMPARE_PASSIVE_GPU_LOSS_NATIVE_WASM_PASS");
  // Keep the following catalogue tests on a clean GPU/session.
  await page.reload();

  if(process.argv.includes("--catalog")) {
    await page.reload();
    assert.equal(await page.locator("#catalog-map").count(),1,"папка игры должна открывать каталог");
    assert.equal(await page.locator("#manual-bindings").getAttribute("open"),null);
    const rootDir=await mkdtemp(join(tmpdir(),"studio-ufo-"));
    try {
      await writeStudioUfoCatalogFixture(rootDir);
      const mapMenu=page.locator("#catalog-map"), elementMenu=page.locator("#catalog-element");
      const pick=async()=>{
        await page.locator("#directory").setInputFiles(rootDir);
        await mapMenu.locator("option[value=CULTA00]").waitFor({state:"attached"});
      };
      await pick();
      assert.equal(await mapMenu.locator("option").count(),6);
      assert.equal(await mapMenu.locator("option[value=INTICON]").count(),0);
      assert.equal(await page.locator("#run").isDisabled(),true);
      await mapMenu.selectOption("MAP3");
      assert.match(await page.locator("#catalog-summary").textContent(),/неизвест/i);
      await mapMenu.selectOption("FOREST00");
      assert.match(await page.locator("#catalog-summary").textContent(),/не хватает/i);
      await mapMenu.selectOption("CULTA02");
      await waitState("ERROR");
      assert.match(await page.locator("#status").textContent(),/E_R02_MAP_LENGTH/);
      const before=await page.evaluate(()=>window.__studioReads);
      await mapMenu.selectOption("CULTA00");
      await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled);
      assert.equal(await elementMenu.getAttribute("role"),"combobox");
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"false");
      await elementMenu.click();
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"true");
      const item=dataset=>page.locator('#catalog-element-options [role="option"]')
        .filter({hasText:new RegExp(dataset+" №")}).first();
      const rgb=async (row,x)=>row.locator("canvas").evaluate((canvas,x)=>{
        const v=canvas.getContext("2d").getImageData(x,0,1,1).data;
        return Array.from(v);
      },x);
      await page.waitForFunction(()=>{
        const rows=[...document.querySelectorAll('#catalog-element-options [role="option"]')];
        return rows.length>=4 && rows.every(r=>!r.querySelector("canvas").hidden);
      },null,{timeout:30000});
      assert.deepEqual(await rgb(item("BLANKS"),5),[0,0,252,255]);
      assert.deepEqual(await rgb(item("CULTIVAT"),10),[0,252,0,255]);
      const fullDoor=page.locator('#catalog-element-options [role="option"]')
        .filter({hasText:/Дверь/}).filter({hasNotText:/правая половина/}).first();
      assert.deepEqual(await rgb(fullDoor,5),[252,0,0,255]);
      assert.deepEqual(await rgb(fullDoor,20),[252,0,0,255]);
      const rightDoor=page.locator('#catalog-element-options [role="option"]')
        .filter({hasText:/Дверь.*правая половина/}).first();
      assert.deepEqual(await rgb(rightDoor,5),[0,0,0,0]);
      assert.deepEqual(await rgb(rightDoor,20),[252,0,0,255]);
      console.log("STUDIO_R04_THUMB_PRESELECT_PIXELS_PASS");
      assert.equal(await elementMenu.evaluate(el=>el.value),"");
      await elementMenu.press("End");
      assert.ok(await elementMenu.getAttribute("aria-activedescendant"));
      await elementMenu.press("Home");
      await elementMenu.press("Escape");
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"false");
      assert.equal(await elementMenu.evaluate(el=>el.value),"");
      await elementMenu.press("ArrowDown");
      await elementMenu.press("Enter");
      assert.notEqual(await elementMenu.evaluate(el=>el.value),"");
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"false");
      assert.equal(await page.locator("#catalog-element-icon").isVisible(),true);
      await elementMenu.click();
      const door=page.locator('#catalog-element-options [role="option"]').filter({hasText:/Дверь/}).first();
      await door.waitFor({state:"visible"});
      const key=await door.getAttribute("data-index");
      await door.click();
      await page.locator("#run").click();
      await waitState("COMPLETED");
      metrics=JSON.parse(await page.locator("#metrics").textContent());
      assert.equal(metrics.source.dataset_label,"BARN");
      assert.equal(metrics.source.local_index,0);
      assert.equal(metrics.occupied,18);
      const reads=await page.evaluate(()=>window.__studioReads);
      for(const file of ["CULTA00.MAP","BARN.MCD"]) {
        const path=Object.keys(reads).find(path=>path.endsWith("/"+file));
        assert.ok(path);
        assert.equal(reads[path]-(before[path]??0),1);
      }
      assert.equal(Object.keys(reads).some(path=>path.includes("/GEOGRAPH/")),false);

      // D4-U1 SourcePartRef is the true R02 placement, not the type's first tile.
      const grid=page.locator("#source-grid button[data-source-part-ref]");
      await page.waitForFunction(()=>document.querySelectorAll(
        "#source-grid button[data-source-part-ref]").length>=4);
      assert.equal(await page.locator("#source-placement-panel").isVisible(),true);
      assert.equal(await page.locator("#source-floor").inputValue(),"0");
      const digestLabel=await page.locator("#source-page-status").textContent();
      assert.match(digestLabel,/SHA-256 [0-9a-f]{12}/);
      const firstPlacement=grid.first();
      const bound=await firstPlacement.evaluate(b=>({
        ref:b.dataset.sourcePartRef,x:Number(b.dataset.x),y:Number(b.dataset.y)
      }));
      await firstPlacement.click();
      assert.equal(await firstPlacement.getAttribute("aria-pressed"),"true");
      assert.equal(await firstPlacement.evaluate(el=>document.activeElement===el),true);
      assert.match(await page.locator("#source-placement-status").textContent(),/R02.*семантический объект/);
      assert.equal(await page.locator("#run").isDisabled(),false);
      await page.locator("#run").click();
      await waitState("COMPLETED");
      const placementResult=JSON.parse(await page.locator("#metrics").textContent());
      assert.deepEqual(placementResult.tile,[bound.x,bound.y,0]);
      assert.match(await page.locator("#source-placement-status").textContent(),new RegExp(bound.ref.slice(0,12)));
      await page.locator('#studio-workspaces [data-workspace="object"]').click();
      await page.locator('#studio-workspaces [data-workspace="source"]').click();
      assert.equal(await page.locator("#source-grid button[aria-pressed=true]").count(),1);
      assert.deepEqual(JSON.parse(await page.locator("#metrics").textContent()).tile,
        [bound.x,bound.y,0]);
      await grid.first().focus();
      await grid.first().press("End");
      assert.equal(await grid.last().evaluate(el=>document.activeElement===el),true);
      await grid.last().press("Home");
      assert.equal(await grid.first().evaluate(el=>document.activeElement===el),true);
      await grid.first().press("ArrowDown");
      assert.equal(await page.locator("#source-grid").isVisible(),true);
      console.log("STUDIO_D4_U1_SOURCE_GRID_R02_R06_PASS");



      // Adversarial U1 regression against the REAL packaged R02/R04/R06 WASM.
      // 3×11×2 tiles, four present parts each = 132 placements per floor.
      const u1Dir=await mkdtemp(join(tmpdir(),"studio-u1-floors-"));
      try{
        await writeStudioUfoCatalogFixture(u1Dir);
        const multi=Buffer.alloc(3+3*11*2*4,1);
        multi[0]=3;multi[1]=11;multi[2]=2;
        await writeFile(join(u1Dir,"MAPS/CULTA00.MAP"),multi);
        await page.locator("#directory").setInputFiles(u1Dir);
        await mapMenu.locator("option[value=CULTA00]").waitFor({state:"attached"});
        await mapMenu.selectOption("CULTA00");
        const pageLabel=page.locator("#source-page-status");
        await page.waitForFunction(()=>document.querySelectorAll(
          "#source-grid button[data-source-part-ref]").length===128 &&
          document.querySelector("#source-page-status").textContent.includes("Z=0"),
          null,{timeout:60000});
        assert.match(await pageLabel.textContent(),/132 частей/);
        const u1Grid=page.locator("#source-grid button[data-source-part-ref]");
        const sourceInfo=button=>button.evaluate(b=>({
          ref:b.dataset.sourcePartRef,x:Number(b.dataset.x),y:Number(b.dataset.y),
          part:b.dataset.part
        }));
        const a=await sourceInfo(u1Grid.first());
        await u1Grid.first().click();
        await page.locator("#run").click();await waitState("COMPLETED");
        const ma=JSON.parse(await page.locator("#metrics").textContent());
        assert.deepEqual(ma.tile,[a.x,a.y,0]);
        assert.equal(ma.sourcePartRef,a.ref);
        const b=await sourceInfo(u1Grid.nth(4));
        assert.equal(a.part,b.part);
        await u1Grid.nth(4).click();
        await page.locator("#run").click();await waitState("COMPLETED");
        const mb=JSON.parse(await page.locator("#metrics").textContent());
        assert.deepEqual(mb.tile,[b.x,b.y,0]);
        assert.equal(mb.sourcePartRef,b.ref);
        assert.notEqual(ma.sourcePartRef,mb.sourcePartRef);
        assert.deepEqual(ma.source,mb.source,"same original MCD type in two real MAP tiles");

        // D4-U2: same MCD type, two distinct true R02 occurrences, one
        // proposal-only semantic hypothesis. All UI tested in packaged Chromium.
        const workspaceU2=name=>page.locator('#studio-workspaces [data-workspace="'+name+'"]');
        await workspaceU2("object").click();
        assert.match(await page.locator("#object-draft-state").textContent(),/NO_DRAFT/);
        assert.match(await page.locator("#object-selected-part").textContent(),new RegExp(b.ref.slice(0,16)));
        await page.locator("#object-name").fill("Проверяемый объект");
        await page.locator("#object-create").click();
        assert.match(await page.locator("#object-draft-state").textContent(),/DRAFT/);
        assert.equal(await page.locator("#object-hypotheses").inputValue(),"h1");
        await page.locator("#object-add").click();
        assert.equal(await page.locator("#object-members button").count(),1);
        await workspaceU2("source").click();
        assert.deepEqual(JSON.parse(await page.locator("#metrics").textContent()).tile,[b.x,b.y,0],
          "navigation does not destroy valid native R06 result");
        await u1Grid.first().click();
        await workspaceU2("object").click();
        await page.locator("#object-add").click();
        assert.equal(await page.locator("#object-members button").count(),2);
        await page.locator("#object-add").click();
        assert.match(await page.locator("#object-action-status").textContent(),/E_U2_DUPLICATE/);
        assert.equal(await page.locator("#object-members button").count(),2);
        await page.locator("#object-name").fill("Вторая гипотеза");
        await page.locator("#object-create").click();
        assert.equal(await page.locator("#object-hypotheses").inputValue(),"h2");
        await page.locator("#object-add").click();
        assert.match(await page.locator("#object-action-status").textContent(),/E_U2_MEMBER_CONFLICT/);
        assert.equal(await page.locator("#object-members button").count(),0);
        await page.locator("#object-hypotheses").selectOption("h1");
        // Retain a real old h1 DOM control before legitimate P: h1 -> h2 transfer.
        await page.evaluate(ref=>{
          window.__studioU2OldRemove=[...document.querySelectorAll(
            '#object-members button[data-source-part-ref]')]
            .find(button=>button.dataset.sourcePartRef===ref);
        },a.ref);
        assert.equal(await page.evaluate(()=>window.__studioU2OldRemove.isConnected),true);
        await page.locator('#object-members button[data-source-part-ref="'+a.ref+'"]').click();
        assert.equal(await page.locator("#object-members button").count(),1);
        await page.locator("#object-hypotheses").selectOption("h2");
        await page.locator("#object-add").click();
        assert.equal(await page.locator("#object-members button").count(),1);
        assert.equal(await page.evaluate(()=>window.__studioU2OldRemove.isConnected),false);
        const beforeOldAction=await page.locator("#object-action-status").textContent();
        await page.evaluate(()=>window.__studioU2OldRemove.click());
        assert.equal(await page.locator("#object-members button").count(),1,
          "stale h1 click must not unassign PartRef from its new h2 owner");
        assert.equal(await page.locator("#object-action-status").textContent(),beforeOldAction,
          "stale detached event must not claim an APPLIED intent");
        await page.locator("#object-name").fill("Новая подпись");
        await page.locator("#object-rename").click();
        assert.match(await page.locator("#object-hypotheses").textContent(),/Новая подпись/);
        // The R04 type picker legitimately clears SourcePartRef, disabling Add.
        // Unassigning the last h1 member must still leave an enabled focus target.
        await workspaceU2("source").click();
        await elementMenu.click();
        await page.locator('#catalog-element-options [role="option"]').first().click();
        await workspaceU2("object").click();
        assert.match(await page.locator("#object-selected-part").textContent(),/не выбрана/);
        assert.equal(await page.locator("#object-add").isDisabled(),true);
        await page.locator("#object-hypotheses").selectOption("h1");
        await page.locator("#object-members button").first().focus();
        await page.locator("#object-members button").first().press("Enter");
        assert.equal(await page.locator("#object-members button").count(),0);
        assert.equal(await page.locator("#object-hypotheses").evaluate(el=>
          document.activeElement===el && !el.disabled),true,
          "removing with disabled Add must focus an enabled hypothesis control");
        // Restore the native part from the original R02 grid, not via type key.
        await workspaceU2("source").click();
        await u1Grid.nth(4).click();
        await workspaceU2("object").click();
        assert.equal(await page.locator("#object-add").isDisabled(),false);
        await page.locator("#object-add").click();
        assert.equal(await page.locator("#object-members button").count(),1);
        await page.locator("#object-hypotheses").selectOption("h2");
        console.log("STUDIO_D4_U2_STALE_OWNER_AND_KEYBOARD_FOCUS_PASS");
        const downloadPromise=page.waitForEvent("download");
        await page.locator("#object-export").click();
        const draftDownload=await downloadPromise;
        const draftJSON=JSON.parse(await readFile(await draftDownload.path(),"utf8"));
        assert.equal(draftJSON.schema,"fgmp-studio-object-hypotheses-draft/1");
        assert.equal(draftJSON.mapId,"CULTA00");
        assert.match(draftJSON.sourceDigest,/^[0-9a-f]{64}$/);
        assert.equal(draftJSON.hypotheses.length,2);
        assert.deepEqual(draftJSON.hypotheses.map(h=>h.members.map(m=>m.sourcePartRef)),[[b.ref],[a.ref]]);
        assert.equal(draftJSON.hypotheses[0].members[0].record,
          draftJSON.hypotheses[1].members[0].record);
        assert.ok(draftJSON.intents.some(e=>e.op==="assign"&&e.outcome==="REJECTED"&&
          e.code==="E_U2_MEMBER_CONFLICT"));
        assert.ok(draftJSON.conflicts.some(c=>c.code==="E_U2_DUPLICATE"));
        assert.equal(draftJSON.intents.filter(i=>
          i.op==="unassign"&&i.sourcePartRef===a.ref&&i.outcome==="APPLIED").length,1,
          "detached h1 control must not add a second successful unassign intent");
        assert.equal(JSON.stringify(draftJSON).includes("indices_hex"),false);
        assert.equal(JSON.stringify(draftJSON).includes("palette_rgb8"),false);
        assert.equal(JSON.stringify(draftJSON).includes("lofts"),false);
        // Native keyboard activation, deletion and typed intent accounting.
        await page.locator("#object-delete").focus();
        await page.locator("#object-delete").press("Enter");
        assert.equal(await page.locator("#object-hypotheses").inputValue(),"h1");
        assert.equal(await page.locator("#object-hypotheses option").count(),2);
        assert.equal(await page.locator("#object-members button").count(),1);
        const deletedExport=page.waitForEvent("download");
        await page.locator("#object-export").click();
        const deletedReceipt=JSON.parse(await readFile(await (await deletedExport).path(),"utf8"));
        assert.equal(deletedReceipt.hypotheses.length,1);
        assert.ok(deletedReceipt.intents.some(i=>i.op==="delete"&&i.hypothesisId==="h2"&&i.outcome==="APPLIED"));
        await page.setViewportSize({width:390,height:844});
        assert.deepEqual(await page.evaluate(()=>[
          document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
        await page.setViewportSize({width:1280,height:900});
        console.log("STUDIO_D4_U2_MEMBERSHIP_CONFLICTS_EXPORT_PASS");
        await workspaceU2("source").click();



        // Gate only the genuine catalog-placements message, never fabricate a reply.
        await page.evaluate(()=>{
          window.__studioStaleButton=document.querySelector("#source-grid button");
          window.__studioGatePlacements=true;window.__studioPlacementsGated=false;
          window.__studioReleasePlacements=null;
        });
        await page.locator("#source-floor").selectOption("1");
        await page.waitForFunction(()=>window.__studioPlacementsGated,null,{timeout:60000});
        await page.evaluate(()=>window.__studioStaleButton.click()); // detached old closure
        assert.equal(await u1Grid.count(),0,"old floor is retired during native pending");
        assert.equal(await page.locator("#run").isDisabled(),true);
        await assertNoResult();
        await workspaceU2("object").click();
        assert.equal(await page.locator("#object-add").isDisabled(),true,
          "U2 cannot assign stale selection while real native R02 page is pending");
        assert.equal(await page.locator("#object-members button").count(),1);
        await workspaceU2("source").click();
        await page.evaluate(()=>{
          window.__studioGatePlacements=false;window.__studioReleasePlacements();
        });
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("Z=1") &&
          document.querySelectorAll("#source-grid button").length===128,
          null,{timeout:60000});
        assert.equal(await page.locator("#source-floor").inputValue(),"1");
        const upstairs=u1Grid.first();
        const upstairsInfo=await sourceInfo(upstairs);
        await upstairs.focus();
        await upstairs.press("Space");
        assert.equal(await upstairs.getAttribute("aria-pressed"),"true");
        assert.equal(await upstairs.evaluate(el=>document.activeElement===el),true);
        await page.locator("#run").click();await waitState("COMPLETED");
        const mz=JSON.parse(await page.locator("#metrics").textContent());
        assert.deepEqual(mz.tile,[upstairsInfo.x,upstairsInfo.y,1]);
        assert.equal(mz.sourcePartRef,upstairsInfo.ref);
        assert.notEqual(mz.sourcePartRef,a.ref);
        await workspaceU2("object").click();
        await page.locator("#object-add").focus();
        await page.locator("#object-add").press("Enter");
        assert.equal(await page.locator("#object-members button").count(),2);
        assert.match(await page.locator("#object-members").textContent(),
          new RegExp(upstairsInfo.ref.slice(0,16)));
        console.log("STUDIO_D4_U2_PENDING_NATIVE_GUARD_AND_KEYBOARD_DELETE_PASS");
        await workspaceU2("source").click();

        await page.locator("#source-next").focus();
        await page.locator("#source-next").press("Enter");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("129–132"),null,{timeout:60000});
        assert.equal(await u1Grid.count(),4);
        assert.equal(await page.locator("#source-next").isDisabled(),true);
        assert.equal(await page.locator("#source-prev").evaluate(el=>document.activeElement===el),true,
          "disabled last-page Next transfers keyboard focus to enabled Prev");
        await u1Grid.first().focus();await u1Grid.first().press("End");
        assert.equal(await u1Grid.last().evaluate(el=>document.activeElement===el),true);
        await u1Grid.last().press("Home");
        assert.equal(await u1Grid.first().evaluate(el=>document.activeElement===el),true);
        await u1Grid.first().press("ArrowDown");
        assert.equal(await u1Grid.nth(1).evaluate(el=>document.activeElement===el),true);
        await u1Grid.nth(1).press("Enter");
        assert.equal(await u1Grid.nth(1).getAttribute("aria-pressed"),"true");
        await page.locator("#source-prev").focus();
        await page.locator("#source-prev").press("Enter");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("1–128"),null,{timeout:60000});
        assert.equal(await u1Grid.count(),128);
        assert.equal(await page.locator("#source-next").evaluate(el=>document.activeElement===el),true,
          "disabled first-page Prev transfers keyboard focus to enabled Next");

        // Fail the actual native digest check; no obsolete grid or R06 can survive.
        await page.evaluate(()=>{window.__studioBadPlacementDigest=true});
        await page.locator("#source-floor").selectOption("0");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("E_STUDIO_PLACEMENTS_DIGEST"),null,{timeout:60000});
        assert.equal(await u1Grid.count(),0);
        assert.equal(await page.locator("#run").isDisabled(),true);
        await assertNoResult();
        await page.evaluate(()=>{window.__studioBadPlacementDigest=false});

        // Rapid 0→1→0 flips: release a request on an obsolete terminated Worker.
        await page.locator("#source-floor").selectOption("1");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("Z=1"),null,{timeout:60000});
        await page.evaluate(()=>{
          window.__studioGatePlacements=true;window.__studioPlacementsGated=false;
          window.__studioReleasePlacements=null;
        });
        await page.locator("#source-floor").selectOption("0");
        await page.waitForFunction(()=>window.__studioPlacementsGated,null,{timeout:60000});
        await page.evaluate(()=>{window.__studioGatePlacements=false});
        await page.locator("#source-floor").selectOption("1");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("Z=1"),null,{timeout:60000});
        await page.evaluate(()=>{
          try{window.__studioReleasePlacements?.()}catch{/* worker terminated */}
        });
        assert.equal(await page.locator("#source-floor").inputValue(),"1");
        assert.equal(await u1Grid.count(),128);

        // P2-D4-U1-02: picking a real R04 type while floor R02 is gated
        // must re-issue the exact current page, not strand the Source workspace.
        await page.locator("#source-floor").selectOption("0");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("Z=0"),null,{timeout:60000});
        await page.evaluate(()=>{
          window.__studioGatePlacements=true;window.__studioPlacementsGated=false;
          window.__studioReleasePlacements=null;
        });
        await page.locator("#source-floor").selectOption("1");
        await page.waitForFunction(()=>window.__studioPlacementsGated,null,{timeout:60000});
        await page.evaluate(()=>{window.__studioGatePlacements=false});
        await elementMenu.click();
        const previousType=await elementMenu.evaluate(el=>el.value);
        const differentType=page.locator('#catalog-element-options [role="option"]').last();
        await differentType.waitFor({state:"visible"});
        await differentType.click(); // cancels old page Worker through invalidateRun()
        assert.notEqual(await elementMenu.evaluate(el=>el.value),previousType);
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("Z=1") &&
          document.querySelectorAll("#source-grid button").length===128,
          null,{timeout:60000});
        await page.evaluate(()=>{
          try{window.__studioReleasePlacements?.()}catch{/* stale terminated Worker */}
        });
        assert.equal(await page.locator("#source-floor").inputValue(),"1");
        assert.equal(await u1Grid.count(),128);
        assert.equal(await page.locator('#source-grid button[aria-pressed="true"]').count(),0);
        assert.match(await page.locator("#source-placement-status").textContent(),/размещение не выбрано/);
        await assertNoResult();
        const afterRecovery=await sourceInfo(u1Grid.nth(4));
        await u1Grid.nth(4).click();
        await page.locator("#run").click();await waitState("COMPLETED");
        const recoveryReport=JSON.parse(await page.locator("#metrics").textContent());
        assert.deepEqual(recoveryReport.tile,[afterRecovery.x,afterRecovery.y,1]);
        assert.equal(recoveryReport.sourcePartRef,afterRecovery.ref);
        console.log("STUDIO_D4_U1_R04_DURING_FLOOR_LOAD_RECOVERY_PASS");
        await page.setViewportSize({width:390,height:844});
        assert.deepEqual(await page.evaluate(()=>[
          document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
        await u1Grid.first().focus();await u1Grid.first().press("Enter");
        assert.equal(await u1Grid.first().getAttribute("aria-pressed"),"true");
        await page.setViewportSize({width:1280,height:900});
        console.log("STUDIO_D4_U1_FLOOR_PAGE_RACE_AND_IDENTITY_PASS");
      }finally{
        await pick();await mapMenu.selectOption("CULTA00");
        await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled,
          null,{timeout:60000});
        await rm(u1Dir,{recursive:true,force:true});
      }


      // Single-floor paged MAP: there is no floor-change escape hatch if R04
      // cancels page 129–132. The same page must return via real native WASM.
      const oneFloorDir=await mkdtemp(join(tmpdir(),"studio-u1-onefloor-"));
      try {
        await writeStudioUfoCatalogFixture(oneFloorDir);
        const tiles=Buffer.alloc(3+3*11*4,1);
        tiles[0]=3;tiles[1]=11;tiles[2]=1;
        await writeFile(join(oneFloorDir,"MAPS/CULTA00.MAP"),tiles);
        await page.locator("#directory").setInputFiles(oneFloorDir);
        assert.match(await page.locator("#object-draft-state").textContent(),/STALE_SOURCE/);
        assert.equal(await page.locator("#object-add").isDisabled(),true);
        await mapMenu.locator("option[value=CULTA00]").waitFor({state:"attached"});
        await mapMenu.selectOption("CULTA00");
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("132 частей") &&
          document.querySelectorAll("#source-grid button").length===128,
          null,{timeout:60000});
        assert.match(await page.locator("#object-draft-state").textContent(),/STALE_SOURCE/);
        await page.locator('#studio-workspaces [data-workspace="object"]').click();
        await page.locator("#object-reset").click();
        assert.match(await page.locator("#object-draft-state").textContent(),/DRAFT/);
        assert.equal(await page.locator("#object-hypotheses").locator("option").count(),1);
        await page.locator('#studio-workspaces [data-workspace="source"]').click();
        const onlyFloorGrid=page.locator("#source-grid button[data-source-part-ref]");
        await page.evaluate(()=>{
          window.__studioGatePlacements=true;window.__studioPlacementsGated=false;
          window.__studioReleasePlacements=null;
        });
        await page.locator("#source-next").click();
        await page.waitForFunction(()=>window.__studioPlacementsGated,null,{timeout:60000});
        await page.evaluate(()=>{window.__studioGatePlacements=false});
        await elementMenu.click();
        const typeOnPendingPage=page.locator('#catalog-element-options [role="option"]').last();
        await typeOnPendingPage.waitFor({state:"visible"});
        await typeOnPendingPage.click();
        await page.waitForFunction(()=>document.querySelector("#source-page-status")
          .textContent.includes("129–132") &&
          document.querySelectorAll("#source-grid button").length===4,
          null,{timeout:60000});
        await page.evaluate(()=>{
          try{window.__studioReleasePlacements?.()}catch{/* old Worker terminated */}
        });
        assert.equal(await page.locator("#source-floor").locator("option").count(),1);
        assert.equal(await onlyFloorGrid.count(),4);
        const finalPart=await onlyFloorGrid.first().evaluate(el=>({
          ref:el.dataset.sourcePartRef,
          tile:[Number(el.dataset.x),Number(el.dataset.y),0]
        }));
        await onlyFloorGrid.first().press("Enter");
        assert.equal(await page.locator("#run").isDisabled(),false);
        await page.locator("#run").click();await waitState("COMPLETED");
        const finalReport=JSON.parse(await page.locator("#metrics").textContent());
        assert.deepEqual(finalReport.tile,finalPart.tile);
        assert.equal(finalReport.sourcePartRef,finalPart.ref);
        console.log("STUDIO_D4_U1_SINGLE_FLOOR_R04_PAGE_RECOVERY_PASS");
      } finally {
        await pick();await mapMenu.selectOption("CULTA00");
        await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled,
          null,{timeout:60000});
        await rm(oneFloorDir,{recursive:true,force:true});
      }

      await page.evaluate(()=>{window.__studioGateCatalog=true});
      await mapMenu.selectOption("CULTA01");
      await page.waitForFunction(()=>window.__studioReleaseCatalog!==null);
      await pick();
      await assertNoResult();
      assert.equal(await page.locator("#run").isDisabled(),true);
      await page.evaluate(()=>{
        window.__studioGateCatalog=false;
        try {window.__studioReleaseCatalog?.()} catch {/* terminated Worker */}
      });
      await mapMenu.selectOption("CULTA00");
      await elementMenu.click();
      const doorAfter=page.locator('#catalog-element-options [role="option"]').filter({hasText:/Дверь/}).first();
      await doorAfter.waitFor({state:"visible"});
      assert.equal(await doorAfter.getAttribute("data-index"),key);
      await elementMenu.press("Escape");
      console.log("STUDIO_UFO_CATALOG_BROWSER_PASS");

      // With a fresh selected map, gate a real thumbnail worker before its R04 action.
      await mapMenu.selectOption("CULTA00");
      await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled);
      await page.evaluate(()=>{window.__studioGateThumb=true;window.__studioThumbGated=false;});
      await elementMenu.click();
      await page.waitForFunction(()=>window.__studioThumbGated,null,{timeout:30000});
      await mapMenu.selectOption("CULTA01");
      assert.equal(await elementMenu.isDisabled(),true);
      assert.equal(await page.locator("#catalog-element-options").isVisible(),false);
      await page.evaluate(()=>{
        window.__studioGateThumb=false;
        try{window.__studioReleaseThumb?.()}catch{/* stale Worker terminated */}
      });
      await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled,
        null,{timeout:30000});
      assert.equal(await elementMenu.evaluate(el=>el.value),"");
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"false");
      assert.equal(await page.locator("#catalog-element-icon").isVisible(),false);
      console.log("STUDIO_R04_THUMB_STALE_MAP_PASS");

      // U0-V03/R04: genuine pending PCK/TAB sprite decode across task tabs.
      await mapMenu.selectOption("CULTA00");
      await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled);
      await page.evaluate(()=>{window.__studioGateThumb=true;window.__studioThumbGated=false;window.__studioReleaseThumb=null});
      await elementMenu.click();
      await page.waitForFunction(()=>window.__studioThumbGated,null,{timeout:30000});
      const originalMap=await mapMenu.inputValue();
      await workspace("object").click();
      await workspace("mapblock").click();
      await workspace("source").click();
      assert.equal(await mapMenu.inputValue(),originalMap);
      assert.equal(await elementMenu.evaluate(el=>el.value),"");
      // The proven existing picker closes on document pointerdown outside it.
      // Task-navigation is such a pointerdown: closing is expected, not R04
      // source invalidation. Reopen the real list to display cached/pending sprites.
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"false");
      await elementMenu.click();
      assert.equal(await elementMenu.getAttribute("aria-expanded"),"true");
      await page.evaluate(()=>{window.__studioGateThumb=false;window.__studioReleaseThumb?.()});
      await page.waitForFunction(()=>{
        const rows=[...document.querySelectorAll('#catalog-element-options [role="option"]')];
        return rows.length>=4 && rows.every(r=>!r.querySelector("canvas").hidden);
      },null,{timeout:30000});
      assert.deepEqual(await rgb(item("CULTIVAT"),10),[0,252,0,255]);
      await elementMenu.press("Escape");
      assert.equal(await elementMenu.evaluate(el=>el.value),"");
      console.log("STUDIO_D4_U0_PENDING_R04_NAV_PASS");

      // D4-U3, SCOPE-R1: real synthetic MAP files using canonical WASM R02.
      // These are not spoofed Worker responses or private original UFO bytes.
      const makeU3Map=(w,h,z,fill=4)=>{
        const bytes=Buffer.alloc(3+4*w*h*z);
        bytes[0]=h;bytes[1]=w;bytes[2]=z;
        for(let tile=0;tile<w*h*z;tile++)
          for(let part=0;part<fill;part++)
            bytes[3+4*tile+part]=[2,3,1,2][part]; // Four nonzero slots; valid MCD indices 0..3.
        return bytes;
      };
      await writeFile(join(rootDir,"MAPS","CULTA10.MAP"),makeU3Map(20,20,2));
      await writeFile(join(rootDir,"MAPS","CULTA11.MAP"),makeU3Map(10,10,1,2));
      await writeFile(join(rootDir,"MAPS","CULTA12.MAP"),makeU3Map(5,5,1));
      await writeFile(join(rootDir,"MAPS","CULTA13.MAP"),makeU3Map(10,10,1,0));
      await writeFile(join(rootDir,"MAPS","CULTA14.MAP"),makeU3Map(10,10,1,2));
      await mkdir(join(rootDir,"ROUTES"),{recursive:true});
      await writeFile(join(rootDir,"ROUTES","CULTA10.RMP"),Buffer.from([1,2,3]));
      // One selected source never reads RMP raw bytes; this is presence-only.
      await page.locator("#directory").setInputFiles(rootDir);
      await mapMenu.locator('option[value="CULTA10"]').waitFor({state:"attached"});
      await workspace("mapblock").click();
      const library=page.locator("#mapblock-library");
      const blockFloor=page.locator("#mapblock-floor");
      const blockCells=page.locator("#mapblock-grid .mapblock-cell");
      assert.equal(await library.locator('option[value="MAP3"]').count(),1);
      assert.equal(await library.locator('option[value="CULTA10"]').count(),1);
      assert.equal(await blockFloor.isDisabled(),true);
      assert.match(await page.locator("#mapblock-status").textContent(),/NO_SOURCE/);
      await library.selectOption("MAP3");
      assert.match(await page.locator("#catalog-summary").textContent(),/неизвест/i);
      assert.match(await page.locator("#mapblock-status").textContent(),/PROFILE_UNKNOWN/);
      assert.equal(await blockFloor.isDisabled(),true);
      await library.selectOption("FOREST00");
      assert.match(await page.locator("#mapblock-status").textContent(),/INCOMPLETE/);
      await library.selectOption("CULTA02");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.includes("E_R02_MAP_LENGTH"),null,{timeout:30000});
      assert.equal(await blockCells.count(),0,"corrupt MAP must not display a previous block");
      await library.selectOption("CULTA10");
      await page.waitForFunction(()=>!document.querySelector("#mapblock-floor").disabled ||
        document.querySelector("#status").dataset.state==="ERROR",null,{timeout:30000});
      await page.waitForTimeout(1200);
      const u3Debug=await page.evaluate(()=>({
        source:document.querySelector("#catalog-summary").textContent,
        state:document.querySelector("#status").textContent,
        block:document.querySelector("#mapblock-status").textContent,
        map:document.querySelector("#catalog-map").value,
        floor:document.querySelector("#mapblock-floor").value,
        active:document.querySelector('body').dataset.workspace,
        library:document.querySelector("#mapblock-library").value,
        cells:document.querySelector("#mapblock-grid").children.length
      }));
      console.log("STUDIO_D4_U3_DIAGNOSTIC",JSON.stringify(u3Debug));
      assert.match(u3Debug.block,/^SOURCE_LAYOUT_2D/,
        "native full-floor failure details: "+JSON.stringify(u3Debug));
      assert.match(await page.locator("#mapblock-status").textContent(),/20×20×2/);
      assert.match(await page.locator("#mapblock-status").textContent(),/1600/);
      assert.equal(await blockCells.count(),400);
      assert.equal(await blockFloor.locator("option").count(),2);
      assert.match(await page.locator("#mapblock-route").textContent(),/ROUTE_FILE_PRESENT_UNPARSED/);
      assert.equal(await page.locator("#mapblock-parts button").count(),4);
      const part0=await page.locator("#mapblock-parts button").first()
        .getAttribute("data-source-part-ref");
      assert.match(part0,/^[a-f0-9]{64}\/\d+-[0-3]$/);
      assert.equal(await blockCells.first().getAttribute("aria-pressed"),"true");
      await blockCells.first().focus();
      await blockCells.first().press("ArrowRight");
      assert.equal(await blockCells.nth(1).evaluate(el=>document.activeElement===el),true);
      await blockCells.nth(1).press("Enter");
      assert.equal(await blockCells.nth(1).getAttribute("aria-pressed"),"true");
      assert.match(await page.locator("#mapblock-selected").textContent(),/клетка \(1,0,0\)/);
      const last=blockCells.last();
      await last.click();
      assert.match(await page.locator("#mapblock-selected").textContent(),/клетка \(19,19,0\)/);
      assert.equal(await page.locator("#mapblock-parts button").count(),4);
      console.log("STUDIO_D4_U3_NATIVE_20X20_2D_LAYOUT_PASS");
      const beforeFloor1=await page.evaluate(()=>window.__studioU3PlacementCalls.length);
      await blockFloor.selectOption("1");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.startsWith("SOURCE_LAYOUT_2D") &&
        document.querySelector("#mapblock-floor").value==="1",null,{timeout:60000});
      assert.equal(await blockCells.count(),400);
      assert.equal(await page.locator("#mapblock-parts button").count(),4);
      const part1=await page.locator("#mapblock-parts button").first().getAttribute("data-source-part-ref");
      assert.notEqual(part1,part0);
      const pages=await page.evaluate(start=>window.__studioU3PlacementCalls.slice(start),beforeFloor1);
      assert.deepEqual(pages.filter(p=>p.map==="CULTA10"&&p.floor===1).map(p=>p.offset),
        Array.from({length:13},(_,i)=>128*i));
      assert.ok(pages.every(p=>p.map==="CULTA10"&&p.floor===1&&p.digest?.length===64));
      assert.match(await page.locator("#mapblock-status").textContent(),/1600/);
      console.log("STUDIO_D4_U3_NATIVE_1600_PARTS_13_PAGES_PASS");
      // Regression P2-D4-U3-01: select a genuine MAP part on the *last*
      // R02 page of Z=1. The U3→Source bridge must re-read that page with
      // native WASM, not reuse U3's candidate object as selectedPlacement.
      await blockCells.last().click();
      await page.locator("#mapblock-parts button").first().click();
      const u3TargetRef=await page.locator("#mapblock-parts button").first()
        .getAttribute("data-source-part-ref");
      assert.ok((await page.locator("#mapblock-selected").textContent()).includes("клетка (19,19,1)"));
      const beforeBridge=await page.evaluate(()=>window.__studioU3PlacementCalls.length);
      await page.locator("#mapblock-open-source").click();
      await page.waitForFunction(ref=>{
        const native=document.querySelector('#source-grid button[data-source-part-ref="'+ref+'"]');
        return document.body.dataset.workspace==="source" &&
          document.querySelector("#source-floor").value==="1" &&
          document.querySelector("#source-page-status").textContent.includes("1537") &&
          native?.getAttribute("aria-pressed")==="true";
      },u3TargetRef,{timeout:60000});
      assert.equal(await page.locator("#source-floor").inputValue(),"1");
      assert.match(await page.locator("#source-placement-status").textContent(),
        new RegExp(u3TargetRef.slice(0,20)));
      assert.equal(await page.locator("#run").isEnabled(),true);
      assert.deepEqual((await page.evaluate(n=>window.__studioU3PlacementCalls.slice(n),beforeBridge))
        .filter(p=>p.map==="CULTA10"&&p.floor===1).map(p=>p.offset),[1536]);
      assert.equal(await page.locator("#source-grid button[aria-pressed=true]").count(),1);
      await page.locator("#run").click();await waitState("COMPLETED");
      const bridgeR06=JSON.parse(await page.locator("#metrics").textContent());
      assert.equal(bridgeR06.sourcePartRef,u3TargetRef);
      assert.deepEqual(bridgeR06.tile,[19,19,1]);
      assert.equal(bridgeR06.part,"floor");
      await workspace("mapblock").click();
      assert.equal(await blockFloor.inputValue(),"1");
      assert.equal(await blockCells.count(),400);
      console.log("STUDIO_D4_U3_LAST_PAGE_SOURCE_R06_TRANSFER_PASS");
      await blockCells.first().click();
      const oldCell=await blockCells.first().evaluate(el=>{
        window.__studioU3DetachedCell=el;return el.dataset.x+","+el.dataset.y;
      });
      assert.equal(oldCell,"0,0");
      await page.evaluate(()=>{
        window.__studioGatePlacements=true;window.__studioPlacementsGated=false;
      });
      await blockFloor.selectOption("0");
      await page.waitForFunction(()=>window.__studioPlacementsGated,null,{timeout:60000});
      assert.equal(await blockCells.count(),0,"U3 retires prior floor synchronously");
      await page.evaluate(()=>{window.__studioGatePlacements=false;});
      await library.selectOption("CULTA11");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.startsWith("SOURCE_LAYOUT_2D")&&
        document.querySelector("#mapblock-status").textContent.includes("10×10×1"),
        null,{timeout:60000});
      await page.evaluate(()=>{
        window.__studioU3DetachedCell.click();
        try{window.__studioReleasePlacements?.()}catch{/* old worker terminated */}
      });
      assert.equal(await blockCells.count(),100);
      assert.match(await page.locator("#mapblock-status").textContent(),/200/);
      assert.equal(await blockFloor.locator("option").count(),1);
      assert.match(await page.locator("#mapblock-route").textContent(),/ROUTE_FILE_NOT_FOUND/);
      assert.equal(await page.locator("#mapblock-parts button").count(),2);
      console.log("STUDIO_D4_U3_NATIVE_10X10_STALE_WORKER_PASS");
      await library.selectOption("CULTA12");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.includes("UNSUPPORTED_U3_SCOPE"),null,{timeout:60000});
      assert.match(await page.locator("#mapblock-status").textContent(),/5×5×1/);
      assert.equal(await blockCells.count(),0);
      await library.selectOption("CULTA10");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.startsWith("SOURCE_LAYOUT_2D"),null,{timeout:60000});
      await page.setViewportSize({width:390,height:844});
      assert.deepEqual(await page.evaluate(()=>[
        document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
      assert.equal(await page.locator("#mapblock-grid-scroll").evaluate(el=>
        el.scrollWidth>el.clientWidth),true);
      await page.setViewportSize({width:1280,height:900});
      const originalU3=await page.locator("#mapblock-status").textContent();
      await page.locator("#mapblock-open-source").click();
      assert.equal(await workspace("source").getAttribute("aria-current"),"page");
      assert.equal(await mapMenu.inputValue(),"CULTA10");
      await workspace("object").click();
      await workspace("mapblock").click();
      assert.equal(await page.locator("#mapblock-status").textContent(),originalU3);
      assert.equal(await blockCells.count(),400);
      assert.equal((await page.evaluate(()=>Object.keys(window.__studioReads)))
        .some(x=>x.toUpperCase().includes("/ROUTES/")),false);
      console.log("STUDIO_D4_U3_RMP_PRIVACY_NAV_MOBILE_PASS");
      await workspace("source").click();
      // Case-fold collision is a diagnostic, not invented game route identity.
      await writeFile(join(rootDir,"ROUTES","culta10.rmp"),Buffer.from([4]));
      await page.locator("#directory").setInputFiles(rootDir);
      await mapMenu.locator('option[value="CULTA10"]').waitFor({state:"attached"});
      await workspace("mapblock").click();
      await library.selectOption("CULTA10");
      assert.match(await page.locator("#mapblock-route").textContent(),/ROUTE_FILE_AMBIGUOUS/);
      assert.equal((await page.evaluate(()=>window.__studioFileReadCalls))
        .some(name=>/\.rmp$/i.test(name)),false);
      console.log("STUDIO_D4_U3_RMP_DUPLICATE_PRESENCE_ONLY_PASS");
      // D4-U4/SCOPE-R2: distinct source-backed templates are verified by
      // the real R02/WASM Worker WITHOUT selecting global inspectedMap.
      await workspace("source").click();
      const beforeU4=await page.evaluate(()=>({
        source:document.querySelector("#catalog-map").value,
        metrics:document.querySelector("#metrics").textContent,
        object:document.querySelector("#object-draft-state").textContent
      }));
      await workspace("map").click();
      assert.equal(await page.locator("#battlescape-panel").isVisible(),true);
      assert.match(await page.locator("#battlescape-status").textContent(),/CATALOG_READY_NOT_VERIFIED/);
      const u4Template=page.locator("#battlescape-template");
      const u4Verify=page.locator("#battlescape-verify");
      const u4Count=page.locator("#battlescape-count");
      const u4Cells=page.locator("#battlescape-grid .battlescape-slot");
      const waitU4=()=>page.waitForFunction(()=>/NATIVE_DEFINITION_VERIFIED/.test(
        document.querySelector("#battlescape-status").textContent),null,{timeout:60000});
      const chooseU4=async id=>{
        await u4Template.selectOption(id);
        await u4Verify.click();
        await waitU4();
      };
      const u4Slot=async i=>u4Cells.nth(i).click();
      await chooseU4("CULTA10");
      assert.match(await page.locator("#battlescape-status").textContent(),/20×20×2/);
      await u4Slot(0);
      await page.locator("#battlescape-place").click();
      assert.match(await u4Count.textContent(),/1 экземпляров · 4\/25 слотов/);
      const u4Owner=await u4Cells.nth(0).getAttribute("aria-label");
      for(const i of [1,5,6]){
        assert.ok((await u4Cells.nth(i).getAttribute("aria-label")).includes("mbi-1"));
      }
      await page.locator("#battlescape-place").click();
      assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_OVERLAP/);
      assert.match(await u4Count.textContent(),/4\/25 слотов/);
      await u4Slot(24);
      await page.locator("#battlescape-place").click();
      assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_BOUNDS/);
      assert.match(await u4Count.textContent(),/1 экземпляров · 4\/25 слотов/);
      await chooseU4("CULTA11");
      assert.match(await page.locator("#battlescape-status").textContent(),/10×10×1/);
      for(let i=0;i<25;i++){
        if([0,1,5,6].includes(i))continue;
        await u4Slot(i);
        await page.locator("#battlescape-place").click();
      }
      assert.match(await u4Count.textContent(),/22 экземпляров · 25\/25 слотов/);
      assert.match(await u4Count.textContent(),/2 проверенных определений/);
      await chooseU4("CULTA10");
      await u4Slot(7); // interior 20x20 anchor; conflicts with three other instances
      const beforeConflict=await u4Cells.nth(7).getAttribute("aria-label");
      await page.locator("#battlescape-replace").click();
      assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_OVERLAP/);
      assert.equal(await u4Cells.nth(7).getAttribute("aria-label"),beforeConflict);
      assert.match(await u4Count.textContent(),/22 экземпляров · 25\/25 слотов/);
      await chooseU4("CULTA11");
      await u4Slot(5);
      assert.ok((await page.locator("#battlescape-selected").textContent()).includes("mbi-1"));
      assert.equal(await u4Cells.nth(5).getAttribute("aria-pressed"),"true");
      assert.ok((await u4Cells.nth(0).getAttribute("aria-label")).includes("mbi-1"));
      const afterU4=await page.evaluate(()=>({
        source:document.querySelector("#catalog-map").value,
        metrics:document.querySelector("#metrics").textContent,
        object:document.querySelector("#object-draft-state").textContent
      }));
      assert.deepEqual(afterU4,beforeU4,"U4 must not mutate native Source/U2/R06 owners");
      console.log("STUDIO_D4_U4_NATIVE_22_INSTANCES_25_SLOTS_PASS");

      // D4-U6/SCOPE-R2: author intent round-trip, honest local project format.
      // The ordinary active Source must be selected explicitly; project rebind
      // never promotes stored JSON to native verification on its own.
      await workspace("source").click();
      await mapMenu.selectOption("CULTA10");
      await page.waitForFunction(()=>document.querySelectorAll(
        "#source-grid button[data-source-part-ref]").length>0,null,{timeout:60000});
      await page.locator("#source-grid button[data-source-part-ref]").first().click();
      await page.locator("#run").click();await waitState("COMPLETED");
      await workspace("object").click();
      await page.locator("#object-reset").click();
      await page.locator("#object-name").fill("U6 source-bound hypothesis");
      await page.locator("#object-create").click();
      await page.locator("#object-add").click();
      assert.match(await page.locator("#object-draft-state").textContent(),/DRAFT/);
      await workspace("map").click();
      assert.match(await u4Count.textContent(),/22 экземпляров · 25\/25 слотов/);
      const u6Download=page.waitForEvent("download");
      await page.locator("#project-save").click();
      const u6File=await u6Download;
      assert.equal(u6File.suggestedFilename(),"fgm-studio-project.json");
      const u6Bytes=await readFile(await u6File.path(),"utf8");
      const u6JSON=JSON.parse(u6Bytes);
      assert.equal(u6JSON.schema,"fgmp-studio-project/1");
      assert.equal(u6JSON.objectDraft.hypotheses.length,1);
      assert.equal(u6JSON.objectDraft.hypotheses[0].members.length,1);
      assert.equal(u6JSON.battlescapeDraft.instances.length,22);
      assert.equal(u6JSON.battlescapeDraft.sourceDefinitions.length,2);
      for(const forbidden of ["indices_hex","palette_rgb8","lofts","wholeFrame",
        "WHOLE_FRAME_READY","filePath","webkitRelativePath"])
        assert.equal(u6Bytes.includes(forbidden),false,"no private source bytes/proof");
      console.log("STUDIO_D4_U6_EXPORT_LOCAL_BOUNDED_DRAFT_PASS");
      // A07 must preserve an ACTUAL native Whole R06 result, not only
      // an empty owner. Synthetic whole fixture still runs real C++20/WASM.
      await workspace("source").click();
      await page.locator("#whole-demo").click();
      await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled,
        null,{timeout:20000});
      await page.locator("#whole-run").click();
      await page.waitForFunction(()=>document.querySelector("#whole-status")
        .dataset.state==="COMPLETED",null,{timeout:60000});
      // GPU draw is asynchronous after native Whole completion; wait for the
      // final frame before comparing owner-stable states across a declined event.
      await page.waitForFunction(()=>window.__u5WholeEvents.at(-1)?.state===
        "WHOLE_FRAME_READY",null,{timeout:60000});
      assert.equal(await page.locator("#whole-downloads button").count(),5);


      // A07: DECLINE ordinary source mutations in capture phase. Both the
      // existing Source handlers and independent Whole target listeners must
      // remain untouched; this is not the project-only folder selector.
      const u6Before=await page.evaluate(()=>({
        map:document.querySelector("#catalog-map").value,
        metrics:document.querySelector("#metrics").textContent,
        u2:document.querySelector("#object-draft-state").textContent,
        u4:document.querySelector("#battlescape-count").textContent,
        whole:document.querySelector("#whole-status").textContent,
        wholeProof:document.querySelector("#whole-metrics").textContent,
        wholeButtons:document.querySelectorAll("#whole-downloads button").length,
        wholeEvidence:window.__u5WholeEvents.at(-1)?.state??null,
        sourceEvents:window.__u5SourceEvents.length,
        wholeEvents:window.__u5WholeEvents.length
      }));
      await workspace("source").click();
      await page.evaluate(()=>{window.__u6DialogDecision=false});
      await mapMenu.selectOption("CULTA11");
      await page.locator("#directory").setInputFiles(rootDir);
      const u6After=await page.evaluate(()=>({
        map:document.querySelector("#catalog-map").value,
        metrics:document.querySelector("#metrics").textContent,
        u2:document.querySelector("#object-draft-state").textContent,
        u4:document.querySelector("#battlescape-count").textContent,
        whole:document.querySelector("#whole-status").textContent,
        wholeProof:document.querySelector("#whole-metrics").textContent,
        wholeButtons:document.querySelectorAll("#whole-downloads button").length,
        wholeEvidence:window.__u5WholeEvents.at(-1)?.state??null,
        sourceEvents:window.__u5SourceEvents.length,
        wholeEvents:window.__u5WholeEvents.length
      }));
      assert.deepEqual(u6After,u6Before,
        "decline must block both Source and independent Whole before event dispatch");
      await page.evaluate(()=>{window.__u6DialogDecision=true});
      console.log("STUDIO_D4_U6_A07_CANCEL_BEFORE_OWNER_DISPATCH_PASS");

      const u6WorkDir=await mkdtemp(join(tmpdir(),"studio-u6-project-"));
      try{
        const u6ProjectPath=join(u6WorkDir,"studio-project.json");
        await writeFile(u6ProjectPath,u6Bytes);
        const u6Rejected=join(u6WorkDir,"forged-project.json");
        await writeFile(u6Rejected,JSON.stringify({...u6JSON,
          battlescapeDraft:{...u6JSON.battlescapeDraft,instances:[
            ...u6JSON.battlescapeDraft.instances,
            {...u6JSON.battlescapeDraft.instances[0]}
          ]}}));
        await page.locator("#project-file").setInputFiles(u6Rejected);
        await page.waitForFunction(()=>document.querySelector("#project-status")
          .textContent.startsWith("REJECTED"),null,{timeout:30000});
        assert.equal(await u4Count.textContent(),u6Before.u4);
        assert.equal(await page.locator("#metrics").textContent(),u6Before.metrics);
        console.log("STUDIO_D4_U6_CORRUPT_PROJECT_ZERO_MUTATION_PASS");

        // Verify independent native project root B while current source A and
        // its real R05/U2/U4 stay intact. Same MAP ID with altered bytes fails.
        const u6Other=join(u6WorkDir,"changed-ufo");
        await mkdir(u6Other);
        await writeStudioUfoCatalogFixture(u6Other);
        await writeFile(join(u6Other,"MAPS","CULTA10.MAP"),Buffer.from([10,10,1,...Array(400).fill(1)]));
        await page.locator("#project-file").setInputFiles(u6ProjectPath);
        await page.waitForFunction(()=>document.querySelector("#project-status")
          .textContent.startsWith("PARKED_UNBOUND"),null,{timeout:30000});
        await page.locator("#project-folder").setInputFiles(u6Other);
        await page.locator("#project-verify").click();
        await page.waitForFunction(()=>/PARKED_CONFLICT|PARKED_UNBOUND/.test(
          document.querySelector("#project-status").textContent),null,{timeout:60000});
        assert.equal(await page.locator("#project-apply").isDisabled(),true);
        assert.equal(await u4Count.textContent(),u6Before.u4);
        assert.equal(await page.locator("#metrics").textContent(),u6Before.metrics);
        console.log("STUDIO_D4_U6_DIFFERENT_ROOT_NATIVE_CONFLICT_PASS");
        await page.locator("#project-cancel").click();

        // Reload creates no project state or native proof. Explicitly open the
        // same real source, import, revalidate in separate native R02 and Apply.
        const projectPage=await network.context.newPage();
        projectPage.on("dialog",dialog=>dialog.accept());
        try{
          await projectPage.goto(url+"/");
          assert.match(await projectPage.locator("#project-status").textContent(),/NO_PROJECT/);
          await projectPage.locator("#directory").setInputFiles(rootDir);
          const importedMap=projectPage.locator("#catalog-map");
          await importedMap.locator('option[value="CULTA10"]').waitFor({state:"attached"});
          await importedMap.selectOption("CULTA10");
          await projectPage.waitForFunction(()=>document.querySelectorAll(
            "#source-grid button[data-source-part-ref]").length>0,null,{timeout:60000});
          await projectPage.locator("#project-file").setInputFiles(u6ProjectPath);
          await projectPage.waitForFunction(()=>document.querySelector("#project-status")
            .textContent.startsWith("PARKED_UNBOUND"),null,{timeout:30000});
          await projectPage.locator("#project-verify").click();
          await projectPage.waitForFunction(()=>document.querySelector("#project-status")
            .textContent.startsWith("APPLY_AVAILABLE"),null,{timeout:90000});
          await projectPage.locator("#project-apply").click();
          assert.match(await projectPage.locator("#project-status").textContent(),/ACTIVE_DRAFT/);
          assert.match(await projectPage.locator("#object-draft-state").textContent(),/DRAFT/);
          assert.match(await projectPage.locator("#battlescape-count").textContent(),
            /22 экземпляров · 25\/25 слотов/);
          assert.equal(await projectPage.locator("#object-members button").count(),1);
          assert.equal(await projectPage.locator("#downloads button").count(),0,
            "R05/R06 must not be fabricated on project rehydrate");
          assert.notEqual(await projectPage.locator("#whole-status").getAttribute("data-state"),
            "COMPLETED");
          console.log("STUDIO_D4_U6_RELOAD_REAL_NATIVE_R02_ATOMIC_APPLY_PASS");

          // A04: U4-only projects need only an active compatible catalog.
          const layoutOnly={...u6JSON,objectDraft:null};
          const u6U4=join(u6WorkDir,"map-only.json");
          await writeFile(u6U4,JSON.stringify(layoutOnly));
          await projectPage.reload();
          await projectPage.locator("#directory").setInputFiles(rootDir);
          await projectPage.locator("#catalog-map")
            .locator('option[value="CULTA10"]').waitFor({state:"attached"});
          await projectPage.locator("#project-file").setInputFiles(u6U4);
          await projectPage.waitForFunction(()=>document.querySelector("#project-status")
            .textContent.startsWith("PARKED_UNBOUND"),null,{timeout:30000});
          await projectPage.locator("#project-verify").click();
          await projectPage.waitForFunction(()=>document.querySelector("#project-status")
            .textContent.startsWith("APPLY_AVAILABLE"),null,{timeout:90000});
          await projectPage.locator("#project-apply").click();
          assert.match(await projectPage.locator("#battlescape-count").textContent(),
            /22 экземпляров · 25\/25 слотов/);
          console.log("STUDIO_D4_U6_U4_ONLY_NO_INSPECTED_MAP_PASS");
          await projectPage.setViewportSize({width:390,height:844});
          assert.deepEqual(await projectPage.evaluate(()=>[
            document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
        }finally{await projectPage.close()}
      }finally{await rm(u6WorkDir,{recursive:true,force:true})}

      await workspace("mapblock").click();
      await library.selectOption("CULTA11");
      await page.waitForFunction(()=>document.querySelector("#mapblock-status")
        .textContent.startsWith("SOURCE_LAYOUT_2D"),null,{timeout:60000});
      await workspace("map").click();
      assert.match(await u4Count.textContent(),/22 экземпляров · 25\/25 слотов/);
      await u4Slot(5);await page.locator("#battlescape-remove").click();
      assert.match(await u4Count.textContent(),/21 экземпляров · 21\/25 слотов/);
      assert.match(await page.locator("#battlescape-status").textContent(),/DRAFT_CHANGED/);
      await u4Template.selectOption("CULTA12");
      await u4Verify.click();
      await page.waitForFunction(()=>document.querySelector("#battlescape-status")
        .textContent.startsWith("ERROR"),null,{timeout:60000});
      assert.match(await u4Count.textContent(),/21 экземпляров · 21\/25 слотов/);
      console.log("STUDIO_D4_U4_SOURCE_OWNER_ISOLATION_NEGATIVES_PASS");

      // P2-U4-01: all 400 native placement bytes are zero in a correctly
      // dimensioned real MAP. Canonical R02 reports total=0: never VERIFIED.
      const beforeEmptyCount=await u4Count.textContent();
      const beforeEmptyOwner=await u4Cells.nth(7).getAttribute("aria-label");
      await u4Template.selectOption("CULTA13");
      await u4Verify.click();
      await page.waitForFunction(()=>document.querySelector("#battlescape-status")
        .textContent.includes("E_U4_EMPTY_MAP"),null,{timeout:60000});
      assert.equal(await u4Count.textContent(),beforeEmptyCount);
      assert.equal(await u4Cells.nth(7).getAttribute("aria-label"),beforeEmptyOwner);
      await u4Slot(7);
      await page.locator("#battlescape-replace").click();
      assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_UNVERIFIED/);
      assert.equal(await u4Count.textContent(),beforeEmptyCount);
      console.log("STUDIO_D4_U4_EMPTY_NATIVE_MAP_REJECTED_PASS");

      // P2-U4-02: hold the dispatch to the *real* WASM Worker's catalog-map
      // request, without faking a response; verify deadline, recovery, retry
      // and preservation of every preexisting instance/cache entry.
      await u4Template.selectOption("CULTA14");
      await page.evaluate(()=>{
        window.__studioGateCatalog=true;
        window.__studioReleaseCatalog=null;
      });
      await u4Verify.click();
      await page.waitForFunction(()=>Boolean(window.__studioReleaseCatalog),null,
        {timeout:60000});
      assert.equal(await u4Verify.isDisabled(),true);
      await page.locator("#battlescape-replace").click();
      assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_BUSY/);
      await page.waitForFunction(()=>document.querySelector("#battlescape-status")
        .textContent.includes("E_U4_TIMEOUT"),null,{timeout:30000});
      assert.equal(await u4Verify.isEnabled(),true);
      assert.equal(await u4Count.textContent(),beforeEmptyCount);
      assert.equal(await u4Cells.nth(7).getAttribute("aria-label"),beforeEmptyOwner);
      await page.evaluate(()=>{
        window.__studioGateCatalog=false;
        try{window.__studioReleaseCatalog?.()}catch{/* retired Worker */}
        window.__studioReleaseCatalog=null;
      });
      await u4Verify.click();
      await waitU4();
      assert.equal(await u4Count.textContent(),beforeEmptyCount);
      assert.equal(await u4Cells.nth(7).getAttribute("aria-label"),beforeEmptyOwner);
      console.log("STUDIO_D4_U4_TIMEOUT_RECOVERY_NATIVE_RETRY_PASS");

      // Cancel an independent native verification by changing the U4
      // template, then immediately verify a cached template. Old callbacks
      // must not disable or overwrite the new selection.
      await page.evaluate(()=>{
        window.__studioGateCatalog=true;
        window.__studioReleaseCatalog=null;
      });
      await u4Template.selectOption("CULTA14");
      await u4Verify.click();
      await page.waitForFunction(()=>Boolean(window.__studioReleaseCatalog),null,
        {timeout:60000});
      await u4Template.selectOption("CULTA11");
      assert.equal(await u4Verify.isEnabled(),true);
      await page.evaluate(()=>{
        window.__studioGateCatalog=false;
        try{window.__studioReleaseCatalog?.()}catch{/* retired Worker */}
        window.__studioReleaseCatalog=null;
      });
      await u4Verify.click();
      await waitU4();
      assert.equal(await u4Count.textContent(),beforeEmptyCount);
      assert.equal(await u4Cells.nth(7).getAttribute("aria-label"),beforeEmptyOwner);
      console.log("STUDIO_D4_U4_CANCEL_TEMPLATE_RETRY_PASS");

      // P3-U4-R2-01: 25 distinct pinned real-native definitions + 26th
      // verified temporarily, then atomic replacement with no prior eviction.
      const p3Root=await mkdtemp(join(tmpdir(),"studio-u4-cache-"));
      try{
        await writeStudioUfoCatalogFixture(p3Root);
        for(const ext of ["MCD","PCK","TAB"]){
          const bytes=await readFile(join(p3Root,"TERRAIN","CULTIVAT."+ext));
          await writeFile(join(p3Root,"TERRAIN","DESERT."+ext),bytes);
        }
        for(let i=0;i<=18;i++)
          await writeFile(join(p3Root,"MAPS","CULTA"+String(i).padStart(2,"0")+".MAP"),
            makeU3Map(10,10,1,2));
        for(let i=0;i<=7;i++)
          await writeFile(join(p3Root,"MAPS","DESERT"+String(i).padStart(2,"0")+".MAP"),
            makeU3Map(i===7?5:10,i===7?5:10,1,1));
        await page.locator("#directory").setInputFiles(p3Root);
        await u4Template.locator('option[value="DESERT07"]').waitFor({state:"attached"});
        await workspace("map").click();
        const names=[
          ...Array.from({length:19},(_,i)=>"CULTA"+String(i).padStart(2,"0")),
          ...Array.from({length:6},(_,i)=>"DESERT"+String(i).padStart(2,"0"))
        ];
        assert.equal(names.length,25);
        for(let i=0;i<names.length;i++){
          await chooseU4(names[i]);  // genuine R02 native WASM per template
          await u4Slot(i);
          await page.locator("#battlescape-place").click();
          assert.match(await page.locator("#battlescape-status").textContent(),/DRAFT_CHANGED/,
            "native placement "+names[i]);
        }
        assert.match(await u4Count.textContent(),/25 экземпляров · 25\/25 слотов/);
        assert.match(await u4Count.textContent(),/25 проверенных определений/);
        const oldOwner=await u4Cells.nth(0).getAttribute("aria-label");
        // Unsupported candidate fails without evicting a pinned definition.
        await u4Template.selectOption("DESERT07");
        await u4Verify.click();
        await page.waitForFunction(()=>document.querySelector("#battlescape-status")
          .textContent.startsWith("ERROR"),null,{timeout:60000});
        assert.match(await page.locator("#battlescape-status").textContent(),/E_U4_UNSUPPORTED_DIMENSIONS/);
        assert.match(await u4Count.textContent(),/25 проверенных определений/);
        assert.equal(await u4Cells.nth(0).getAttribute("aria-label"),oldOwner);
        await chooseU4("DESERT06"); // 26th distinct native definition
        assert.match(await u4Count.textContent(),/25 проверенных определений/);
        assert.equal(await u4Cells.nth(0).getAttribute("aria-label"),oldOwner);
        await u4Slot(0);
        await page.locator("#battlescape-replace").click();
        assert.match(await page.locator("#battlescape-status").textContent(),/DRAFT_CHANGED/);
        assert.match(await u4Count.textContent(),/25 экземпляров · 25\/25 слотов/);
        assert.match(await u4Count.textContent(),/25 проверенных определений/);
        const updatedOwner=await u4Cells.nth(0).getAttribute("aria-label");
        assert.ok(updatedOwner.includes("DESERT06"));
        assert.ok(updatedOwner.includes("mbi-1"),"atomic replacement preserves stable instance ID");
        console.log("STUDIO_D4_U4_P3_CACHE_FULL_ATOMIC_REPLACE_PASS");

        // New source with the same mapId cannot revive an old pending result.
        await u4Template.selectOption("CULTA00"); // evicted above
        await page.evaluate(()=>{window.__studioGateCatalog=true;window.__studioReleaseCatalog=null;});
        await u4Verify.click();
        await page.waitForFunction(()=>Boolean(window.__studioReleaseCatalog),null,{timeout:60000});
        await page.locator("#directory").setInputFiles(rootDir);
        await u4Template.locator('option[value="CULTA11"]').waitFor({state:"attached"});
        await page.evaluate(()=>{
          window.__studioGateCatalog=false;
          try{window.__studioReleaseCatalog?.()}catch{/* canceled worker */}
        });
        assert.match(await u4Count.textContent(),/0 экземпляров · 0\/25 слотов/);
        assert.match(await page.locator("#battlescape-status").textContent(),/CATALOG_READY_NOT_VERIFIED/);
        console.log("STUDIO_D4_U4_STALE_ROOT_NATIVE_REPLY_REJECTED_PASS");
      }finally{await rm(p3Root,{recursive:true,force:true})}

      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.locator("#battlescape-grid").isVisible(),true);
      assert.deepEqual(await page.evaluate(()=>[
        document.documentElement.scrollWidth,document.documentElement.clientWidth]),[390,390]);
      await page.setViewportSize({width:1280,height:900});
      await workspace("source").click();


      for(const [fault,code] of [
        ["tab","E_R04_TAB_OFFSET"],["pck","E_R04_FRAME_TERMINATOR"],
        ["palette","E_R04_PALETTE_RGB6"]
      ]){
        const badRoot=await mkdtemp(join(tmpdir(),"studio-ufo-thumbs-"));
        try{
          await writeStudioUfoCatalogFixture(badRoot,fault);
          await page.locator("#directory").setInputFiles(badRoot);
          await mapMenu.locator("option[value=CULTA00]").waitFor({state:"attached"});
          await mapMenu.selectOption("CULTA00");
          await page.waitForFunction(()=>!document.querySelector("#catalog-element").disabled);
          await elementMenu.click();
          await page.waitForFunction(expected=>
            [...document.querySelectorAll(".catalog-error")].some(x=>x.textContent===expected),
            code,{timeout:30000});
          assert.ok(await page.locator(".catalog-error").filter({hasText:code}).count()>0);
          await elementMenu.press("Escape");
        }finally{await rm(badRoot,{recursive:true,force:true})}
      }
      console.log("STUDIO_R04_THUMB_CORRUPT_ASSETS_PASS");

      // Large-list UX is a separate synthetic DOM stress test. Actual pixel
      // provenance was already proved above with real C++/WASM on local files.
      const stress=await page.evaluate(async()=>{
        const {ElementSpritePicker}=await import("./ufo-catalog.mjs");
        const host=document.createElement("div");
        host.id="sprite-picker-stress";
        host.className="catalog-picker";
        host.innerHTML='<button type="button" id="stress-combo"><canvas width="32" height="40" hidden></canvas><span id="catalog-element-text"></span></button>'+
          '<div class="catalog-list" id="stress-list" role="listbox" aria-label="600 test entries" hidden></div>';
        document.body.append(host);
        const button=host.querySelector("#stress-combo");
        const listbox=host.querySelector("#stress-list");
        let maximumRequestedBatch=0,requests=0;
        const picker=new ElementSpritePicker({button,listbox,onChoose:()=>{},
          decode:async (dataset,records)=>{
            if(dataset!=="STRESS")throw Error("E_STUDIO_THUMB_BINDING");
            maximumRequestedBatch=Math.max(maximumRequestedBatch,records.length);
            requests++;
            return {schema:"fgmr-ufo-catalog-thumbnails/1",dataset,frameSlot:0,
              palette_rgb8:Array.from({length:256},()=>[0,0,0]),
              items:records.map(record=>({record,frameId:0,indices_hex:"00".repeat(1280)}))};
          }});
        const entries=Array.from({length:600},(_,i)=>[
          "stress:"+i,{name:"Объект",dataset:"STRESS",record:i,part:"object",
                        rightHalf:false,tile:[0,0,0]}]);
        picker.load(entries);
        picker.open();
        const initial=listbox.querySelectorAll('[role="option"]').length;
        listbox.scrollTop=500*64;
        picker.render();
        const afterScroll=[...listbox.querySelectorAll('[role="option"]')]
          .map(el=>Number(el.dataset.index));
        const cacheLimitProbe=Array.from({length:80},(_,i)=>i);
        for(const i of cacheLimitProbe)picker.remember("stress-cache-"+i,{error:"E_R04_FRAME_INDEX"});
        const bound=picker.cache.size;
        // Check Home/End without creating all 600 option nodes.
        button.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true,cancelable:true}));
        const active=picker.active;
        const afterEnd=listbox.querySelectorAll('[role="option"]').length;
        button.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
        const closed=listbox.hidden;
        picker.reset();host.remove();
        return {initial,afterScroll,bound,active,afterEnd,closed,maximumRequestedBatch,requests};
      });
      assert.ok(stress.initial>0 && stress.initial<=16);
      assert.ok(stress.afterScroll.length>0 && stress.afterScroll.length<=16);
      assert.ok(stress.afterScroll.some(index=>index>=498&&index<=502));
      assert.equal(stress.bound,48);
      assert.equal(stress.active,599);
      assert.ok(stress.afterEnd>0&&stress.afterEnd<=16);
      assert.equal(stress.closed,true);
      assert.ok(stress.maximumRequestedBatch<=8);
      console.log("STUDIO_R04_THUMB_VIRTUALIZED_600_PASS",JSON.stringify(stress));
    } finally {
      await rm(rootDir,{recursive:true,force:true});
    }
  }

  assert.deepEqual(browserErrors,[]);
  assert.deepEqual(unexpected,[]);
  assert.ok(requests.length>0);
  assert.ok(requests.every(x=>x.method==="GET"&&x.url.startsWith(url+"/")));
  assert.deepEqual([...new Set(requests.map(x=>new URL(x.url).pathname))].sort(),
    [...new Set(requests.map(x=>new URL(x.url).pathname))].filter(x=>allowed.has(x)).sort());
  console.log("STUDIO_S2B_BROWSER_PASS: real WASM R06/R05, local File API, negative cases, no external requests");
}finally{await browser.close();server.close()}

network.assertLocal();
