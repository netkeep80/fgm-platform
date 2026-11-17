// Сборка разрешённого набора файлов Studio из точных ревизий.
import { createHash } from "node:crypto";
import { mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const engine = JSON.parse(await readFile(new URL("../studio/engine-lock.json", import.meta.url), "utf8"));
if(process.argv.length!==3)throw Error("usage: node scripts/build-studio-s2a.mjs <accepted-regenerator-wasm-dir>");
if(!/^[a-f0-9]{40}$/.test(engine?.regenerator??"") ||
   process.env.STUDIO_REGENERATOR_REV!==engine.regenerator)throw Error("E_STUDIO_SOURCE_REVISION");
const renderer=process.env.STUDIO_RENDERER_REV??"";
if(!/^[a-f0-9]{40}$/.test(renderer))throw Error("E_STUDIO_RENDERER_REVISION");
const src=resolve(process.argv[2]),dest=resolve("build/studio");
const entries=[
  ["studio/index.html","index.html"],
  ["studio/studio-app.mjs","studio-app.mjs"],
  ["studio/whole-ui.mjs","whole-ui.mjs"],
  ["studio/r05-view.mjs","r05-view.mjs"],
  ["studio/ufo-catalog.mjs","ufo-catalog.mjs"],
  ["studio/synthetic.mjs","synthetic.mjs"],
  [join(src,"worker.mjs"),"engine/worker.mjs"],
  [join(src,"fgmr-studio.mjs"),"engine/fgmr-studio.mjs"],
  [join(src,"fgmr-studio.wasm"),"engine/fgmr-studio.wasm"]
];
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
await rm(dest,{recursive:true,force:true});
const hashes={};
for(const [from,name] of entries) {
  const bytes=await readFile(from);
  if(!bytes.length)throw Error("E_STUDIO_EMPTY_ASSET");
  if(name.endsWith(".wasm") &&
     (bytes[0]!==0 || bytes[1]!==97 || bytes[2]!==115 || bytes[3]!==109))
    throw Error("E_STUDIO_WASM_MAGIC");
  const output=join(dest,name);
  await mkdir(resolve(output,".."),{recursive:true});
  await copyFile(from,output);
  hashes[name]=digest(bytes);
}
await writeFile(join(dest,"studio-manifest.json"),
  JSON.stringify({schema:"fgmv-studio-ufo-catalog/2",renderer,regenerator:engine.regenerator,engine,assets:hashes},null,2)+"\n");
console.log("STUDIO_UFO_CATALOG_BUNDLE_PASS: "+entries.length+" allowlisted assets; no game files");
