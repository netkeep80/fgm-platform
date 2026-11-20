// R02/R03/R04/R05/R06/C05 execute in pinned WASM.
import { syntheticFixture } from "./synthetic.mjs";
import { paintR05, sha256, verifyR05Observation } from "./r05-view.mjs";
import { indexGameFolder, resolveFile, catalogElementKey, ElementSpritePicker } from "./ufo-catalog.mjs";
const CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const MAX = 4 * 1024 * 1024, CHUNK = 16384;
const $ = id => document.getElementById(id);
const fields = ["map","loft","pck","tab","palette"];
let selected = new Map(), activeWorker = null, activeController = null, generation = 0, result = null;
let sourceMode = "empty", catalog = null, inspectedMap = null;
const mapMenu = $("catalog-map"), elementMenu = $("catalog-element");
const thumbnailPicker = new ElementSpritePicker({
  button:elementMenu,listbox:$("catalog-element-options"),decode:decodeCatalogSprites,
  onChoose:()=>elementMenu.dispatchEvent(new Event("change",{bubbles:true}))
});
let yaw = -0.78, pitch = .57, zoom = 1, mesh = null, drag = null, observation = null;
const view = $("preview"), context = view.getContext("2d");
const modeControl = $("view-mode");
const hints = {
  original: "Полный исходный кадр 32×40 в выбранной палитре.",
  reconstructed: "Голубым показан силуэт проверенной FGM-занятости в проекции R05.",
  overlay: "Зелёный — совпадение, голубой — только реконструкция, янтарный — только оригинал.",
  difference: "Голубой — только реконструкция, янтарный — только оригинал.",
  collision: "Проекция игровой LOFT-занятости на плоскость R05. Пурпурный отмечает пиксели, покрытые занятыми вокселями.",
  mesh: "Диагностический вид сетки OBJ. Мышью вращайте, колесом изменяйте масштаб."
};
const validId = s => /^[A-Za-z0-9_-]{1,48}$/.test(s);
const setState = (state, message) => {
  $("status").dataset.state = state;
  $("status").textContent = state + " · " + message;
};
function updateRunButton() {
  const bound=sourceMode==="manual" || inspectedMap?.elements.has(elementMenu.value);
  $("run").disabled=Boolean(activeWorker) || !bound;
}
// A source mutation invalidates the entire prior run, including its async replies.
function invalidateRun() {
  ++generation;
  if(activeController) activeController.abort();
  if(activeWorker) activeWorker.terminate();
  activeWorker=null;activeController=null;
  result=null;mesh=null;observation=null;drag=null;
  $("downloads").replaceChildren();
  $("metrics").textContent="Результатов пока нет";
  $("stage").textContent="Алгоритм r06-cell/1, одна атомарная операция step";
  updateRunButton();$("cancel").disabled=true;
  paint();
}
function resetElements() {
  inspectedMap=null;
  thumbnailPicker.reset();
}
function resetCatalog() {
  catalog=null;
  resetElements();
  mapMenu.replaceChildren(new Option("— выбрать карту —",""));
  mapMenu.disabled=true;
}
function setSource(mode) {
  sourceMode=mode;
  resetCatalog();
  selected=new Map();
  clearBindings();
  invalidateRun();
  $("manual-fields").disabled=mode!=="manual";
  $("catalog-summary").textContent=mode==="manual" ? "Выбрана ручная привязка." : "Выберите папку игры.";
}
function clearBindings() {
  for(const id of fields) {
    const sel=$(id);
    sel.replaceChildren(new Option("— выбрать —",""));
  }
  $("dataset-lines").value="";
  $("file-summary").textContent="Нет выбранных файлов";
}
function selectFiles(files) {
  // Fail closed even when file validation throws. Never retain a previous pack.
  setSource("manual");
  const candidate = new Map();
  for (const file of files) {
    const name=file.webkitRelativePath || file.name;
    if(!name || candidate.has(name)) throw Error("E_STUDIO_DUPLICATE_FILE");
    candidate.set(name,file);
  }
  // Publish the complete validated map in one step; never a partial selection.
  selected=candidate;
  const options = [...candidate.keys()].sort((a,b)=>a.localeCompare(b,"ru"));
  for (const id of fields) {
    const sel = $(id);
    sel.replaceChildren(new Option("— выбрать —",""));
    for (const name of options) sel.add(new Option(name,name));
    const patterns = {map:/\.map$/i,loft:/loftemps/i,pck:/\.pck$/i,tab:/\.tab$/i,palette:/palettes\.dat$|\.pal$/i};
    const match=options.filter(name=>patterns[id].test(name));
    if (match.length===1) sel.value=match[0];
  }
  const mcd=options.filter(name=>/\.mcd$/i.test(name));
  $("dataset-lines").value=mcd.map(name=>{
    const id=name.split("/").at(-1).replace(/\.mcd$/i,"").replace(/[^A-Za-z0-9_-]/g,"_");
    return id+"="+name;
  }).join("\n");
  $("file-summary").textContent=selected.size+" выбранных файлов; MCD порядок необходимо проверить вручную";
}
$("local-files").addEventListener("change",ev=>{
  const files=ev.target.files;
  try {selectFiles(files);setState("READY","Файлы выбраны локально")}
  catch(error){setSource("empty");setState("ERROR",error.message)}
});
$("directory").addEventListener("change",ev=>{
  if(!ev.target.files.length)return;
  void scanFolder(ev.target.files);
  ev.target.value="";
});
$("demo").addEventListener("click",()=>{
  try {
  selectFiles(syntheticFixture());
  for(const id of fields) $(id).value=id;
  $("dataset-lines").value="BLANKS=blanks\nTERRAIN=terrain";
  $("sprite-dataset").value="TERRAIN";
  $("part").value="north_wall";$("tile-x").value=0;$("tile-y").value=0;$("tile-z").value=0;
  $("slot").value=0;$("tab-bits").value=16;$("palette-index").value=0;$("material").value="stone";
  setState("READY","Свободная синтетическая клетка");
  } catch(error) {
    setSource("empty");
    setState("ERROR",error.message);
  }
});
// Any change to the source binding or RunSpec invalidates the displayed model.
for(const id of [...fields,"dataset-lines","sprite-dataset","tile-x","tile-y","tile-z",
  "part","slot","tab-bits","palette-index","material"]) {
  $(id).addEventListener("input",()=>{
    if(sourceMode!=="manual")return;
    invalidateRun();
    setState("READY","Параметры или привязки изменены; выполните новый запуск");
  });
}
function boundInteger(id,max) {
  const v=$(id).value;
  if(!/^(0|[1-9]\d*)$/.test(v) || Number(v)>max)throw Error("E_STUDIO_PARAMETER");
  return Number(v);
}
function inputSpec() {
  if(sourceMode==="catalog")return catalogInputSpec();
  const filenames=fields.map(id=>$(id).value);
  if(filenames.some(x=>!selected.has(x)))throw Error("E_STUDIO_MISSING_FILE");
  const lines=$("dataset-lines").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length||lines.length>16)throw Error("E_STUDIO_DATASET_ORDER");
  const datasets=[], inputs=new Map(), used=new Set();
  function bind(path,logical) {
    if(!selected.has(path) || used.has(path))throw Error("E_STUDIO_BINDING");
    used.add(path);inputs.set(logical,selected.get(path));return logical;
  }
  const map=bind($( "map").value,"map"),loft=bind($("loft").value,"loft");
  for(const [i,line] of lines.entries()) {
    const pos=line.indexOf("=");
    if(pos<1)throw Error("E_STUDIO_DATASET_ORDER");
    const id=line.slice(0,pos).trim(),path=line.slice(pos+1).trim();
    if(!validId(id)||datasets.some(d=>d.id===id))throw Error("E_STUDIO_DATASET_ORDER");
    datasets.push({id,file:bind(path,"ds"+i)});
  }
  const spriteId=$("sprite-dataset").value.trim();
  if(!datasets.some(d=>d.id===spriteId))throw Error("E_STUDIO_SPRITE_BINDING");
  const pck=bind($("pck").value,"pck"),tab=bind($("tab").value,"tab"),palette=bind($("palette").value,"palette");
  const material=$("material").value.trim();
  if(!/^[a-z][a-z0-9_]{0,47}$/.test(material))throw Error("E_STUDIO_MATERIAL");
  checkInputSizes(inputs);
  return {inputs,spec:{
    algorithm:"r06-cell/1",coreRevision:CORE,budget:6144,
    sourceBindings:{map,loft,datasets,sprite:{dataset:spriteId,pck,tab,palette}},
    parameters:{tile:[boundInteger("tile-x",254),boundInteger("tile-y",254),boundInteger("tile-z",254)],
      part:$("part").value,material,frameSlot:boundInteger("slot",7),
      tabBits:Number($("tab-bits").value),paletteIndex:boundInteger("palette-index",8191)}
  }};
}
function checkInputSizes(inputs) {
  const sizes=[...inputs.values()].map(value=>value instanceof Uint8Array ? value.length : value.size);
  if(inputs.size>21 || sizes.some(size=>size===0) || sizes.reduce((total,size)=>total+size,0)>MAX)
    throw Error("E_STUDIO_LIMIT");
}
const hex = bytes => {
  const digits="0123456789abcdef";let s="";
  for(const b of bytes)s+=digits[b>>>4]+digits[b&15];
  return s;
};
function connection(worker,signal) {
  return request => new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error("E_STUDIO_CANCELLED"));return}
    const cleanup=()=>{worker.removeEventListener("message",onReply);worker.removeEventListener("error",onError);signal.removeEventListener("abort",onAbort)};
    const onReply=e=>{
      cleanup();
      try {
        if(typeof e.data!=="string")throw Error("E_STUDIO_TRANSPORT");
        const row=JSON.parse(e.data);
        if(row.error)throw Error(row.error);
        resolve(row);
      }catch(error){reject(error)}
    };
    const onError=()=>{cleanup();reject(Error("E_STUDIO_WORKER"))};
    const onAbort=()=>{cleanup();reject(Error("E_STUDIO_CANCELLED"))};
    signal.addEventListener("abort",onAbort,{once:true});
    worker.addEventListener("message",onReply,{once:true});
    worker.addEventListener("error",onError,{once:true});
    worker.postMessage(JSON.stringify({v:1,...request}));
  });
}
function openWorker() {
  const worker=new Worker("./engine/worker.mjs",{type:"module"});
  activeWorker=worker;
  activeController=new AbortController();
  updateRunButton();
  return {worker,call:connection(worker,activeController.signal)};
}
function closeWorker(worker) {
  if(worker)worker.terminate();
  if(activeWorker===worker){activeWorker=null;activeController=null}
  updateRunButton();
}
function ensureCurrent(epoch) {
  if(epoch!==generation)throw Error("E_STUDIO_CANCELLED");
}
async function appendInputs(call,inputs,epoch,progress) {
  let sent=0;
  for(const [name,input] of inputs) {
    const bytes=input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
    ensureCurrent(epoch);
    for(let offset=0;offset<bytes.length;offset+=CHUNK) {
      const chunk=bytes.subarray(offset,offset+CHUNK);
      await call({action:"append",file:name,offset,hex:hex(chunk)});
      ensureCurrent(epoch);
      sent+=chunk.length;
      if(progress)progress(sent);
    }
  }
}
const catalogErrors={
  E_STUDIO_CATALOG_ROOT:"Выберите папку одной установки игры с каталогами MAPS, TERRAIN и GEODATA.",
  E_STUDIO_CATALOG_MAPS:"В папке игры нет тактических карт.",
  E_STUDIO_CATALOG_DUPLICATE:"В папке найдены совпадающие имена ресурсов.",
  E_STUDIO_DUPLICATE_FILE:"В папке найдены повторяющиеся пути.",
  E_STUDIO_CATALOG_INDEX_LIMIT:"Список путей слишком длинный. Выберите папку самой игры.",
  E_STUDIO_CATALOG_PATH:"В выбранной папке есть неподдерживаемый путь.",
  E_R02_MAP_LENGTH:"Размер карты не соответствует её заголовку.",
  E_R02_MAP_HEADER:"Карта повреждена или пуста.",
  E_STUDIO_LIMIT:"Файлы карты превышают лимит реконструкции."
};
function showCatalogError(error, fallback) {
  const code=/^E_[A-Z0-9_]+$/.test(error.message)?error.message:"E_STUDIO_UI";
  const message=(catalogErrors[code]??fallback)+" ("+code+")";
  $("catalog-summary").textContent=message;
  setState("ERROR",message);
}
async function scanFolder(files) {
  setSource("catalog");
  $("catalog-summary").textContent="Проверяю состав папки…";
  const epoch=generation;
  let worker=null;
  try {
    const {index,request}=indexGameFolder(files);
    let call;
    ({worker,call}=openWorker());
    const {catalog:result}=await call(request);
    ensureCurrent(epoch);
    if(result?.schema!=="fgmr-ufo-library/1")throw Error("E_STUDIO_CATALOG_SCHEMA");
    const maps=new Map(result.maps.map(map=>[map.id,map]));
    const usable=result.maps.filter(map=>map.datasets && !map.missing.length).length;
    catalog={index,maps,result};
    for(const map of result.maps) {
      const state=!map.datasets ? " · профиль неизвестен" : map.missing.length ? " · неполный комплект" : "";
      mapMenu.add(new Option(map.name+" ("+map.id+")"+state,map.id));
    }
    mapMenu.disabled=false;
    $("file-summary").textContent="Тактических карт: "+result.maps.length+". Готовы к выбору: "+usable+".";
    $("catalog-summary").textContent=usable ? "Выберите карту, затем элемент." : "Проверьте состав папки по списку карт.";
    setState("READY","Папка игры проверена");
  } catch(error) {
    if(epoch===generation)showCatalogError(error,"Не удалось открыть каталог игры.");
  } finally {
    closeWorker(worker);
  }
}
async function inspectSelectedMap() {
  resetElements();
  invalidateRun();
  const snapshot=catalog;
  const map=snapshot?.maps.get(mapMenu.value);
  if(!map){$("catalog-summary").textContent="Выберите карту.";return}
  if(!map.datasets || map.missing.length) {
    $("catalog-summary").textContent=!map.datasets ? "Профиль этой карты неизвестен." :
      "Для этой карты не хватает файлов "+map.missing.join(", ")+".";
    setState("READY","Выберите карту с полным комплектом");
    return;
  }
  const epoch=generation;
  $("catalog-summary").textContent="Читаю элементы карты…";
  setState("READY","Определяю элементы карты");
  let worker=null;
  try {
    const {index,result}=snapshot;
    const datasets=map.datasets.map((id,i)=>({id,file:"ds"+i}));
    const files=new Map([["map",resolveFile(index,map.path)],
      ...datasets.map(({id,file})=>[file,resolveFile(index,result.terrain[id].mcd)])]);
    checkInputSizes(files);
    let call;
    ({worker,call}=openWorker());
    const entries=await Promise.all([...files].map(async ([id,file])=>[id,new Uint8Array(await file.arrayBuffer())]));
    ensureCurrent(epoch);
    const inputs=new Map(entries);
    await appendInputs(call,inputs,epoch);
    const {catalog:report}=await call({action:"catalog-map",map:map.id});
    ensureCurrent(epoch);
    if(report?.schema!=="fgmr-ufo-map-elements/1" || report.map!==map.id)
      throw Error("E_STUDIO_CATALOG_SCHEMA");
    const elements=new Map(report.elements.map(entry=>[catalogElementKey(map.id,entry),entry]));
    inspectedMap={inputs,datasets,elements};
    thumbnailPicker.load([...elements],{slot:0,paletteIndex:result.paletteIndex});
    $("catalog-summary").textContent=elements.size ? "Выберите элемент для реконструкции." : "В этой карте нет распознанных элементов.";
    setState("READY","Элементы карты готовы");
  } catch(error) {
    if(epoch===generation)showCatalogError(error,"Не удалось прочитать элементы карты.");
  } finally {
    closeWorker(worker);
  }
}
async function decodeCatalogSprites(dataset,records,signal) {
  const epoch=generation,snapshot=catalog,current=inspectedMap;
  if(!snapshot || !current || signal.aborted || !current.datasets.some(x=>x.id===dataset))
    throw Error("E_STUDIO_CANCELLED");
  const terrain=snapshot.result.terrain[dataset];
  if(!terrain)throw Error("E_STUDIO_THUMB_BINDING");
  const id=current.datasets.find(x=>x.id===dataset).file;
  const inputs=new Map([
    ["mcd",current.inputs.get(id)],
    ["pck",resolveFile(snapshot.index,terrain.pck)],
    ["tab",resolveFile(snapshot.index,terrain.tab)],
    ["palette",resolveFile(snapshot.index,snapshot.result.palette)]
  ]);
  checkInputSizes(inputs);
  const worker=new Worker("./engine/worker.mjs",{type:"module"});
  const call=connection(worker,signal);
  try{
    await appendInputs(call,inputs,epoch);
    ensureCurrent(epoch);
    const {thumbnails}=await call({
      action:"catalog-thumbnails",dataset,records,frameSlot:0,
      tabBits:snapshot.result.tabBits,paletteIndex:snapshot.result.paletteIndex
    });
    ensureCurrent(epoch);
    if(signal.aborted)throw Error("E_STUDIO_CANCELLED");
    return thumbnails;
  }finally{worker.terminate()}
}

function catalogInputSpec() {
  const element=inspectedMap?.elements.get(elementMenu.value);
  if(!element || !catalog)throw Error("E_STUDIO_CATALOG_BINDING");
  const {index,result}=catalog;
  const terrain=result.terrain[element.dataset];
  const inputs=new Map(inspectedMap.inputs);
  for(const [name,path] of [["loft",result.loft],["pck",terrain.pck],["tab",terrain.tab],["palette",result.palette]])
    inputs.set(name,resolveFile(index,path));
  checkInputSizes(inputs);
  return {inputs,element,spec:{
    algorithm:"r06-cell/1",coreRevision:CORE,budget:6144,
    sourceBindings:{map:"map",loft:"loft",datasets:inspectedMap.datasets,
      sprite:{dataset:element.dataset,pck:"pck",tab:"tab",palette:"palette"}},
    parameters:{tile:element.tile,part:element.part,material:"stone",frameSlot:0,
      tabBits:result.tabBits,paletteIndex:result.paletteIndex}
  }};
}
mapMenu.addEventListener("change",()=>void inspectSelectedMap());
elementMenu.addEventListener("change",()=>{
  thumbnailPicker.cancelPending();
  invalidateRun();
  const element=inspectedMap?.elements.get(elementMenu.value);
  $("catalog-summary").textContent=element?element.name+" · экземпляров на карте: "+element.instances+".":"Выберите элемент.";
  setState("READY",element?"Элемент готов к реконструкции":"Ожидание выбора элемента");
});
async function verifyPack(pack, tile) {
  if(!pack || typeof pack!=="object")throw Error("E_STUDIO_RESULT");
  for(const key of ["model","preview","report","proof"])if(typeof pack[key]!=="string")throw Error("E_STUDIO_RESULT");
  const report=JSON.parse(pack.report), proof=JSON.parse(pack.proof);
  if(report.schema!=="fgmr-studio-cell/1"||proof.schema!=="fgmr-studio-c05-proof/1"||proof.voxels_checked!==6144)throw Error("E_STUDIO_PROOF");
  const [model,preview,receipt]=await Promise.all([sha256(pack.model),sha256(pack.preview),sha256(pack.report)]);
  if(model!==proof.model_sha256||model!==report.package_bytes_sha256||
     preview!==proof.mesh_sha256||receipt!==proof.report_sha256)throw Error("E_STUDIO_PROOF");
  const visual=await verifyR05Observation(pack.visual,proof.r05_visual_sha256,tile,report.silhouette);
  return {report,visual};
}
async function execute() {
  if(activeWorker)return;
  let worker=null;
  invalidateRun();
  // Reserve a fresh epoch after cleanup; invalidateRun() also prevents stale export.
  const runEpoch=generation;
  $("run").disabled=true;$("cancel").disabled=false;
  $("stage").textContent="Проверка входов и подготовка нового запуска";
  try {
    const {inputs,spec,element}=inputSpec();
    let call;
    ({worker,call}=openWorker());
    await call({action:"clear"});
    await appendInputs(call,inputs,runEpoch,sent=>{$("stage").textContent="Передано "+sent+" байт локальному Worker"});
    const started=await call({action:"start",spec});
    if(started.state!=="RUNNING")throw Error("E_STUDIO_STATE");
    if(runEpoch!==generation)throw Error("E_STUDIO_CANCELLED");
    setState("RUNNING","R06 · 6144 проверок C05");
    const stepped=await call({action:"step",runId:started.runId});
    if(stepped.state!=="COMPLETED")throw Error("E_STUDIO_STATE");
    const final=await call({action:"finalize",runId:started.runId});
    if(final.state!=="COMPLETED")throw Error("E_STUDIO_STATE");
    const {report,visual}=await verifyPack(final.result,spec.parameters.tile);
    if(runEpoch!==generation)throw Error("E_STUDIO_CANCELLED");
    if(element && (report.source.dataset_label!==element.dataset || report.source.local_index!==element.record ||
        report.source.part!==element.part || report.right_half!==element.rightHalf))
      throw Error("E_STUDIO_CATALOG_BINDING");
    const nextMesh=loadObj(final.result.preview);
    if(runEpoch!==generation)throw Error("E_STUDIO_CANCELLED");
    result=final.result;mesh=nextMesh;observation=visual;
    $("metrics").textContent=JSON.stringify({
      runId:started.runId,source:report.source,part:spec.parameters.part,occupied:report.occupied,
      boxes:report.boxes,voxels_checked:report.voxel_checks,silhouette:report.silhouette,
      model_sha256:JSON.parse(result.proof).model_sha256,
    },null,2);
    setState("COMPLETED","FGM, OBJ и сравнение R05 проверены");
    $("stage").textContent="Реконструкция завершена; файл остаётся на вашем компьютере";
    const items=[["model","model.fgm.json","application/json"],["preview","preview.obj","text/plain"],
      ["report","report.json","application/json"],["proof","viewer-proof.json","application/json"]];
    for(const [key,name,mime] of items) {
      const button=document.createElement("button");button.textContent=name;
      const pack=result;
      button.addEventListener("click",()=>{
        if(runEpoch!==generation || result!==pack) return;
        const url=URL.createObjectURL(new Blob([pack[key]],{type:mime}));
        const a=document.createElement("a");a.href=url;a.download=name;a.click();
        setTimeout(()=>URL.revokeObjectURL(url),500);
      });
      $("downloads").append(button);
    }
    paint();
  } catch(error) {
    if(runEpoch===generation) {
      result=null;mesh=null;observation=null;
      $("downloads").replaceChildren();
      $("metrics").textContent="Результатов пока нет";
      paint();
      setState("ERROR",/^E_[A-Z0-9_]+$/.test(error.message)?error.message:"E_STUDIO_UI");
    }
  } finally {
    closeWorker(worker);
    if(runEpoch===generation)$("cancel").disabled=true;
  }
}
$("run").addEventListener("click",execute);
$("cancel").addEventListener("click",()=>{
  invalidateRun();
  setState("CANCELLED","Worker остановлен; неполный результат отброшен");
});
function loadObj(obj) {
  const vertices=[],faces=[];
  for(const line of obj.split(/\r?\n/)) {
    if(line.startsWith("v ")) {
      const v=line.slice(2).trim().split(/\s+/).map(Number);
      if(v.length!==3||v.some(n=>!Number.isFinite(n)))throw Error("E_STUDIO_OBJ");
      vertices.push(v);
    } else if(line.startsWith("f ")) {
      const f=line.slice(2).trim().split(/\s+/).map(x=>Number(x.split("/")[0])-1);
      if(f.length<3||f.length>4||f.some(n=>!Number.isInteger(n)||n<0||n>=vertices.length))throw Error("E_STUDIO_OBJ");
      faces.push(f);
    }
    if(vertices.length>200000||faces.length>200000)throw Error("E_STUDIO_OBJ_LIMIT");
  }
  return {vertices,faces};
}
function paint() {
  const w=view.width,h=view.height;
  const mode=modeControl.value;
  view.dataset.mode=mode;
  view.setAttribute("aria-label",modeControl.selectedOptions[0].textContent);
  $("hint").textContent=hints[mode]+(observation?.sprite.right_half && ["overlay","difference"].includes(mode)
    ? " Для этой части сравнивается правая половина исходного кадра." : "");
  context.fillStyle="#101b2b";context.fillRect(0,0,w,h);
  if(mode!=="mesh" && observation) {
    paintR05(context,observation,mode);
    return;
  }
  if(!mesh?.vertices.length) {
    context.fillStyle="#90adc0";context.font="19px system-ui";
    context.textAlign="center";context.fillText("Модель ещё не построена",w/2,h/2);
    return;
  }
  const c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const points=mesh.vertices.map(([x,y,z])=>{
    const horizontal=x*c-y*s,depth=x*s+y*c;
    return [horizontal,depth*sp-z*cp,depth*cp+z*sp];
  });
  const ext=[Infinity,Infinity,-Infinity,-Infinity];
  for(const p of points){ext[0]=Math.min(ext[0],p[0]);ext[1]=Math.min(ext[1],p[1]);ext[2]=Math.max(ext[2],p[0]);ext[3]=Math.max(ext[3],p[1])}
  const scale=Math.min(w/(ext[2]-ext[0]+2),h/(ext[3]-ext[1]+2))*.84*zoom;
  const center=[(ext[0]+ext[2])/2,(ext[1]+ext[3])/2];
  const faces=mesh.faces.map(f=>({f,z:f.reduce((a,i)=>a+points[i][2],0)/f.length})).sort((a,b)=>a.z-b.z);
  for(const {f,z} of faces) {
    context.beginPath();
    f.forEach((i,j)=>{
      const p=points[i],px=w/2+(p[0]-center[0])*scale,py=h/2+(p[1]-center[1])*scale;
      if(j===0)context.moveTo(px,py);else context.lineTo(px,py);
    });context.closePath();
    context.fillStyle=z>0?"#668c9c":"#517485";
    context.fill();context.strokeStyle="#91b7c1";context.lineWidth=.8;context.stroke();
  }
}
modeControl.addEventListener("change",()=>{drag=null;paint()});
view.addEventListener("pointerdown",e=>{if(modeControl.value!=="mesh")return;drag={x:e.clientX,y:e.clientY};view.setPointerCapture(e.pointerId)});
view.addEventListener("pointermove",e=>{if(!drag)return;yaw+=(e.clientX-drag.x)*.012;pitch=Math.max(-1.3,Math.min(1.3,pitch+(e.clientY-drag.y)*.01));drag={x:e.clientX,y:e.clientY};paint()});
view.addEventListener("pointerup",()=>drag=null);
view.addEventListener("pointercancel",()=>drag=null);
view.addEventListener("wheel",e=>{if(modeControl.value!=="mesh")return;e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*(e.deltaY>0?.91:1.1)));paint()},{passive:false});
paint();
