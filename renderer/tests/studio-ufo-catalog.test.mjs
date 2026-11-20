import assert from "node:assert/strict";
import test from "node:test";
import { catalogElementKey, indexGameFolder, resolveFile, verifyCatalogThumbnails } from "../studio/ufo-catalog.mjs";

test("индекс хранит выбранные File по точному пути и исключает нетактические каталоги", () => {
  const map={webkitRelativePath:"Игра/Maps/Culta00.map"};
  const other={webkitRelativePath:"Игра/GEOGRAPH/INTICON.MAP"};
  const {index,request}=indexGameFolder([other,map]);
  assert.deepEqual(request,{action:"catalog-directory",paths:[map.webkitRelativePath]});
  assert.equal(resolveFile(index,map.webkitRelativePath),map);
  assert.throws(()=>resolveFile(index,map.webkitRelativePath.toUpperCase()),/E_STUDIO_CATALOG_BINDING/);
  assert.throws(()=>indexGameFolder([map,map]),/E_STUDIO_DUPLICATE_FILE/);
});

test("предел транспорта измеряется в байтах UTF-8 для полного JSON", () => {
  const files=Array.from({length:260},(_,i)=>({webkitRelativePath:"я".repeat(240)+"/MAPS/"+i+".MAP"}));
  assert.doesNotThrow(()=>indexGameFolder(files));
  files.push(...Array.from({length:10},(_,i)=>({webkitRelativePath:"ю".repeat(240)+"/MAPS/"+i+".MAP"})));
  assert.throws(()=>indexGameFolder(files),/E_STUDIO_CATALOG_INDEX_LIMIT/);
});

test("ключ отличает карту, сторону и клетку одного исходного элемента", () => {
  const element={part:"north_wall",dataset:"CULTIVAT",record:3,rightHalf:false,tile:[1,2,0]};
  const key=catalogElementKey("CULTA00",element);
  assert.equal(key,catalogElementKey("CULTA00",{...element,name:"Другое отображаемое имя"}));
  assert.notEqual(key,catalogElementKey("CULTA01",element));
  assert.notEqual(key,catalogElementKey("CULTA00",{...element,rightHalf:true}));
  assert.notEqual(key,catalogElementKey("CULTA00",{...element,tile:[2,1,0]}));
});


const thumbPalette=Array.from({length:256},()=>[0,0,0]);
thumbPalette[10]=[252,0,0];thumbPalette[20]=[0,252,0];
const spriteHex=index=>Array.from({length:1280},(_,i)=>i===20?index:0)
  .map(x=>x.toString(16).padStart(2,"0")).join("");
const data=()=>({schema:"fgmr-ufo-catalog-thumbnails/1",dataset:"FOREST",frameSlot:0,
  palette_rgb8:thumbPalette,items:[
    {record:4,frameId:0,indices_hex:spriteHex(10)},
    {record:5,frameId:1,indices_hex:spriteHex(20)}
  ]});

test("R04 batch verifies exact record binding and indexed palette pixels",()=>{
  const values=verifyCatalogThumbnails(data(),"FOREST",[4,5],0);
  assert.deepEqual(values.get(4).palette[10],[252,0,0]);
  assert.equal(values.get(4).indices[20],10);
  assert.equal(values.get(5).indices[20],20);
  assert.equal(values.get(4).indices[0],0);
  assert.notEqual(values.get(4).indices,values.get(5).indices);
});

test("R04 batch rejects spoofed dataset, duplicates, invalid palette and size",()=>{
  assert.throws(()=>verifyCatalogThumbnails(data(),"DESERT",[4,5],0),/E_STUDIO_THUMB_BINDING/);
  assert.throws(()=>verifyCatalogThumbnails(data(),"FOREST",[4,4],0),/E_STUDIO_THUMB_BINDING/);
  assert.throws(()=>verifyCatalogThumbnails({...data(),frameSlot:1},"FOREST",[4,5],0),
    /E_STUDIO_THUMB_BINDING/);
  assert.throws(()=>verifyCatalogThumbnails({...data(),palette_rgb8:Array(256).fill([400,0,0])},
    "FOREST",[4,5],0),/E_STUDIO_THUMB_PIXELS/);
  const broken=data();broken.items[0].indices_hex="ffffff";
  assert.throws(()=>verifyCatalogThumbnails(broken,"FOREST",[4,5],0),/E_STUDIO_THUMB_PIXELS/);
  const spoof=data();spoof.items[1].record=4;
  assert.throws(()=>verifyCatalogThumbnails(spoof,"FOREST",[4,5],0),/E_STUDIO_THUMB_BINDING/);
});

test("R04 per-entry typed error is preserved without a fake generic sprite",()=>{
  const broken=data();broken.items[1]={record:5,error:"E_R04_TAB_OFFSET"};
  const values=verifyCatalogThumbnails(broken,"FOREST",[4,5],0);
  assert.equal(values.get(5).error,"E_R04_TAB_OFFSET");
  assert.equal(values.get(5).indices,undefined);
  assert.equal(values.get(4).indices.length,1280);
});
