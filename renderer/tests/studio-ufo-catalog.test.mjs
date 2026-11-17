import assert from "node:assert/strict";
import test from "node:test";
import { catalogElementKey, indexGameFolder, resolveFile } from "../studio/ufo-catalog.mjs";

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
