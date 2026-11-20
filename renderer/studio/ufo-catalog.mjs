const requestLimit = 128 * 1024;
const pathLimit = 4096;
const encoder = new TextEncoder();
// Filter transport paths only; the worker owns profiles, ordering and classification.
const candidatePath = /(?:^|\/)(?:MAPS|TERRAIN|GEODATA)\/[^/]+$/i;

export function indexGameFolder(files) {
  const index = new Map();
  for (const file of files) {
    const path = file.webkitRelativePath;
    if (!path || !candidatePath.test(path)) continue;
    if (index.has(path)) throw Error("E_STUDIO_DUPLICATE_FILE");
    if (index.size === pathLimit) throw Error("E_STUDIO_CATALOG_INDEX_LIMIT");
    index.set(path,file);
  }
  if (!index.size) throw Error("E_STUDIO_CATALOG_ROOT");
  const request = {action:"catalog-directory",paths:[...index.keys()]};
  if (encoder.encode(JSON.stringify({v:1,...request})).length > requestLimit)
    throw Error("E_STUDIO_CATALOG_INDEX_LIMIT");
  return {index,request};
}

export function resolveFile(index,path) {
  const file = index.get(path);
  if (!file) throw Error("E_STUDIO_CATALOG_BINDING");
  return file;
}

export function catalogElementKey(mapId,entry) {
  return JSON.stringify([mapId,entry.part,entry.dataset,entry.record,entry.rightHalf,entry.tile]);
}


const spriteWidth=32, spriteHeight=40, spriteRows=64, windowRows=16, maxCache=48, maxBatch=8;
const thumbError = code => { throw Error(code); };

export function verifyCatalogThumbnails(data,dataset,records,slot) {
  if(data?.schema!=="fgmr-ufo-catalog-thumbnails/1" ||
     data.dataset!==dataset || data.frameSlot!==slot ||
     !Array.isArray(data.items) || data.items.length!==records.length ||
     new Set(records).size!==records.length || records.length<1 || records.length>maxBatch)
    thumbError("E_STUDIO_THUMB_BINDING");
  const palette=data.palette_rgb8;
  const hasPalette=Array.isArray(palette) && palette.length===256 &&
    palette.every(rgb=>Array.isArray(rgb) && rgb.length===3 &&
      rgb.every(v=>Number.isInteger(v) && v>=0 && v<=255));
  const result=new Map();
  for(const item of data.items){
    if(!item || !Number.isInteger(item.record) || !records.includes(item.record) ||
       result.has(item.record))thumbError("E_STUDIO_THUMB_BINDING");
    if(typeof item.error==="string" && /^E_R04_[A-Z0-9_]+$/.test(item.error) &&
       !("indices_hex" in item)){
      result.set(item.record,{error:item.error});continue;
    }
    if(!hasPalette || !Number.isInteger(item.frameId) || item.frameId<0 || item.frameId>255 ||
       typeof item.indices_hex!=="string" || !/^[0-9a-f]{2560}$/.test(item.indices_hex))
      thumbError("E_STUDIO_THUMB_PIXELS");
    result.set(item.record,{palette,indices:Uint8Array.from(
      item.indices_hex.match(/../g),value=>parseInt(value,16))});
  }
  if(result.size!==records.length)thumbError("E_STUDIO_THUMB_BINDING");
  return result;
}

export function paintCatalogSprite(canvas,sprite,rightHalf=false) {
  if(sprite?.indices?.length!==spriteWidth*spriteHeight ||
     !Array.isArray(sprite.palette) || sprite.palette.length!==256)
    thumbError("E_STUDIO_THUMB_PIXELS");
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  if(!ctx)thumbError("E_STUDIO_THUMB_CANVAS");
  const image=ctx.createImageData(spriteWidth,spriteHeight);
  for(let i=0;i<sprite.indices.length;i++){
    const index=sprite.indices[i],pos=i*4;
    if(index===0 || (rightHalf && i%spriteWidth<16))continue;
    const rgb=sprite.palette[index];
    if(!Array.isArray(rgb) || rgb.length!==3)thumbError("E_STUDIO_THUMB_PIXELS");
    image.data.set([rgb[0],rgb[1],rgb[2],255],pos);
  }
  ctx.clearRect(0,0,spriteWidth,spriteHeight);
  ctx.putImageData(image,0,0);
  canvas.hidden=false;
}

// Only the currently scrolled 16 rows exist in the DOM. Sprite bytes stay in
// memory, with 8-record decode batches and a 48-frame LRU; never localStorage.
export class ElementSpritePicker {
  constructor({button,listbox,decode,onChoose}){
    this.button=button;this.listbox=listbox;this.decode=decode;this.onChoose=onChoose;
    this.icon=button.querySelector("canvas");this.label=button.querySelector("#catalog-element-text");
    this.items=[];this.cache=new Map();this.epoch=0;this.controller=null;
    this.busy=false;this.opened=false;this.active=0;this.slot=0;this.paletteIndex=0;
    button.addEventListener("click",()=>this.opened?this.close():this.open());
    button.addEventListener("keydown",ev=>this.keydown(ev));
    listbox.addEventListener("scroll",()=>this.render());
    document.addEventListener("pointerdown",ev=>{
      if(this.opened && !button.parentElement.contains(ev.target))this.close();
    });
  }
  cancelPending(){
    ++this.epoch;
    this.controller?.abort();
    this.controller=null;
    this.busy=false;
  }
  reset(){
    this.cancelPending();this.close();this.items=[];this.cache.clear();
    this.listbox.replaceChildren();
    this.button.value="";this.button.disabled=true;
    this.label.textContent="— выбрать элемент —";
    this.icon.hidden=true;this.icon.getContext("2d")?.clearRect(0,0,32,40);
  }
  load(entries,{slot=0,paletteIndex=0}={}){
    this.reset();
    this.slot=slot;this.paletteIndex=paletteIndex;
    this.items=entries.map(([key,entry])=>({
      key,entry,label:entry.name+" ("+entry.dataset+" № "+entry.record+")"+
        (entry.rightHalf?" · правая половина кадра":"")
    }));
    this.button.disabled=!this.items.length;
    this.active=0;
  }
  open(){
    if(this.button.disabled || this.opened)return;
    this.opened=true;this.listbox.hidden=false;
    this.button.setAttribute("aria-expanded","true");
    const previous=this.items.findIndex(x=>x.key===this.button.value);
    this.active=previous<0?0:previous;
    this.listbox.scrollTop=Math.max(0,this.active-2)*spriteRows;
    this.render();
  }
  close(){
    this.opened=false;this.listbox.hidden=true;
    this.button.setAttribute("aria-expanded","false");
    this.button.removeAttribute("aria-activedescendant");
  }
  keydown(event){
    const k=event.key;
    if(k==="Escape"){
      if(this.opened){event.preventDefault();this.close()}return;
    }
    if(k==="Tab"){this.close();return}
    if(k==="Enter"||k===" "){
      event.preventDefault();
      if(!this.opened)this.open();
      else this.choose(this.active);
      return;
    }
    if(!["ArrowDown","ArrowUp","Home","End"].includes(k))return;
    event.preventDefault();
    if(!this.opened){this.open();return}
    if(k==="ArrowDown")this.active=Math.min(this.items.length-1,this.active+1);
    if(k==="ArrowUp")this.active=Math.max(0,this.active-1);
    if(k==="Home")this.active=0;
    if(k==="End")this.active=this.items.length-1;
    const top=this.listbox.scrollTop, bottom=top+this.listbox.clientHeight;
    if(this.active*spriteRows<top)this.listbox.scrollTop=this.active*spriteRows;
    if((this.active+1)*spriteRows>bottom)
      this.listbox.scrollTop=(this.active+1)*spriteRows-this.listbox.clientHeight;
    this.render();
  }
  choose(index){
    const item=this.items[index];if(!item)return;
    this.button.value=item.key;this.label.textContent=item.label;
    this.active=index;this.close();this.button.focus();
    this.paintSelected();
    this.onChoose();
    this.queue();
  }
  id(item){return item.entry.dataset+"\u0000"+item.entry.record+"\u0000"+this.slot+"\u0000"+this.paletteIndex}
  remember(key,value){
    this.cache.delete(key);this.cache.set(key,value);
    if(this.cache.size>maxCache)this.cache.delete(this.cache.keys().next().value);
  }
  show(canvas,item,errorNode){
    const record=this.cache.get(this.id(item));
    canvas.hidden=true;
    if(errorNode)errorNode.textContent=record?.error??(record?"":"Загрузка оригинала…");
    if(!record || record.error)return;
    paintCatalogSprite(canvas,record,item.entry.rightHalf===true);
  }
  paintSelected(){
    const item=this.items.find(x=>x.key===this.button.value);
    if(item)this.show(this.icon,item,null);
    else this.icon.hidden=true;
  }
  render(){
    if(!this.opened)return;
    const from=Math.max(0,Math.min(this.items.length,
      Math.floor(this.listbox.scrollTop/spriteRows)-2));
    const to=Math.min(this.items.length,from+windowRows);
    const spacer=height=>{
      const node=document.createElement("div");
      node.className="catalog-space";node.style.height=height+"px";
      node.setAttribute("aria-hidden","true");return node;
    };
    const nodes=[spacer(from*spriteRows)];
    for(let i=from;i<to;i++){
      const item=this.items[i],row=document.createElement("div");
      row.id="catalog-option-"+i;row.dataset.index=String(i);row.className="catalog-option";
      row.role="option";row.setAttribute("aria-selected",String(item.key===this.button.value));
      row.dataset.active=String(i===this.active);
      row.title=item.label;
      const image=document.createElement("canvas");image.width=32;image.height=40;
      image.setAttribute("aria-hidden","true");
      const copy=document.createElement("span");copy.className="catalog-copy";
      const label=document.createElement("span");label.textContent=item.label;
      const error=document.createElement("small");error.className="catalog-error";
      copy.append(label,error);row.append(image,copy);
      row.addEventListener("pointerdown",ev=>ev.preventDefault());
      row.addEventListener("click",()=>this.choose(i));
      this.show(image,item,error);nodes.push(row);
    }
    nodes.push(spacer((this.items.length-to)*spriteRows));
    this.listbox.replaceChildren(...nodes);
    const activeId="catalog-option-"+this.active;
    if(this.listbox.querySelector("#"+activeId))
      this.button.setAttribute("aria-activedescendant",activeId);
    else this.button.removeAttribute("aria-activedescendant");
    this.queue();
  }
  queue(){
    if(this.busy || (!this.opened && !this.button.value))return;
    const top=Math.floor(this.listbox.scrollTop/spriteRows),candidates=[];
    if(this.button.value){
      const chosen=this.items.find(x=>x.key===this.button.value);
      if(chosen)candidates.push(chosen);
    }
    if(this.opened)for(let i=top;i<Math.min(this.items.length,top+9);i++)
      candidates.push(this.items[i]);
    const next=candidates.find(x=>!this.cache.has(this.id(x)));
    if(!next)return;
    const records=[...new Set(candidates.filter(x=>x.entry.dataset===next.entry.dataset &&
      !this.cache.has(this.id(x))).map(x=>x.entry.record))].slice(0,maxBatch);
    this.busy=true;
    const epoch=this.epoch,controller=new AbortController();
    this.controller=controller;
    void (async()=>{
      try{
        const raw=await this.decode(next.entry.dataset,records,controller.signal);
        const data=verifyCatalogThumbnails(raw,next.entry.dataset,records,this.slot);
        if(epoch!==this.epoch || controller.signal.aborted)return;
        for(const [record,value] of data)this.remember(
          next.entry.dataset+"\u0000"+record+"\u0000"+this.slot+"\u0000"+this.paletteIndex,value);
      }catch(error){
        if(epoch===this.epoch && !controller.signal.aborted){
          const code=/^E_[A-Z0-9_]+$/.test(error.message)?error.message:"E_STUDIO_THUMB_RUNTIME";
          for(const record of records)this.remember(next.entry.dataset+
            "\u0000"+record+"\u0000"+this.slot+"\u0000"+this.paletteIndex,{error:code});
        }
      }finally{
        if(epoch===this.epoch){
          this.controller=null;this.busy=false;this.paintSelected();
          if(this.opened)this.render();
          else this.queue();
        }
      }
    })();
  }
}
