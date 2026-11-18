import {copyFile,mkdir,readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const module=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const wasm=resolve(module,'../build/wasm/web'),output=join(module,'build/web');
await mkdir(output,{recursive:true});
for(const name of ['index.html','sphere.fgm.json','scene.wgsl','camera.html','camera.wgsl'])
  await copyFile(join(module,'web',name),join(output,name));
for(const name of ['fgm_scene.mjs','fgm_scene.wasm']){
  const from=join(wasm,name);if(!(await readFile(from)).length)throw Error('E_RENDERER_EMPTY_WASM_ASSET');
  await copyFile(from,join(output,name));
}
