import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildStudio} from '../scripts/build-studio-s2a.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
test('current bundle producer: deterministic exact-source assets and typed negative cases',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'fgmp-bundle-'));
  try{
    const input=join(temp,'wasm'),engine=join(input,'regenerator'),out=join(temp,'out');
    await mkdir(engine,{recursive:true});
    const metadata={schema:'fgmp-build/1',revision:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')};
    const save=()=>writeFile(join(input,'platform-build.json'),JSON.stringify(metadata));
    await save();await writeFile(join(engine,'worker.mjs'),'// synthetic worker');
    await writeFile(join(engine,'fgmr-studio.mjs'),'// synthetic module');
    await writeFile(join(engine,'fgmr-studio.wasm'),Buffer.from('0061736d01000000','hex'));
    const first=await buildStudio(input,out),bytes=await readFile(join(out,'studio-manifest.json'));
    await buildStudio(input,out);assert.deepEqual(await readFile(join(out,'studio-manifest.json')),bytes);
    assert.equal(Object.keys(first.assets).length,9);assert.deepEqual(first.platform,{revision:metadata.revision,tree:metadata.tree});
    assert.equal('regenerator' in first,false);assert.equal('regenerator' in first.engine,false);
    metadata.revision='0'.repeat(40);await save();await assert.rejects(buildStudio(input,out),/E_STUDIO_SOURCE_REVISION/);
    metadata.revision=git('rev-parse','HEAD');metadata.tree='0'.repeat(40);await save();await assert.rejects(buildStudio(input,out),/E_STUDIO_SOURCE_REVISION/);
    metadata.tree=git('rev-parse','HEAD^{tree}');await save();
    await writeFile(join(engine,'fgmr-studio.wasm'),'not wasm');await assert.rejects(buildStudio(input,out),/E_STUDIO_WASM_MAGIC/);
    await writeFile(join(engine,'fgmr-studio.wasm'),Buffer.from('0061736d01000000','hex'));
    await writeFile(join(engine,'worker.mjs'),'');await assert.rejects(buildStudio(input,out),/E_STUDIO_EMPTY_OR_LARGE_ASSET/);
    await assert.rejects(buildStudio(input,input),/E_STUDIO_OUTPUT_DIRECTORY/);
  }finally{await rm(temp,{recursive:true,force:true});}
});
