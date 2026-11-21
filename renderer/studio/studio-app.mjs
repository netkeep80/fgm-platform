// R02/R03/R04/R05/R06/C05 execute in pinned WASM.
import { syntheticFixture } from "./synthetic.mjs";
import { paintR05, sha256, verifyR05Observation } from "./r05-view.mjs";
import { indexGameFolder, resolveFile, mapRoutePresence, catalogElementKey, ElementSpritePicker } from "./ufo-catalog.mjs";
const CORE = "ba91a5e96d9f4f9580c9b2e9a9460b97acb7f01b";
const MAX = 4 * 1024 * 1024, CHUNK = 16384;
const $ = id => document.getElementById(id);
const fields = ["map","loft","pck","tab","palette"];
let selected = new Map(), activeWorker = null, activeController = null, generation = 0, result = null;
let sourceMode = "empty", catalog = null, inspectedMap = null;
let selectedPlacement=null,placementPage=null,placementEpoch=0,placementLoading=null;
let objectDraft=null,objectLastError="";
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
  const pageReady=Boolean(inspectedMap && placementPage &&
    placementPage.map===inspectedMap.mapId &&
    placementPage.sourceDigest===inspectedMap.sourceDigest &&
    String(placementPage.floor)===$("source-floor").value);
  const type=pageReady?inspectedMap.elements.get(elementMenu.value):null;
  const bound=sourceMode==="manual" || (pageReady &&
    ((Boolean(selectedPlacement) && selectedPlacement.tile[2]===placementPage.floor) ||
     type?.tile[2]===placementPage.floor));
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
  // Invalidate the old source's semantic applicability BEFORE any async File/Worker read.
  if(objectDraft)objectDraft.stale=true;
  u3Reset();
  inspectedMap=null;selectedPlacement=null;placementPage=null;placementLoading=null;++placementEpoch;
  $("source-placement-panel").hidden=true;
  $("source-grid").replaceChildren();$("source-floor").replaceChildren();
  $("source-floor").disabled=true;$("source-prev").disabled=true;$("source-next").disabled=true;
  $("source-page-status").textContent="Нет размещений";
  $("source-placement-status").textContent="Часть исходной клетки не выбрана.";
  thumbnailPicker.reset();renderObjectDraft();u3RenderLibrary();
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
  u3Status("ERROR · "+code+" · "+message);
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
    u3RenderLibrary();
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
    u3RenderLibrary();
    u3Status(!map.datasets
      ? "PROFILE_UNKNOWN · исходный MAP "+map.id+" не имеет подтверждённого MCD-профиля."
      : "INCOMPLETE · блок "+map.id+" не имеет полного набора исходных файлов.");
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
    // Same exact staged MAP/MCD bytes, same R02 native decoder, bounded page.
    const {catalog:placements}=await call({
      action:"catalog-placements",map:map.id,floor:0,offset:0,limit:128,sourceDigest:""
    });
    ensureCurrent(epoch);
    verifyPlacementPage(placements,map.id,null,0,0);
    const elements=new Map(report.elements.map(entry=>[catalogElementKey(map.id,entry),entry]));
    inspectedMap={inputs,datasets,elements,mapId:map.id,dimensions:report.dimensions,
                  sourceDigest:placements.sourceDigest};
    thumbnailPicker.load([...elements],{slot:0,paletteIndex:result.paletteIndex});
    const floors=$("source-floor");
    for(let z=0;z<report.dimensions[2];z++)floors.add(new Option("Z = "+z,String(z)));
    floors.value="0";floors.disabled=false;
    $("source-placement-panel").hidden=false;
    renderPlacementPage(placements);
    renderObjectDraft();
    u3MapReady();
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


// D4-U1: this module remains the only owner of source selection/Worker revisions.
// Read-only typed source placements are materialized by the native R02 decoder.
function verifyPlacementPage(page,mapId,digest,floor,offset) {
  if(page?.schema!=="fgmr-ufo-map-placements/1"||page.map!==mapId||
     page.floor!==floor||page.offset!==offset||
     !/^[0-9a-f]{64}$/.test(page.sourceDigest)|| (digest && page.sourceDigest!==digest)||
     !Array.isArray(page.dimensions)||page.dimensions.length!==3||
     !Number.isSafeInteger(page.total)||page.total<0||
     !Array.isArray(page.placements)||page.placements.length>128||
     page.placements.length>page.total-page.offset)
    throw Error("E_STUDIO_PLACEMENTS_SCHEMA");
  const ids=new Set();
  for(const entry of page.placements){
    if(typeof entry.sourcePartRef!=="string"||
       !entry.sourcePartRef.startsWith(page.sourceDigest+"/")||
       ids.has(entry.sourcePartRef)||
       !Array.isArray(entry.tile)||entry.tile.length!==3||
       entry.tile[2]!==floor ||
       entry.tile.some((n,i)=>!Number.isInteger(n)||n<0||n>=page.dimensions[i])||
       !["floor","west_wall","north_wall","object"].includes(entry.part)||
       !Number.isInteger(entry.record)||entry.record<0||
       typeof entry.dataset!=="string")
      throw Error("E_STUDIO_PLACEMENTS_SCHEMA");
    ids.add(entry.sourcePartRef);
  }
  if(page.nextOffset!==null && page.nextOffset!==page.offset+page.placements.length)
    throw Error("E_STUDIO_PLACEMENTS_SCHEMA");
  if(page.nextOffset===null && page.offset+page.placements.length!==page.total)
    throw Error("E_STUDIO_PLACEMENTS_SCHEMA");
  return page;
}
function renderSelectedPlacement() {
  const p=selectedPlacement;
  $("source-placement-status").textContent=p
    ? "R02 "+p.sourcePartRef+" · ("+p.tile.join(",")+") "+p.part+
      " · "+p.dataset+" №"+p.record+" · "+(p.rightHalf?"R05 правая половина":"R05 полный кадр")+
      " · проверено по локальному MAP/MCD, семантический объект ещё не определён."
    : "Отдельное размещение не выбрано; список типов R04 остаётся доступным.";
  renderObjectDraft();
}
function renderPlacementPage(page) {
  const pageEpoch=placementEpoch;
  placementPage=page;
  const grid=$("source-grid");
  grid.replaceChildren();
  grid.style.gridTemplateColumns="repeat("+page.dimensions[0]+",minmax(80px,1fr))";
  const cells=new Map(),buttons=[];
  for(const placement of page.placements){
    const [x,y,z]=placement.tile;
    const key=x+","+y;
    let tile=cells.get(key);
    if(!tile){
      tile=document.createElement("div");tile.className="source-cell";
      tile.style.gridColumn=String(x+1);tile.style.gridRow=String(y+1);
      const label=document.createElement("small");label.textContent=x+","+y+" · Z"+z;
      tile.append(label);cells.set(key,tile);grid.append(tile);
    }
    const button=document.createElement("button");
    button.type="button";button.dataset.sourcePartRef=placement.sourcePartRef;
    button.dataset.x=String(x);button.dataset.y=String(y);button.dataset.part=placement.part;
    button.title=placement.name+" · "+placement.dataset+" №"+placement.record+
      " · ("+placement.tile.join(",")+")";
    button.setAttribute("aria-label",button.title);
    button.setAttribute("aria-pressed",String(selectedPlacement?.sourcePartRef===placement.sourcePartRef));
    button.textContent=({floor:"Пол",west_wall:"З",north_wall:"С",object:"О"})[placement.part];
    button.addEventListener("click",()=>{
      // Detached/old-floor buttons must never cancel a newer native page request.
      if(!button.isConnected || pageEpoch!==placementEpoch || placementPage!==page ||
         inspectedMap?.mapId!==page.map ||
         inspectedMap?.sourceDigest!==page.sourceDigest ||
         $("source-floor").value!==String(page.floor))return;
      // Existing original R04 thumbnail picker remains the ONLY sprite decoder/UI.
      // Type-level picker selection intentionally uses its representative tile;
      // R06 gets the occurrence's real native coordinate only via selectedPlacement.
      const entries=thumbnailPicker.items;
      const position=entries.findIndex(({entry})=>entry.part===placement.part &&
        entry.dataset===placement.dataset && entry.record===placement.record &&
        entry.rightHalf===placement.rightHalf);
      if(position<0){$("source-placement-status").textContent="E_STUDIO_PLACEMENTS_TYPE";return}
      thumbnailPicker.choose(position);
      selectedPlacement=placement;
      for(const b of buttons)b.setAttribute("aria-pressed",String(b===button));
      renderSelectedPlacement();
      updateRunButton();
      button.focus();
    });
    tile.append(button);buttons.push(button);
  }
  for(let i=0;i<buttons.length;i++){
    const btn=buttons[i];
    btn.addEventListener("keydown",e=>{
      if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;
      e.preventDefault();
      const [x,y]=[Number(btn.dataset.x),Number(btn.dataset.y)];
      let dest;
      if(e.key==="Home")dest=buttons[0];
      else if(e.key==="End")dest=buttons.at(-1);
      else{
        const [dx,dy]=e.key==="ArrowLeft"?[-1,0]:e.key==="ArrowRight"?[1,0]:
          e.key==="ArrowUp"?[0,-1]:[0,1];
        dest=buttons.find(b=>Number(b.dataset.x)===x+dx&&
          Number(b.dataset.y)===y+dy&&b.dataset.part===btn.dataset.part);
        if(!dest)dest=buttons[Math.max(0,Math.min(buttons.length-1,i+(dx+dy)))];
      }
      dest?.focus();
    });
  }
  $("source-prev").disabled=page.offset===0;
  $("source-next").disabled=page.nextOffset===null;
  $("source-page-status").textContent="R02: "+page.total+" частей на этаже Z="+page.floor+
    " · показано "+(page.offset+1)+"–"+(page.offset+page.placements.length)+
    " · страница "+(Math.floor(page.offset/128)+1)+
    " · SHA-256 "+page.sourceDigest.slice(0,12)+"… (не аутентификация).";
  renderSelectedPlacement();
}
async function loadPlacementPage(floor,offset) {
  const current=inspectedMap;
  if(!current || !catalog || activeWorker)return;
  const epoch=generation,token=++placementEpoch;
  // Pending request identity is needed only to retry a same-source R04 choice.
  placementLoading={mapId:current.mapId,sourceDigest:current.sourceDigest,floor,offset,token};
  const focusNav=document.activeElement===$("source-next")?"next":
    document.activeElement===$("source-prev")?"prev":null;
  // Retire old page synchronously before yielding to any Worker/file operation.
  placementPage=null;
  $("source-grid").replaceChildren();
  $("source-prev").disabled=true;$("source-next").disabled=true;
  $("source-page-status").textContent="Нативная загрузка R02…";
  $("source-placement-status").textContent="Страница исходных размещений загружается.";
  updateRunButton();
  let worker=null;
  try {
    let call;({worker,call}=openWorker());
    await call({action:"clear"});
    await appendInputs(call,current.inputs,epoch);
    ensureCurrent(epoch);
    const {catalog:page}=await call({
      action:"catalog-placements",map:current.mapId,floor,offset,limit:128,
      sourceDigest:current.sourceDigest
    });
    ensureCurrent(epoch);
    if(token!==placementEpoch || current!==inspectedMap ||
       $("source-floor").value!==String(floor))throw Error("E_STUDIO_CANCELLED");
    verifyPlacementPage(page,current.mapId,current.sourceDigest,floor,offset);
    renderPlacementPage(page);
    updateRunButton();
    if(focusNav){
      const preferred=$("source-"+focusNav);
      const other=$("source-"+(focusNav==="next"?"prev":"next"));
      (preferred.disabled ? (other.disabled ? $("source-floor") : other) : preferred).focus();
    }
  }catch(error) {
    if(token===placementEpoch && current===inspectedMap && epoch===generation) {
      // Failed page must not expose a previous R06 receipt or runnable old tile.
      selectedPlacement=null;
      invalidateRun();
      renderSelectedPlacement();
      $("source-page-status").textContent="Не удалось прочитать размещения: "+error.message;
      $("source-prev").disabled=true;$("source-next").disabled=true;
      if(focusNav)$("source-floor").focus();
    }
  }finally{
    if(placementLoading?.token===token)placementLoading=null;
    closeWorker(worker);
  }
}
$("source-floor").addEventListener("change",()=>{
  // Different floor changes the active source coordinate; invalidate R06.
  selectedPlacement=null;invalidateRun();
  renderSelectedPlacement();
  void loadPlacementPage(Number($("source-floor").value),0);
});
$("source-prev").addEventListener("click",()=> {
  if(placementPage && placementPage.offset>0)
    void loadPlacementPage(placementPage.floor,Math.max(0,placementPage.offset-128));
});
$("source-next").addEventListener("click",()=>{
  if(placementPage?.nextOffset!==null && placementPage?.nextOffset!==undefined)
    void loadPlacementPage(placementPage.floor,placementPage.nextOffset);
});

function catalogInputSpec() {
  if(!inspectedMap || !placementPage ||
     placementPage.sourceDigest!==inspectedMap.sourceDigest ||
     placementPage.floor!==Number($("source-floor").value) ||
     (selectedPlacement && (selectedPlacement.tile[2]!==placementPage.floor ||
       !selectedPlacement.sourcePartRef.startsWith(placementPage.sourceDigest+"/"))))
    throw Error("E_STUDIO_PLACEMENTS_STALE");
  const element=selectedPlacement ?? inspectedMap?.elements.get(elementMenu.value);
  if(!element || !catalog || element.tile?.[2]!==placementPage.floor)
    throw Error("E_STUDIO_CATALOG_BINDING");
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
  // R04 type selection invalidates R06, but it must not strand a pending R02 page.
  // Retain only an exact same-map/digest/floor request, never an obsolete source.
  const pending=placementLoading;
  const retry=pending && inspectedMap && catalog &&
    pending.mapId===inspectedMap.mapId &&
    pending.sourceDigest===inspectedMap.sourceDigest &&
    String(pending.floor)===$("source-floor").value
    ? {floor:pending.floor,offset:pending.offset} : null;
  selectedPlacement=null;
  for(const node of $("source-grid").querySelectorAll('button[aria-pressed="true"]'))
    node.setAttribute("aria-pressed","false");
  renderSelectedPlacement();
  thumbnailPicker.cancelPending();
  invalidateRun();
  const element=inspectedMap?.elements.get(elementMenu.value);
  $("catalog-summary").textContent=element?element.name+" · экземпляров на карте: "+element.instances+".":"Выберите элемент.";
  setState("READY",element?"Элемент готов к реконструкции":"Ожидание выбора элемента");
  if(retry)void loadPlacementPage(retry.floor,retry.offset);
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
      runId:started.runId,source:report.source,part:spec.parameters.part,tile:report.tile,
      sourcePartRef:selectedPlacement?.sourcePartRef??null,
      sourceDigest:selectedPlacement?inspectedMap?.sourceDigest??null:null,
      occupied:report.occupied,
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


// D4-U2: proposal-only local membership; no new R02 parser, Worker, persistence
// authority, ObjectDefinition or automatic BuildWholeObject invocation.
const U2_MAX_HYPOTHESES=16,U2_MAX_MEMBERS=128,U2_MAX_INTENTS=256;
const u2Key=()=>sourceMode==="catalog" && inspectedMap &&
  /^[0-9a-f]{64}$/.test(inspectedMap.sourceDigest)
  ? {mapId:inspectedMap.mapId,sourceDigest:inspectedMap.sourceDigest} : null;
const u2Same=(a,b)=>Boolean(a&&b&&a.mapId===b.mapId&&a.sourceDigest===b.sourceDigest);
const u2Active=()=>objectDraft?.hypotheses.find(h=>h.hypothesisId===objectDraft.activeId);
const u2Ready=()=>Boolean(objectDraft&&!objectDraft.stale&&u2Same(u2Key(),objectDraft.source));
const u2Selection=()=>{
  const key=u2Key(),p=selectedPlacement;
  if(!key||!p||!Array.isArray(p.tile)||p.tile.length!==3||
     !new RegExp("^"+key.sourceDigest+"/[0-9]+-[0-3]$").test(p.sourcePartRef)||
     !["floor","west_wall","north_wall","object"].includes(p.part)||
     !p.tile.every(Number.isInteger)||typeof p.dataset!=="string"||
     !Number.isInteger(p.record)||p.record<0)return null;
  return {sourcePartRef:p.sourcePartRef,tile:[...p.tile],part:p.part,
    dataset:p.dataset,record:p.record};
};
const u2Count=()=>objectDraft?.hypotheses.reduce((n,h)=>n+h.members.length,0)??0;
function u2Status(message,error=false){
  objectLastError=error?message:"";
  $("object-action-status").dataset.state=error?"ERROR":"READY";
  $("object-action-status").textContent=message;
}
function u2Intent(op,hypothesisId,sourcePartRef,outcome,code){
  if(!objectDraft || objectDraft.intents.length>=U2_MAX_INTENTS)return;
  const entry={ordinal:objectDraft.intents.length+1,op,hypothesisId,
    sourceKey:{...objectDraft.source},outcome};
  if(sourcePartRef)entry.sourcePartRef=sourcePartRef;
  if(code)entry.code=code;
  objectDraft.intents.push(entry);
}
function u2Action(op,fn,ref=""){
  const h=u2Active(),id=h?.hypothesisId??"";
  let code="";
  try{
    if(!u2Ready() && !(op==="create"&&!objectDraft&&u2Key()))
      throw Error("E_U2_SOURCE_MISMATCH");
    if((objectDraft?.intents.length??0)>=U2_MAX_INTENTS)throw Error("E_U2_LIMIT");
    const done=fn(h);
    u2Intent(op,done?.hypothesisId??id,ref||done?.sourcePartRef||"","APPLIED");
    u2Status("APPLIED · "+op);
  }catch(error){
    code=/^E_U2_[A-Z_]+$/.test(error.message)?error.message:"E_U2_BINDING";
    u2Intent(op,id,ref,"REJECTED",code);
    u2Status(code,true);
  }
  renderObjectDraft();
}
function u2NewDraft(){
  const source=u2Key();
  if(!source){u2Status("E_U2_STALE_SELECTION",true);return}
  objectDraft={source:{...source},hypotheses:[],intents:[],activeId:"",
    nextId:1,stale:false};
  u2Status("DRAFT · новый черновик привязан к нативному MAP/MCD.");
  renderObjectDraft();
}
function renderObjectDraft(){
  const source=u2Key(),selected=u2Selection();
  const ready=u2Ready(),h=u2Active();
  $("object-selected-part").textContent=selected
    ? "R02 "+selected.sourcePartRef+" · ("+selected.tile.join(",")+") "+selected.part+
       " · "+selected.dataset+" №"+selected.record
    : "Нативная исходная часть не выбрана; вернитесь в «Источник».";
  const state=objectDraft
    ? objectDraft.stale||!u2Same(objectDraft.source,source)?"STALE_SOURCE"
      : objectLastError?"CONFLICT":"DRAFT"
    : source?"NO_DRAFT":"NO_SOURCE";
  $("object-draft-state").textContent=state+(objectDraft
    ? " · "+objectDraft.source.mapId+" · "+objectDraft.source.sourceDigest.slice(0,12)+
      "… · "+objectDraft.hypotheses.length+" гипотез, "+u2Count()+" частей."
    : " · "+(source?"Создайте первую гипотезу.":"Выберите исходную карту."));
  const list=$("object-hypotheses"),prior=list.value;
  list.replaceChildren(new Option("— нет гипотез —",""));
  if(objectDraft)for(const item of objectDraft.hypotheses)
    list.add(new Option(item.label+" · "+item.hypothesisId,item.hypothesisId));
  list.value=h?.hypothesisId??"";
  list.disabled=!ready||!objectDraft?.hypotheses.length;
  $("object-create").disabled=!source||(objectDraft&&!ready)||
    (objectDraft?.hypotheses.length??0)>=U2_MAX_HYPOTHESES;
  $("object-rename").disabled=!ready||!h;
  $("object-delete").disabled=!ready||!h;
  $("object-add").disabled=!ready||!h||!selected;
  $("object-export").disabled=!objectDraft;
  $("object-reset").disabled=!source;
  const members=$("object-members");members.replaceChildren();
  for(const m of h?.members??[]){
    // Each control belongs to exactly this draft, hypothesis and native member.
    // A detached control must never mutate a later owner of the same PartRef.
    const ownerDraft=objectDraft,ownerHypothesis=h;
    const item=document.createElement("div");item.className="object-member";
    const label=document.createElement("span");
    label.textContent="R02 "+m.sourcePartRef+" · ("+m.tile.join(",")+") "+m.part+
      " · "+m.dataset+" №"+m.record;
    const remove=document.createElement("button");remove.type="button";
    remove.textContent="Исключить";remove.dataset.sourcePartRef=m.sourcePartRef;
    remove.disabled=!ready;
    remove.setAttribute("aria-label","Исключить "+m.sourcePartRef);
    remove.addEventListener("click",()=>{
      // Check identity BEFORE u2Action, state mutation or any APPLIED intent.
      // All draft edits render a fresh member list, retiring previous buttons.
      if(!remove.isConnected||remove.disabled||!members.contains(remove)||
         objectDraft!==ownerDraft||!u2Ready()||
         u2Active()!==ownerHypothesis||
         objectDraft.activeId!==ownerHypothesis.hypothesisId||
         !ownerHypothesis.members.includes(m))return;
      const index=[...members.querySelectorAll("button[data-source-part-ref]")].indexOf(remove);
      u2Action("unassign",current=>{
        if(current!==ownerHypothesis||!current.members.includes(m))
          throw Error("E_U2_BINDING");
        current.members=current.members.filter(x=>x!==m);
        return {sourcePartRef:m.sourcePartRef};
      },m.sourcePartRef);
      // The clicked node is now detached; transfer keyboard focus to a live,
      // enabled member button or a stable enabled hypothesis control.
      const after=members.querySelectorAll("button[data-source-part-ref]");
      const next=after[Math.min(index,after.length-1)]||
        [$("object-add"),$("object-hypotheses"),$("object-create"),$("object-reset")]
          .find(node=>node.isConnected&&!node.disabled);
      next?.focus();
    });
    item.append(label,remove);members.append(item);
  }
}
$("object-reset").addEventListener("click",u2NewDraft);
$("object-create").addEventListener("click",()=>{
  const label=$("object-name").value.trim();
  u2Action("create",()=>{
    if(!label||label.length>80)throw Error("E_U2_BINDING");
    if(!objectDraft){objectDraft={source:{...u2Key()},hypotheses:[],intents:[],
      activeId:"",nextId:1,stale:false}}
    if(objectDraft.hypotheses.length>=U2_MAX_HYPOTHESES)throw Error("E_U2_LIMIT");
    const id="h"+objectDraft.nextId++;
    objectDraft.hypotheses.push({hypothesisId:id,label,members:[]});
    objectDraft.activeId=id;
    return {hypothesisId:id};
  });
});
$("object-hypotheses").addEventListener("change",()=>{
  if(u2Ready() && objectDraft.hypotheses.some(h=>h.hypothesisId===$("object-hypotheses").value))
    objectDraft.activeId=$("object-hypotheses").value;
  u2Status("DRAFT · выбор рабочей гипотезы.");renderObjectDraft();
});
$("object-rename").addEventListener("click",()=>{
  const label=$("object-name").value.trim();
  u2Action("rename",h=>{
    if(!h||!label||label.length>80)throw Error("E_U2_BINDING");
    h.label=label;
  });
});
$("object-add").addEventListener("click",()=>{
  const selected=u2Selection();
  u2Action("assign",h=>{
    if(!h||!selected||!u2Same(u2Key(),objectDraft.source))
      throw Error("E_U2_STALE_SELECTION");
    if(h.members.some(x=>x.sourcePartRef===selected.sourcePartRef))
      throw Error("E_U2_DUPLICATE");
    if(objectDraft.hypotheses.some(x=>x.hypothesisId!==h.hypothesisId &&
      x.members.some(m=>m.sourcePartRef===selected.sourcePartRef)))
      throw Error("E_U2_MEMBER_CONFLICT");
    if(u2Count()>=U2_MAX_MEMBERS)throw Error("E_U2_LIMIT");
    h.members.push(selected);return {sourcePartRef:selected.sourcePartRef};
  },selected?.sourcePartRef??"");
});
$("object-delete").addEventListener("click",()=>{
  u2Action("delete",h=>{
    if(!h)throw Error("E_U2_BINDING");
    objectDraft.hypotheses=objectDraft.hypotheses.filter(x=>x!==h);
    objectDraft.activeId=objectDraft.hypotheses[0]?.hypothesisId??"";
    return {hypothesisId:h.hypothesisId};
  });
});
$("object-export").addEventListener("click",()=>{
  if(!objectDraft)return;
  const state=objectDraft.stale||!u2Same(objectDraft.source,u2Key())
    ?"STALE_SOURCE":objectLastError?"CONFLICT":"DRAFT";
  const data={schema:"fgmp-studio-object-hypotheses-draft/1",
    mapId:objectDraft.source.mapId,sourceDigest:objectDraft.source.sourceDigest,
    status:state,hypotheses:objectDraft.hypotheses.map(h=>({
      hypothesisId:h.hypothesisId,label:h.label,members:h.members.map(m=>({
        ...m,tile:[...m.tile]
      }))
    })),intents:objectDraft.intents.map(e=>({...e,sourceKey:{...e.sourceKey}})),
    conflicts:objectDraft.intents.filter(e=>e.outcome==="REJECTED").map(e=>({
      ordinal:e.ordinal,code:e.code,sourcePartRef:e.sourcePartRef??null
    }))};
  const bytes=JSON.stringify(data);
  if(bytes.length>131072){u2Status("E_U2_LIMIT",true);return}
  const url=URL.createObjectURL(new Blob([bytes],{type:"application/json"}));
  const a=document.createElement("a");
  a.href=url;a.download="fgm-object-hypotheses-draft.json";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  u2Status("DRAFT · JSON скачан локально; импорт U6 не реализован.");
  renderObjectDraft();
});
renderObjectDraft();

// D4-U3: a read-only, source-bound view of canonical native R02 MAP facts.
// The worker URL/protocol is unchanged; this consumer owns no new source truth.
const U3_PAGE=128,U3_MAX_PAGES=16,U3_MAX_PARTS=2048;
const U3_PARTS=["floor","west_wall","north_wall","object"];
let u3Active=false,u3Epoch=0,u3Worker=null,u3Abort=null,u3FloorData=null;
let u3SelectedCell=null,u3SelectedPart=null,u3TransferEpoch=0;
const u3Name=part=>({floor:"Пол",west_wall:"Западная стена",
                       north_wall:"Северная стена",object:"Объект"})[part];
function u3Status(value){$("mapblock-status").textContent=value}
function u3Retire() {
  ++u3Epoch;
  u3Abort?.abort();
  u3Worker?.terminate();
  u3Abort=null;u3Worker=null;u3FloorData=null;
  u3SelectedCell=null;u3SelectedPart=null;
  $("mapblock-grid").replaceChildren();
  $("mapblock-parts").replaceChildren();
  $("mapblock-selected").textContent="Клетка не выбрана.";
  $("mapblock-open-source").disabled=true;
}
function u3Reset() {
  ++u3TransferEpoch;
  u3Retire();
  $("mapblock-floor").replaceChildren();
  $("mapblock-floor").disabled=true;
  u3Status("NO_SOURCE · выберите папку игры и настоящий MAP-блок.");
  $("mapblock-route").textContent="ROUTE_INDEX_UNAVAILABLE";
}
function u3RenderLibrary() {
  const list=$("mapblock-library"),selectedId=mapMenu.value;
  list.replaceChildren();
  list.disabled=!catalog;
  if(!catalog){list.add(new Option("— выберите папку игры —",""));return}
  for(const map of catalog.result.maps) {
    const state=!map.datasets?"PROFILE_UNKNOWN":map.missing.length?"INCOMPLETE":"READY";
    list.add(new Option(map.name+" · "+map.id+" · "+state,map.id));
  }
  if(catalog.maps.has(selectedId))list.value=selectedId;
  else list.selectedIndex=-1;
  const selected=catalog.maps.get(selectedId);
  $("mapblock-route").textContent=selected
    ? mapRoutePresence(catalog.index,selected.path)
    : "ROUTE_INDEX_UNAVAILABLE";
}
function u3MapReady() {
  u3RenderLibrary();
  const source=inspectedMap;
  if(!source || sourceMode!=="catalog")return;
  const dims=source.dimensions;
  const f=$("mapblock-floor");
  f.replaceChildren();
  for(let z=0;z<dims[2];z++)f.add(new Option("Z = "+z,String(z)));
  f.value="0";f.disabled=false;
  u3Status("NATIVE_MAP_READY · "+source.mapId+" · "+dims.join("×")+
    " · SHA-256 "+source.sourceDigest.slice(0,12)+"… (не аутентификация)");
  if(u3Active)void u3LoadFloor();
}
function u3CheckPage(page,current,floor,offset,total,prior) {
  verifyPlacementPage(page,current.mapId,current.sourceDigest,floor,offset);
  const [w,h,z]=current.dimensions;
  if(![10,20].includes(w)||w!==h||w*h>400||!Number.isInteger(z)||z<1||
     page.dimensions.some((v,i)=>v!==current.dimensions[i])||
     page.total>w*h*4||page.total>U3_MAX_PARTS||
     (total!==null&&page.total!==total)||
     page.placements.length===0 && page.nextOffset!==null)
    throw Error("E_U3_NATIVE_PAGE");
  let last=prior;
  for(const p of page.placements){
    const expectedIndex=(z-1-floor)*w*h+p.tile[1]*w+p.tile[0];
    if(!Number.isInteger(p.tileIndex)||p.tileIndex!==expectedIndex||
       !Number.isInteger(p.partIndex)||p.partIndex<0||p.partIndex>3||
       p.part!==U3_PARTS[p.partIndex]||
       p.sourcePartRef!==current.sourceDigest+"/"+expectedIndex+"-"+p.partIndex||
       !Number.isInteger(p.sourceIndex)||p.sourceIndex<1||p.sourceIndex>255||
       typeof p.name!=="string"||typeof p.kind!=="string")
      throw Error("E_U3_NATIVE_BINDING");
    const order=expectedIndex*4+p.partIndex;
    if(order<=last)throw Error("E_U3_NATIVE_ORDER");
    last=order;
  }
  return last;
}
function u3CellSelect(cell,button=null,focus=false) {
  const data=u3FloorData;
  if(!data||!u3Active||data.source!==inspectedMap ||
     $("mapblock-floor").value!==String(data.floor)||!cell)return;
  u3SelectedCell=cell;u3SelectedPart=null;
  for(const node of $("mapblock-grid").querySelectorAll(".mapblock-cell"))
    node.setAttribute("aria-pressed",String(Number(node.dataset.x)===cell.x&&
      Number(node.dataset.y)===cell.y));
  const parts=$("mapblock-parts");parts.replaceChildren();
  const present=data.cells.get(cell.y*data.width+cell.x)??[];
  const show=part=>{
    u3SelectedPart=part??null;
    $("mapblock-selected").textContent="R02 · "+data.source.mapId+
      " · SHA-256 "+data.source.sourceDigest+" · клетка ("+
      [cell.x,cell.y,data.floor].join(",")+") · "+
      (part ? part.sourcePartRef+" · "+u3Name(part.part)+" · "+
        part.dataset+" №"+part.record+" · sourceIndex="+part.sourceIndex
        : "частей: "+present.length+"; выберите исходную часть для Source/R04/R06.");
    for(const n of parts.querySelectorAll("button"))
      n.setAttribute("aria-pressed",String(part?.sourcePartRef===n.dataset.sourcePartRef));
  };
  for(const part of present){
    const b=document.createElement("button");
    b.type="button";b.dataset.sourcePartRef=part.sourcePartRef;
    b.textContent=u3Name(part.part)+" · "+part.dataset+" №"+part.record;
    b.addEventListener("click",()=>{
      if(!b.isConnected||!u3Active||u3FloorData!==data||
         !present.includes(part)||u3SelectedCell!==cell)return;
      show(part);b.focus();
    });
    parts.append(b);
  }
  show(null);
  $("mapblock-open-source").disabled=false;
  if(button&&focus)button.focus();
}
function u3RenderFloor(data) {
  const grid=$("mapblock-grid");grid.replaceChildren();
  grid.style.gridTemplateColumns="repeat("+data.width+",42px)";
  const buttons=[];
  for(let y=0;y<data.height;y++)for(let x=0;x<data.width;x++){
    const present=data.cells.get(y*data.width+x)??[];
    const b=document.createElement("button");
    b.type="button";b.className="mapblock-cell";
    b.dataset.x=String(x);b.dataset.y=String(y);
    b.dataset.count=String(present.length);
    b.setAttribute("aria-label","Клетка "+x+","+y+" этаж "+data.floor+
      ", нативных частей "+present.length);
    b.setAttribute("aria-pressed","false");
    b.textContent=x+","+y+" · "+present.length;
    const cell={x,y};
    b.addEventListener("click",()=>{
      if(!b.isConnected||!u3Active||u3FloorData!==data||
         $("mapblock-floor").value!==String(data.floor)||
         !$("mapblock-grid").contains(b)||data.source!==inspectedMap)return;
      u3CellSelect(cell,b,true);
    });
    b.addEventListener("keydown",e=>{
      if(!["ArrowRight","ArrowLeft","ArrowUp","ArrowDown","Home","End"].includes(e.key))return;
      e.preventDefault();
      const [dx,dy]=e.key==="ArrowRight"?[1,0]:e.key==="ArrowLeft"?[-1,0]:
        e.key==="ArrowDown"?[0,1]:e.key==="ArrowUp"?[0,-1]:[0,0];
      const nx=e.key==="Home"?0:e.key==="End"?data.width-1:
        Math.max(0,Math.min(data.width-1,x+dx));
      const ny=e.key==="Home"?0:e.key==="End"?data.height-1:
        Math.max(0,Math.min(data.height-1,y+dy));
      buttons[ny*data.width+nx]?.focus();
    });
    grid.append(b);buttons.push(b);
  }
  if(buttons.length)u3CellSelect({x:0,y:0});
}
async function u3LoadFloor() {
  const current=inspectedMap,raw=$("mapblock-floor").value;
  if(!u3Active||sourceMode!=="catalog"||!current||!catalog||
     !/^(0|[1-9]\d*)$/.test(raw))return;
  u3Retire();
  const token=u3Epoch,floor=Number(raw),[w,h,z]=current.dimensions;
  if(!Number.isInteger(floor)||floor<0||floor>=z||
     !((w===10&&h===10)||(w===20&&h===20))) {
    u3Status("UNSUPPORTED_U3_SCOPE · нативные размеры "+
      current.dimensions.join("×")+"; просмотр 2D ограничен 10×10 и 20×20.");
    return;
  }
  const check=()=>{
    if(token!==u3Epoch||!u3Active||current!==inspectedMap||
       sourceMode!=="catalog"||mapMenu.value!==current.mapId||
       $("mapblock-floor").value!==raw)
      throw Error("E_U3_CANCELLED");
  };
  let worker=null;
  const controller=new AbortController();
  u3Abort=controller;
  u3Status("LOADING_NATIVE_R02 · "+current.mapId+" · Z="+floor+
    " · ожидается весь этаж, без частичного отображения.");
  try{
    worker=new Worker("./engine/worker.mjs",{type:"module"});
    u3Worker=worker;
    const call=connection(worker,controller.signal);
    await call({action:"clear"});
    const inputs=current.inputs;
    for(const [name,input] of inputs) {
      const bytes=input instanceof Uint8Array?input:new Uint8Array(await input.arrayBuffer());
      check();
      for(let start=0;start<bytes.length;start+=CHUNK){
        await call({action:"append",file:name,offset:start,
                    hex:hex(bytes.subarray(start,start+CHUNK))});
        check();
      }
    }
    const rows=[],refs=new Set();
    let offset=0,total=null,last=-1,finished=false;
    for(let n=0;n<U3_MAX_PAGES;n++){
      check();
      const {catalog:page}=await call({
        action:"catalog-placements",map:current.mapId,floor,
        offset,limit:U3_PAGE,sourceDigest:current.sourceDigest});
      check();
      last=u3CheckPage(page,current,floor,offset,total,last);
      if(total===null)total=page.total;
      for(const p of page.placements){
        if(refs.has(p.sourcePartRef))throw Error("E_U3_NATIVE_DUPLICATE");
        refs.add(p.sourcePartRef);rows.push(p);
      }
      if(page.nextOffset===null){finished=true;break}
      if(page.nextOffset<=offset)throw Error("E_U3_NATIVE_PAGE");
      offset=page.nextOffset;
    }
    if(!finished||rows.length!==total)throw Error("E_U3_PAGE_LIMIT");
    check();
    const cells=new Map();
    for(const p of rows){
      const key=p.tile[1]*w+p.tile[0];
      if(!cells.has(key))cells.set(key,[]);
      const list=cells.get(key);
      if(list.some(x=>x.partIndex===p.partIndex))throw Error("E_U3_NATIVE_DUPLICATE");
      list.push(p);
    }
    const data={source:current,floor,width:w,height:h,cells,rows,total};
    check();
    u3FloorData=data;u3RenderFloor(data);
    u3Status("SOURCE_LAYOUT_2D · "+current.mapId+" · "+w+"×"+h+"×"+z+
      " · Z="+floor+" · клеток "+w*h+" · исходных частей "+total+
      " · SHA-256 "+current.sourceDigest.slice(0,12)+"… (не подлинность).");
  }catch(error){
    if(token===u3Epoch&&u3Active&&current===inspectedMap){
      u3FloorData=null;$("mapblock-grid").replaceChildren();
      u3Status("E_U3_FLOOR · "+error.message+" · неполный этаж не отображается.");
    }
  }finally{
    worker?.terminate();
    if(u3Worker===worker){u3Worker=null;u3Abort=null}
  }
}
function u3SetActive(active){
  // Every workspace transition invalidates an earlier Source transfer.
  ++u3TransferEpoch;
  u3Active=active;
  if(!active){
    if(u3Worker){
      u3Retire();
      u3Status("READY · повторно откройте MapBlock для чтения этажа.");
    }
    return;
  }
  u3RenderLibrary();
  if(inspectedMap && !$("mapblock-floor").disabled && !u3FloorData)
    void u3LoadFloor();
}
$("mapblock-library").addEventListener("change",()=>{
  const id=$("mapblock-library").value;
  if(!catalog?.maps.has(id))return;
  if(mapMenu.value===id && inspectedMap?.mapId===id)return;
  mapMenu.value=id;
  mapMenu.dispatchEvent(new Event("change",{bubbles:true}));
});
$("mapblock-floor").addEventListener("change",()=>void u3LoadFloor());
$("mapblock-open-source").addEventListener("click",()=>{
  const data=u3FloorData,part=u3SelectedPart,cell=u3SelectedCell;
  if(!data || data.source!==inspectedMap || !u3Active ||
     $("mapblock-floor").value!==String(data.floor))return;
  // A cell without an explicitly chosen part navigates, but does not claim
  // to bind a SourcePartRef or change the existing Source selection.
  if(!part){
    document.querySelector('#studio-workspaces [data-workspace="source"]').click();
    return;
  }
  const rows=data.rows,index=rows.indexOf(part);
  if(index<0 || !cell ||
     part.tile[0]!==cell.x || part.tile[1]!==cell.y ||
     part.tile[2]!==data.floor ||
     !data.cells.get(cell.y*data.width+cell.x)?.includes(part))return;
  const target={mapId:data.source.mapId,sourceDigest:data.source.sourceDigest,
    floor:data.floor,offset:Math.floor(index/U3_PAGE)*U3_PAGE,
    sourcePartRef:part.sourcePartRef,tile:[...part.tile],
    part:part.part,dataset:part.dataset,record:part.record,
    sourceIndex:part.sourceIndex,rightHalf:part.rightHalf};
  // Navigate first, then perform the only authorized Source selection path.
  document.querySelector('#studio-workspaces [data-workspace="source"]').click();
  const token=u3TransferEpoch,current=data.source;
  if(document.body.dataset.workspace!=="source" || inspectedMap!==current ||
     sourceMode!=="catalog")return;
  selectedPlacement=null;
  $("source-floor").value=String(target.floor);
  invalidateRun();renderSelectedPlacement();
  const epoch=generation,previousPageEpoch=placementEpoch;
  const pending=loadPlacementPage(target.floor,target.offset);
  const newPageEpoch=placementEpoch;
  const stillCurrent=()=>token===u3TransferEpoch && epoch===generation &&
    inspectedMap===current && sourceMode==="catalog" &&
    document.body.dataset.workspace==="source" &&
    $("source-floor").value===String(target.floor) &&
    placementEpoch===newPageEpoch;
  void (async()=>{
    await pending;
    if(!stillCurrent())return; // source/floor/tab changed during genuine R02
    const page=placementPage;
    const nativePart=page?.placements?.find(p=>p.sourcePartRef===target.sourcePartRef);
    const same=page?.map===target.mapId &&
      page?.sourceDigest===target.sourceDigest &&
      page?.floor===target.floor && page?.offset===target.offset &&
      nativePart && nativePart.part===target.part &&
      nativePart.dataset===target.dataset && nativePart.record===target.record &&
      nativePart.sourceIndex===target.sourceIndex &&
      nativePart.rightHalf===target.rightHalf &&
      nativePart.tile.length===3 &&
      nativePart.tile.every((n,i)=>n===target.tile[i]);
    const button=[...$("source-grid").querySelectorAll("button[data-source-part-ref]")]
      .find(node=>node.dataset.sourcePartRef===target.sourcePartRef);
    if(newPageEpoch===previousPageEpoch || !same || !button?.isConnected){
      $("source-placement-status").textContent="E_U3_SOURCE_TRANSFER · не удалось подтвердить выбранную часть на странице R02.";
      return;
    }
    // Execute the native Source page's existing trusted R04/R06 selection
    // callback: never assign a candidate directly to selectedPlacement.
    button.click();
    if(selectedPlacement?.sourcePartRef!==target.sourcePartRef)
      $("source-placement-status").textContent="E_U3_SOURCE_TRANSFER · исходный тип R04 не подтверждён.";
  })().catch(error=>{
    if(stillCurrent())$("source-placement-status").textContent=
      "E_U3_SOURCE_TRANSFER · "+error.message;
  });
});
// D4-U0 UI-only coordinator: Worker and scene owners remain the existing modules.
// Keep the legacy whole-object controls accessible in Source during this migration.
function startStudioWorkspaces() {
  const names=Object.freeze({
    source:["Источник","Локальный каталог, оригинальный R04, R06, сравнение R05 и OBJ."],
    object:["Объект","D4-U2: локальные ObjectHypothesis по настоящим SourcePartRef — только гипотезы. Сборка whole R06 остаётся независимой."],
    mapblock:["MapBlock · SOURCE_LAYOUT_2D","D4-U3: только исходный 2D MAP по нативным R02 и имена ROUTES/RMP, без реконструкции или маршрутизации."],
    map:["Карта · NOT_IMPLEMENTED","Конструктор 50×50, выбор экземпляров и 3D-отрисовка карт пока не реализованы."],
    world:["Мир · RESEARCH_ONLY","Фрактальный мир и выбор графического backend исследуются. Генерация недоступна."]
  });
  const tabs=[...document.querySelectorAll("#studio-workspaces [data-workspace]")];
  const placeholder=$("studio-workspace-placeholder"),heading=$("studio-workspace-heading"),
        description=$("studio-workspace-description"),inspector=$("studio-workspace-context");
  let workspace="source",wholeAvailable=false,preferredView="source";
  const render=()=>{
    document.body.dataset.workspace=workspace;
    const useWhole=wholeAvailable&&(workspace==="object"||(workspace==="source"&&preferredView==="whole"));
    const useSource=workspace==="source"&&!useWhole;
    $("preview").hidden=!useSource;
    const whole=document.getElementById("whole-preview"); // owner can replace canvas node
    if(whole)whole.hidden=!useWhole;
    const empty=(workspace==="map"||workspace==="world")||(workspace==="object"&&!useWhole);
    $("mapblock-inspector").hidden=workspace!=="mapblock";
    placeholder.hidden=!empty;
    if(empty){
      heading.textContent=names[workspace][0];
      const owner=$("whole-status");
      description.textContent=workspace!=="object"?names[workspace][1]
        :owner.dataset.state==="COMPLETED"
          ? "COMPLETED · Сборка проверена, но графический viewport недоступен. Метрики и артефакты остаются в инструментах объекта."
          :owner.textContent||names[workspace][1];
    }
    $("view-toolbar").hidden=!useSource;
    $("hint").hidden=!useSource;
    $("whole-views").hidden=!useWhole;
    $("whole-view-status").hidden=!useWhole;
    inspector.textContent=names[workspace][1];
    for(const tab of tabs){
      if(tab.dataset.workspace===workspace)tab.setAttribute("aria-current","page");
      else tab.removeAttribute("aria-current");
    }
  };
  const select=next=>{
    if(!Object.hasOwn(names,next))return;
    workspace=next;renderObjectDraft(); preferredView=next==="object"?"whole":"source";
    u3SetActive(next==="mapblock");
    // No fake change events, no new Worker, no source/run invalidation on navigation.
    render();
  };
  for(let i=0;i<tabs.length;i++){
    const tab=tabs[i];
    tab.addEventListener("click",()=>select(tab.dataset.workspace));
    tab.addEventListener("keydown",e=>{
      let j=i;
      if(e.key==="ArrowRight")j=(i+1)%tabs.length;
      else if(e.key==="ArrowLeft")j=(i+tabs.length-1)%tabs.length;
      else if(e.key==="Home")j=0;
      else if(e.key==="End")j=tabs.length-1;
      else return;
      e.preventDefault();tabs[j].focus();select(tabs[j].dataset.workspace);
    });
  }
  document.addEventListener("fgm-studio:whole-visibility",e=>{
    wholeAvailable=e.detail?.show===true; // owner reports renderability, not model authenticity
    if(workspace==="source")preferredView=wholeAvailable?"whole":"source";
    render();
  });
  // Whole ERROR/COMPLETED may follow a viewport event asynchronously.
  document.addEventListener("fgm-studio:whole-status",()=>{
    if(workspace==="object")render();
  });
  render();
}
startStudioWorkspaces();
