import {localBrowserContext} from './local-browser.mjs';
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  "/studio-manifest.json","/ufo-catalog.mjs","/whole-ui.mjs","/renderer-session.mjs","/favicon.ico"]);
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
    globalThis.__studioGateStep=false;
    globalThis.__studioStepGated=false;
    globalThis.__studioReleaseStep=null;
    globalThis.__studioGateCatalog=false;
    globalThis.__studioReleaseCatalog=null;
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
    globalThis.Worker=class InstrumentedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        this._wrappedListeners=new WeakMap();
      }
      postMessage(data,...args) {
        const request=typeof data==="string"?JSON.parse(data):null;
        if(globalThis.__studioGateCatalog && request?.action==="catalog-map") {
          globalThis.__studioReleaseCatalog=()=>super.postMessage(data,...args);
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
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>["COMPLETED","ERROR"].includes(document.querySelector("#whole-status").dataset.state),null,{timeout:60000});
  assert.match(await page.locator("#whole-status").textContent(),/^COMPLETED/);
  const whole=JSON.parse(await page.locator("#whole-metrics").textContent());
  assert.equal(whole.cells,4);
  assert.equal(whole.occupied,8);
  assert.equal(whole.checked_centers,24576);
  assert.equal(whole.reran_b1,false);
  assert.equal(whole.rederived_r03,false);
  assert.equal(await page.locator("#whole-downloads button").count(),5);
  assert.equal(await page.locator("#whole-preview").isVisible(),true);
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
  await page.locator("#whole-run").click();
  await page.waitForFunction(()=>document.querySelector("#whole-status").dataset.state==="ERROR",null,{timeout:10000});
  assert.match(await page.locator("#whole-status").textContent(),/E_WHOLE_DIGEST/);
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
      const door=elementMenu.getByRole("option",{name:/Дверь/});
      await door.waitFor({state:"attached"});
      const key=await door.getAttribute("value");
      await elementMenu.selectOption(key);
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
      await door.waitFor({state:"attached"});
      assert.equal(await door.getAttribute("value"),key);
      console.log("STUDIO_UFO_CATALOG_BROWSER_PASS");
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
