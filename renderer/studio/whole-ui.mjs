// R06 whole-object UI: transport/view only. The canonical builder is pinned C++20/WASM.
import {sha256} from "./r05-view.mjs";
import {createRendererSessionV1} from "./renderer-session.mjs";
const $=id=>document.getElementById(id);
const CORE="ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const NAMES=["model.fgm.json","slices.json","preview.obj","report.json","input-proof.json"];
const SHA=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
let inputs=null,worker=null,controller=null,epoch=0,output=null,session=null;
let sceneRevision=null,sessionCanvas=null;
let yaw=-0.8,pitch=0.6,zoom=1,drag=null;
const canvas=$("whole-preview"),ctx=canvas.getContext("2d");
function status(state,message){
  $("whole-status").dataset.state=state;
  $("whole-status").textContent=state+" · "+message;
}
function enable(){
  $("whole-run").disabled=!inputs||!!worker;
  $("whole-cancel").disabled=!worker;
}
function showWhole(show){
  canvas.hidden=!show;
  $("preview").hidden=show;
}
function reset(){
  ++epoch;
  if(controller)controller.abort();
  if(worker)worker.terminate();
  worker=null;controller=null;output=null;
  if(session)void session.dispose();
  session=null;sceneRevision=null;sessionCanvas=null;
  $("whole-views").replaceChildren();
  $("whole-view-downloads").replaceChildren();
  $("whole-view-receipt").textContent="";
  $("whole-view-status").textContent="Четыре глобальных вида ещё не построены";
  ctx.clearRect(0,0,canvas.width,canvas.height);
  $("whole-downloads").replaceChildren();
  $("whole-cell").replaceChildren(new Option("Весь объект","all"));
  $("whole-cell").disabled=true;$("whole-z").disabled=true;
  $("whole-metrics").textContent="Нет результата целого объекта";
  $("whole-slice").textContent="Срезы ещё не построены";
  showWhole(false);
  enable();
}
function orderedNames(files){
  if(!(files instanceof Map)||!files.has("receipt.json")||files.size<3||files.size>9)
    throw Error("E_WHOLE_FILES");
  const lofts=[...files.keys()].filter(x=>/^loft-[0-7]\.json$/.test(x))
    .sort((a,b)=>Number(a.slice(5,-5))-Number(b.slice(5,-5)));
  if(lofts.length!==files.size-1||lofts.length<2||lofts.length>8||
     lofts.some((x,i)=>x!=="loft-"+i+".json"))
    throw Error("E_WHOLE_FILES");
  return ["receipt.json",...lofts];
}
// Validate File metadata BEFORE calling arrayBuffer() on any selected entry.
// Reject excessive file count immediately to avoid even materializing large selections.
function preflightLocalFiles(selection){
  if(!selection || selection.length<3 || selection.length>9)throw Error("E_WHOLE_FILES");
  const chosen=new Map();
  let total=0;
  for(let i=0;i<selection.length;i++){
    const file=selection[i],name=file.name;
    if(chosen.has(name))throw Error("E_WHOLE_DUPLICATE");
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>65536)
      throw Error("E_WHOLE_LIMIT");
    total+=file.size;
    if(total>262144)throw Error("E_WHOLE_LIMIT");
    chosen.set(name,file);
  }
  // Names and contiguous LOFT indices are validated before the first read.
  return orderedNames(chosen).map(name=>[name,chosen.get(name)]);
}
function ordered(files){
  const names=orderedNames(files);
  let total=0;
  for(const name of names){
    const bytes=files.get(name);
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>65536)
      throw Error("E_WHOLE_LIMIT");
    total+=bytes.length;
  }
  if(total>262144)throw Error("E_WHOLE_LIMIT");
  return names;
}
async function digest(bytes){
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function computed(files){
  const names=ordered(files);
  const sums=await Promise.all(names.map(name=>digest(files.get(name))));
  return {receipt:sums[0],lofts:sums.slice(1)};
}
function synthetic(){
  const voxels=[];
  for(let x=14;x<=16;x++)for(let y=14;y<=16;y++)
    if(x!==15||y!==15)voxels.push([x,y,3]);
  const cells=new Map();
  for(const [x,y,z] of voxels){
    const tile=[Math.floor(x/16),Math.floor(y/16),0],key=tile.join(",");
    if(!cells.has(key))cells.set(key,{tile,voxels:[]});
    cells.get(key).voxels.push([x%16,y%16,z]);
  }
  const files=new Map(),bindings=[];
  const parts=["floor","west_wall","north_wall","object"];
  let i=0;
  for(const {tile,voxels:occupied} of [...cells.values()].sort((a,b)=>
    a.tile[0]-b.tile[0]||a.tile[1]-b.tile[1])){
    const rows=parts.map(()=>Array.from({length:24},()=>Array(16).fill(0)));
    for(const [x,y,z] of occupied)rows[3][z][y]|=1<<(15-x);
    const sources=parts.map(part=>part==="object"
      ? {part,source_index:2,present:true,dataset_label:"SYNTH",local_index:1,loft_ids:Array(12).fill(0)}
      : {part,source_index:0,present:false});
    const loft={schema:"fgm-regenerator/loft-terrain-v1",
      voxel_dimensions_xyz:[16,16,24],terrain_only:true,
      tile:{xyz:tile,record_index:i},sources,part_rows:rows};
    files.set("loft-"+i+".json",encoder.encode(JSON.stringify(loft)));
    bindings.push({xyz:tile,local_xyz:tile,part:"object",dataset:"SYNTH",record:1,map_record:i});
    i++;
  }
  const receipt={schema:"fgm-regenerator/verified-membership-input-v1",
    status:"verified_explicit_membership",instance:"synthetic_ring",prototype:"synthetic",
    provenance:{kind:"synthetic-test"},anchor_xyz:[0,0,0],cell_bindings:bindings};
  files.set("receipt.json",encoder.encode(JSON.stringify(receipt)));
  return files;
}
$("whole-demo").addEventListener("click",async()=>{
  reset();inputs=null;enable();
  const current=epoch;
  try{
    const candidate=synthetic(), expected=await computed(candidate);
    if(epoch!==current)return;
    inputs=candidate;
    $("whole-expected").value=JSON.stringify(expected);
    status("READY","Синтетический 2×2, 4 клетки, одна FGM-модель");enable();
  }catch(e){if(epoch===current)status("ERROR",e.message)}
});
$("whole-files").addEventListener("change",async event=>{
  reset();inputs=null;$("whole-expected").value="";enable();
  const current=epoch;
  try{
    const selectedFiles=preflightLocalFiles(event.target.files);
    const files=new Map();
    for(const [name,file] of selectedFiles){
      const data=new Uint8Array(await file.arrayBuffer());
      if(current!==epoch)return;
      // Keep the second, byte-level check even when File.size was valid.
      if(!data.length||data.length>65536||data.length!==file.size)
        throw Error("E_WHOLE_LIMIT");
      files.set(name,data);
    }
    ordered(files);inputs=files;enable();
    status("READY","Локальные входы выбраны; укажите независимо записанные SHA-256");
  }catch(e){if(current===epoch)status("ERROR",e.message)}
  event.target.value="";
});
for(const id of ["whole-expected","whole-material"]){
  $(id).addEventListener("input",()=>{
    reset();status("READY","Входные параметры изменены; прежний результат сброшен");
  });
}
function manifest(){
  const names=ordered(inputs);
  let expected;
  try{expected=JSON.parse($("whole-expected").value)}
  catch{throw Error("E_WHOLE_DIGEST")}
  if(!expected||typeof expected!=="object"||
     Object.keys(expected).sort().join(",")!=="lofts,receipt"||
     !SHA.test(expected.receipt)||!Array.isArray(expected.lofts)||
     expected.lofts.length!==names.length-1||expected.lofts.some(x=>!SHA.test(x)))
    throw Error("E_WHOLE_DIGEST");
  return {names,expected};
}
function send(request,runEpoch){
  return new Promise((resolve,reject)=>{
    if(!worker||!controller||controller.signal.aborted||epoch!==runEpoch){
      reject(Error("E_WHOLE_CANCELLED"));return;
    }
    const currentWorker=worker,signal=controller.signal;
    const cleanup=()=>{
      currentWorker.removeEventListener("message",onMessage);
      currentWorker.removeEventListener("error",onError);
      signal.removeEventListener("abort",onAbort);
    };
    const onMessage=event=>{
      cleanup();
      try{
        if(epoch!==runEpoch||typeof event.data!=="string")throw Error("E_WHOLE_CANCELLED");
        const data=JSON.parse(event.data);
        if(data.error)throw Error(data.error);
        resolve(data);
      }catch(error){reject(error)}
    };
    const onError=()=>{cleanup();reject(Error("E_WHOLE_WORKER"))};
    const onAbort=()=>{cleanup();reject(Error("E_WHOLE_CANCELLED"))};
    currentWorker.addEventListener("message",onMessage,{once:true});
    currentWorker.addEventListener("error",onError,{once:true});
    signal.addEventListener("abort",onAbort,{once:true});
    currentWorker.postMessage(JSON.stringify({v:1,...request}));
  });
}
const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
async function stage(files,runEpoch){
  const names=ordered(files);
  for(const [i,name] of names.entries()){
    const data=files.get(name),id=i===0?"receipt":"loft"+(i-1);
    for(let offset=0;offset<data.length;offset+=16384){
      await send({action:"append",file:id,offset,hex:hex(data.subarray(offset,offset+16384))},runEpoch);
    }
  }
}
async function artifacts(runId,descriptors,runEpoch){
  if(!Array.isArray(descriptors)||descriptors.length!==5 ||
     descriptors.some((d,i)=>d.name!==NAMES[i]||!Number.isInteger(d.size)||
       d.size<1||!SHA.test(d.sha256))||
     descriptors.reduce((sum,d)=>sum+d.size,0)>1048576)throw Error("E_WHOLE_ARTIFACTS");
  const files={};
  for(const item of descriptors){
    let offset=0,content="";
    while(offset<item.size){
      const reply=await send({action:"read-build",runId,artifact:item.name,offset},runEpoch);
      const chunk=reply.chunk;
      if(!chunk||chunk.artifact!==item.name||chunk.offset!==offset||
         typeof chunk.bytes!=="string"||!chunk.bytes.length||
         chunk.bytes.length>32768||/[^\x00-\x7f]/.test(chunk.bytes)||
         chunk.bytes.length>item.size-offset||
         chunk.eof!==(offset+chunk.bytes.length===item.size))
        throw Error("E_WHOLE_ARTIFACTS");
      offset+=chunk.bytes.length;content+=chunk.bytes;
    }
    if(await sha256(content)!==item.sha256)throw Error("E_WHOLE_DIGEST");
    files[item.name]=content;
  }
  return files;
}
function validate(files,n,expectedReceipt){
  let model,slices,report,proof;
  try{
    model=JSON.parse(files["model.fgm.json"]);
    slices=JSON.parse(files["slices.json"]);
    report=JSON.parse(files["report.json"]);
    proof=JSON.parse(files["input-proof.json"]);
  }catch{throw Error("E_WHOLE_RESULT")}
  if(model.format!=="fgm-package/1"||
     slices.schema!=="fgm-regenerator/slice-by-cell-v1"||
     report.schema!=="fgm-regenerator/whole-object-report-v1"||
     proof.schema!=="fgm-regenerator/whole-build-proof-v1"||
     !Array.isArray(slices.cells)||slices.cells.length!==n||
     report.checked_centers!==n*6144||
     proof.reran_b1!==false||proof.rederived_r03!==false||
     proof.verification_scope!=="transport_integrity_binding_c05"||
     proof.receipt_sha256!==expectedReceipt)
    throw Error("E_WHOLE_PROOF");
  for(const cell of slices.cells){
    if(!Array.isArray(cell.local_xyz)||cell.local_xyz.length!==3||
       cell.local_xyz.some(x=>!Number.isInteger(x))||
       !Array.isArray(cell.xyz)||cell.xyz.length!==3||
       !Array.isArray(cell.rows)||cell.rows.length!==24||
       cell.rows.some(layer=>!Array.isArray(layer)||layer.length!==16||
         layer.some(x=>!Number.isInteger(x)||x<0||x>65535)))
      throw Error("E_WHOLE_SLICES");
  }
  return {model,slices,report,proof};
}
// Existing RendererSession owns projection, depth, resource limits and stale-frame rules.
// This adapter never interprets FGM or decodes LOFT and has no geometry math.
function view(revision,yawValue,pitchValue,distance,width=420,height=315){
  return {schema:"fgmv-view-state/1",revision,
    camera:{kind:"orbit-3d",yaw:yawValue,pitch:pitchValue,distance,focusWorld:{x:0,y:0,z:0}},
    viewport:{width,height,pixelRatio:1},showCellGrid:false};
}
async function frame(activeSession,scene,viewState,runEpoch){
  if(runEpoch!==epoch)throw Error("E_WHOLE_CANCELLED");
  const v=activeSession.setView(viewState);
  const result=await activeSession.renderFrame({expectedSceneRevision:scene,
    expectedViewRevision:v.viewRevision,sessionEpoch:v.sessionEpoch});
  if(runEpoch!==epoch)throw Error("E_WHOLE_CANCELLED");
  if(result.status!=="rendered")throw Error("E_WHOLE_VIEW_FRAME");
  if(activeSession!==session||!sessionCanvas)throw Error("E_WHOLE_CANCELLED");
  canvas.width=sessionCanvas.width;canvas.height=sessionCanvas.height;
  ctx.drawImage(sessionCanvas,0,0);
}
async function makeViews(checked,files,modelHash,previewHash,runEpoch){
  // Pending or disposed sessions never own the visible canvas of another run.
  const target=document.createElement("canvas");
  const active=await createRendererSessionV1({canvas:target,preferredBackend:"webgpu",fallbackPolicy:"allow-diagnostic"});
  if(runEpoch!==epoch){await active.dispose();throw Error("E_WHOLE_CANCELLED")}
  session=active;sessionCanvas=target;
  const packageBytes=encoder.encode(files["model.fgm.json"]),meshBytes=encoder.encode(files["preview.obj"]);
  const identity="whole-"+modelHash;
  const loaded=await active.loadScene({snapshot:{schema:"fgmv-scene-snapshot/1",revision:identity,
    models:[{key:"whole",package:{format:"fgm-package/1",packageSha256:modelHash,byteLength:packageBytes.length}}],
    instances:[{instanceId:identity,modelKey:"whole",stateRevision:"static",
      placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:0,units:"fgm-voxel"}}]},
    packages:[{modelKey:"whole",bytes:packageBytes}],geometries:[{geometry:{
      schema:"fgmv-derived-geometry/1",sourcePackageSha256:modelHash,meshSha256:previewHash,meshFormat:"obj/1",
      cellBindings:checked.slices.cells.map(c=>({x:c.local_xyz[0],y:c.local_xyz[1],z:c.local_xyz[2]})),
      recipe:{schema:"fgmv-geometry-recipe/1",algorithmId:"r06-whole-build",algorithmVersion:"1",
        parametersSha256:checked.proof.receipt_sha256,deterministicSeed:checked.model.model.seed,detailDepth:0}},bytes:meshBytes}]});
  if(runEpoch!==epoch)throw Error("E_WHOLE_CANCELLED");
  sceneRevision=loaded.sceneRevision;
  // Diagnostic fallback is explicitly NOT a novel-view depth proof.
  if(active.capabilities.backendKind!=="webgpu")return null;
  const views=[],cards=[];
  for(let i=0;i<4;i++){
    const state=view("novel-"+i,0.35+i*Math.PI/2,0.6,1);
    await frame(active,sceneRevision,state,runEpoch);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    const image=document.createElement("canvas");image.width=canvas.width;image.height=canvas.height;
    image.getContext("2d").putImageData(new ImageData(pixels.slice(),image.width,image.height),0,0);
    const frameSha=await digest(pixels);
    if(runEpoch!==epoch)throw Error("E_WHOLE_CANCELLED");
    views.push({id:"novel-"+i,model_sha256:modelHash,mesh_sha256:previewHash,view:state,rgba_sha256:frameSha});
    const figure=document.createElement("figure"),caption=document.createElement("figcaption");
    image.dataset.view=String(i);image.setAttribute("aria-label","Новый глобальный вид "+(i+1));
    caption.textContent="Вид "+(i+1)+" · yaw "+state.camera.yaw.toFixed(3)+" · INFERRED";
    figure.append(image,caption);cards.push(figure);
  }
  const receipt={schema:"fgmv-whole-novel-views/1",model_sha256:modelHash,mesh_sha256:previewHash,
    membership:{schema:"fgm-regenerator/verified-membership-input-v1",sha256:checked.proof.receipt_sha256,
      instance:checked.report.instance,prototype:checked.report.prototype,status:"CONDITIONAL_ON_B1_WITNESS",
      cells:checked.slices.cells.map(({xyz,local_xyz,part})=>({xyz,local_xyz,part}))},
    c05:{checked_centers:checked.report.checked_centers,scope:"voxel_centers_only",match:true},
    evidence:{OBSERVED:"source_bound_voxel_occupancy_conditional_on_inputs",
      INFERRED:"global_voxel_boundary_surface_not_original_visual_observation",
      UNKNOWN:"hidden_surface_shape_and_appearance",UNRESOLVED:"independent_object_membership"},
    stage_a:"NOT_ACCEPTED",private_acceptance:"PENDING",backend:"webgpu",
    camera_contract:"renderer-session-orbit-3d-autofit/1",coordinate_units:"fgm-voxel",
    raster_scope:"local_GPU_pixels_not_cross_device_identity",views};
  return {receipt,cards};
}
function draw(){
  if(!output||!session||!sceneRevision)return;
  const active=session,runEpoch=epoch;
  const index=$("whole-cell").value;
  const state=view("interactive-"+String(++draw.counter),yaw,pitch,1/zoom,840,630);
  state.showCellGrid=true;
  if(index!=="all"){
    const cell=output.slices.cells[Number(index)];
    state.selectedCell={x:cell.local_xyz[0],y:cell.local_xyz[1],z:cell.local_xyz[2]};
  }
  void frame(active,sceneRevision,state,runEpoch).catch(e=>{
    if(epoch===runEpoch&&session===active&&e.message!=="E_WHOLE_VIEW_FRAME")
      $("whole-view-status").textContent="Кадр недоступен";
  });
}
draw.counter=0;
function download(name,payload,type="application/json"){
  const button=document.createElement("button");button.textContent=name;
  const runEpoch=epoch;
  button.addEventListener("click",()=>{
    if(runEpoch!==epoch||!output)return;
    const url=URL.createObjectURL(new Blob([payload],{type})),link=document.createElement("a");
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),500);
  });
  return button;
}
function slice(){
  if(!output)return;
  const index=$("whole-cell").value;
  if(index==="all"){$("whole-slice").textContent="Общая FGM-модель; выберите клетку для просмотра LOFT-среза.";draw();return}
  const cell=output.slices.cells[Number(index)],z=Number($("whole-z").value);
  if(!cell||!Number.isInteger(z)||z<0||z>23){$("whole-slice").textContent="Недопустимый срез";draw();return}
  const lines=cell.rows[z].map(bits=>Array.from({length:16},(_,x)=>bits&(1<<(15-x))?"#":".").join(""));
  $("whole-slice").textContent="Клетка "+cell.xyz.join(",")+" · local "+
    cell.local_xyz.join(",")+" · Z="+z+" · занято "+cell.occupied+"\n"+lines.join("\n");
  draw();
}
$("whole-cell").addEventListener("change",slice);
$("whole-z").addEventListener("input",slice);
$("whole-cancel").addEventListener("click",()=>{
  reset();status("CANCELLED","Worker завершён; неполные артефакты отброшены");
});
for(const id of ["run","demo","local-files","directory","catalog-map","catalog-element"]){
  $(id).addEventListener(id==="run"||id==="demo"?"click":"change",()=>{
    if(worker||output){reset();status("READY","Режим целого объекта закрыт")}
  });
}
for(const id of ["map","loft","pck","tab","palette","dataset-lines","sprite-dataset",
  "tile-x","tile-y","tile-z","part","slot","tab-bits","palette-index","material"]){
  $(id).addEventListener("input",()=>{
    if(worker||output){reset();status("READY","Изменены параметры одноклеточного режима")}
  });
}
canvas.addEventListener("pointerdown",e=>{if(!output)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener("pointermove",e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.012;
  pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag.y)*.01));drag={x:e.clientX,y:e.clientY};draw()});
canvas.addEventListener("pointerup",()=>drag=null);
canvas.addEventListener("pointercancel",()=>drag=null);
canvas.addEventListener("wheel",e=>{
  if(!output)return;e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*(e.deltaY>0?.91:1.1)));draw();
},{passive:false});
$("whole-run").addEventListener("click",async()=>{
  if(worker||!inputs)return;
  reset();
  status("VALIDATING","Проверка SHA-256; прежние виды и результат сброшены");
  // Terminate a pending single-cell run before switching to the whole-object viewer.
  if(!$("cancel").disabled)$("cancel").click();
  const runEpoch=epoch;
  let currentWorker=null;
  try{
    const {names,expected}=manifest();
    const material=$("whole-material").value.trim();
    if(!/^[a-z][a-z0-9_]{0,47}$/.test(material))throw Error("E_WHOLE_MATERIAL");
    const observed=await computed(inputs);
    if(epoch!==runEpoch)return;
    if(expected.receipt!==observed.receipt ||
       expected.lofts.some((x,i)=>x!==observed.lofts[i]))throw Error("E_WHOLE_DIGEST");
    worker=new Worker("./engine/worker.mjs",{type:"module"});
    currentWorker=worker;controller=new AbortController();enable();
    await send({action:"clear"},runEpoch);
    await stage(inputs,runEpoch);
    const lofts=names.slice(1).map((_,i)=>({file:"loft"+i,sha256:expected.lofts[i]}));
    const spec={algorithm:"r06-whole-build/1",coreRevision:CORE,budget:6144*lofts.length,
      sourceBindings:{receipt:{file:"receipt",sha256:expected.receipt},lofts},
      parameters:{material}};
    const started=await send({action:"start",spec},runEpoch);
    if(started.state!=="RUNNING")throw Error("E_WHOLE_STATE");
    status("RUNNING","C++20 BuildWholeObject, атомарный step; отмена завершает Worker");
    const stepped=await send({action:"step",runId:started.runId},runEpoch);
    if(stepped.state!=="COMPLETED")throw Error("E_WHOLE_STATE");
    const finalized=await send({action:"finalize",runId:started.runId},runEpoch);
    if(finalized.state!=="COMPLETED")throw Error("E_WHOLE_STATE");
    const files=await artifacts(started.runId,finalized.result?.build?.artifacts,runEpoch);
    const checked=validate(files,lofts.length,expected.receipt);
    const [modelHash,previewHash,slicesHash]=await Promise.all(
      ["model.fgm.json","preview.obj","slices.json"].map(name=>sha256(files[name])));
    if(checked.report.model_sha256!==modelHash||
       checked.report.preview_sha256!==previewHash||
       checked.report.slices_sha256!==slicesHash||
       checked.proof.package_sha256!==modelHash)throw Error("E_WHOLE_PROOF");
    let novel=null,viewError="WebGPU недоступен";
    try{novel=await makeViews(checked,files,modelHash,previewHash,runEpoch)}
    catch(error){
      // Presentation limits/failures must not discard a valid canonical build.
      if(epoch!==runEpoch)throw error;
      if(!["E_SESSION_LIMIT","E_SESSION_OBJ_LIMIT","E_SESSION_BACKEND_UNSUPPORTED","E_WHOLE_VIEW_FRAME"].includes(error.message))throw error;
      if(session)await session.dispose();session=null;sceneRevision=null;sessionCanvas=null;
      viewError=error.message;
    }
    if(epoch!==runEpoch)return;
    output={...checked,files};
    if(novel){
      $("whole-views").replaceChildren(...novel.cards);
      $("whole-view-receipt").textContent=JSON.stringify(novel.receipt,null,2);
      $("whole-view-downloads").append(download("novel-views.json",JSON.stringify(novel.receipt,null,2)));
      $("whole-view-status").textContent="4 новых глобальных вида · WebGPU depth · StageA NOT_ACCEPTED · PRIVATE_ACCEPTANCE_PENDING";
    }else{
      $("whole-view-status").textContent=viewError+": четыре вида не подтверждены. FGM/OBJ/C05 доступны; preview при наличии диагностического backend.";
    }
    $("whole-metrics").textContent=JSON.stringify({
      instance:checked.report.instance,cells:lofts.length,occupied:checked.report.occupied,
      checked_centers:checked.report.checked_centers,model_sha256:modelHash,
      verification_scope:checked.proof.verification_scope,
      reran_b1:checked.proof.reran_b1,rederived_r03:checked.proof.rederived_r03},null,2);
    $("whole-cell").replaceChildren(new Option("Весь объект","all"));
    for(const [i,cell] of checked.slices.cells.entries())
      $("whole-cell").add(new Option("Клетка "+cell.xyz.join(",")+" · "+cell.part,String(i)));
    $("whole-cell").disabled=false;$("whole-z").disabled=false;
    for(const name of NAMES){
      const button=document.createElement("button");button.textContent=name;
      button.addEventListener("click",()=>{
        if(runEpoch!==epoch||!output||output.files!==files)return;
        const blob=new Blob([files[name]],{type:name.endsWith(".obj")?"text/plain":"application/json"});
        const url=URL.createObjectURL(blob),link=document.createElement("a");
        link.href=url;link.download=name;link.click();
        setTimeout(()=>URL.revokeObjectURL(url),500);
      });
      $("whole-downloads").append(button);
    }
    showWhole(!!session);slice();
    status("COMPLETED","Единый OBJ и "+lofts.length+" производных среза; C05 проверен");
  }catch(error){
    if(epoch===runEpoch){
      output=null;showWhole(false);
      if(session)void session.dispose();session=null;sceneRevision=null;sessionCanvas=null;
      $("whole-views").replaceChildren();$("whole-view-downloads").replaceChildren();
      $("whole-view-receipt").textContent="";
      $("whole-downloads").replaceChildren();
      status("ERROR",/^E_[A-Z0-9_]+$/.test(error.message)?error.message:"E_WHOLE_UI");
    }
  }finally{
    if(currentWorker)currentWorker.terminate();
    if(currentWorker===worker){worker=null;controller=null}
    enable();
  }
});
enable();
