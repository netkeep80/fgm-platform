// Один пакет Studio из текущего Platform checkout и его root WASM build.
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rm,lstat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const git=(...args)=>execFileSync('git',['-C',repo,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const ensure=(value,code)=>{if(!value)throw Error(code)};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function buildStudio(wasmDirectory,outputDirectory=resolve(repo,'renderer/build/studio')){
  const src=resolve(wasmDirectory),dest=resolve(outputDirectory);
  ensure(dest!==src&&!src.startsWith(dest+'/')&&dest!==repo&&!repo.startsWith(dest+'/')&&
    (!dest.startsWith(repo+'/')||dest.startsWith(repo+'/renderer/build/')),'E_STUDIO_OUTPUT_DIRECTORY');
  const directory=await lstat(src);ensure(directory.isDirectory()&&!directory.isSymbolicLink(),'E_STUDIO_ASSET_TYPE');
  ensure(git('diff','--name-only','HEAD','--')==='','E_STUDIO_DIRTY_SOURCE');
  const revision=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  const metadata=JSON.parse(await readFile(join(src,'platform-build.json'),'utf8'));
  ensure(metadata.schema==='fgmp-build/1'&&metadata.revision===revision&&metadata.tree===tree,
    'E_STUDIO_SOURCE_REVISION');
  const engine=JSON.parse(await readFile(join(repo,'renderer/studio/engine-lock.json'),'utf8'));
  ensure(engine.schema==='fgmp-studio-engine/1'&&/^[a-f0-9]{40}$/.test(engine.core)&&
    engine.workerProtocol===1&&engine.wholeBuild==='r06-whole-build/1'&&!('regenerator' in engine),
    'E_STUDIO_ENGINE_CONTRACT');
  const entries=[...['index.html','studio-app.mjs','whole-ui.mjs','r05-view.mjs','ufo-catalog.mjs','synthetic.mjs']
    .map(name=>[join(repo,'renderer/studio',name),name]),
    ...['worker.mjs','fgmr-studio.mjs','fgmr-studio.wasm'].map(name=>[join(src,'regenerator',name),'engine/'+name])];
  const files=new Map();let size=0;
  for(const [from,name]of entries){
    const stat=await lstat(from);ensure(stat.isFile()&&!stat.isSymbolicLink(),'E_STUDIO_ASSET_TYPE');
    ensure(stat.size>0&&stat.size<=16*1024*1024,'E_STUDIO_EMPTY_OR_LARGE_ASSET');
    const bytes=await readFile(from);size+=bytes.length;
    if(name.endsWith('.wasm'))ensure(bytes.subarray(0,8).equals(Buffer.from('0061736d01000000','hex')),'E_STUDIO_WASM_MAGIC');
    files.set(name,bytes);
  }
  ensure(size<=16*1024*1024,'E_STUDIO_BUNDLE_SIZE');
  await rm(dest,{recursive:true,force:true});
  for(const [name,bytes]of files){const path=join(dest,name);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
  const manifest={schema:'fgmp-studio-bundle/1',platform:{revision,tree},engine,
    assets:Object.fromEntries([...files].map(([name,bytes])=>[name,digest(bytes)]))};
  await writeFile(join(dest,'studio-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('PLATFORM_STUDIO_BUNDLE_PASS: '+entries.length+' allowlisted assets; exact Platform revision/tree; no game files');
  return manifest;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length<3||process.argv.length>4)throw Error('usage: node build-studio-s2a.mjs <root-wasm-build> [output]');
  await buildStudio(process.argv[2],process.argv[3]);
}
