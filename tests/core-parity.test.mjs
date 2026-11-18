// Independent native public-API consumer against the existing JS semantic witness.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preparePackage,parsePackage,serializePackage,identifyPackage,deriveSeed} from '../core/tests/fgm-serialization-witness.mjs';

const binary=process.argv[2];
assert.ok(binary,'native binary argument required');
const fixture=fileURLToPath(new URL('../core/tests/fixtures/c04-panel.fgm.json',import.meta.url));
const bytes=readFileSync(fixture),pkg=parsePackage(bytes),reference=preparePackage(pkg);
assert.deepEqual(serializePackage(pkg),bytes);
const expected=JSON.parse(readFileSync(new URL('../core/tests/fixtures/c04-panel-expected.json',import.meta.url)));
assert.deepEqual(identifyPackage(pkg),{model:expected.model,package:expected.package});
assert.equal(deriveSeed(pkg,'detail'),expected.detailSeed);
const points=[];
for(let z=0;z<24;z++)for(let y=0;y<16;y++)for(let x=0;x<16;x++)points.push([x+0.5,y+0.5,z+0.5]);
points.push([0,0,0],[1,0,0],[1,1,0],[2,1,0],[3,0,0]);
const run=(...args)=>execFileSync(binary,[fixture,...args],{encoding:'utf8',maxBuffer:8*1024*1024});
const forward=run();assert.equal(run(),forward,'repeat must preserve output bytes');
const parse=raw=>{
  const records=new Map();
  for(const line of raw.trim().split(/\r?\n/)){
    const [id,value,material,contributor,...rest]=line.split('\t');
    const index=Number(id),field=Number(value);
    assert.ok(!rest.length && Number.isInteger(index)&&index>=0&&index<points.length&&!records.has(index));
    assert.ok(Number.isFinite(field));
    records.set(index,{value:field,material:material==='-'?null:material,contributor:contributor==='-'?null:contributor});
  }
  assert.equal(records.size,points.length);return records;
};
const samples=parse(forward),reverse=parse(run('--reverse'));
let occupied=0;
for(let i=0;i<points.length;i++){
  const actual=samples.get(i),want=reference(points[i]);
  assert.ok(Math.abs(actual.value-want.value)<=1e-12*Math.max(1,Math.abs(want.value)),`field ${i}`);
  assert.equal(actual.value<0,want.value<0,`occupancy ${i}`);
  assert.equal(actual.material,want.material,`material ${i}`);
  assert.equal(actual.contributor,want.contributor,`contributor ${i}`);
  assert.deepEqual(actual,reverse.get(i),`query order ${i}`);
  if(i<6144&&actual.value<0)occupied++;
}
assert.ok(occupied>0&&occupied<6144,'grid must include occupied and empty samples');
assert.equal(samples.get(6145).material,'metal');
assert.equal(samples.get(6147).value,0);
const temp=mkdtempSync(join(tmpdir(),'fgmp-core-invalid-'));
try {
  const bad=structuredClone(pkg);bad.interpreter='fgm-0/unsupported';
  const path=join(temp,'invalid.json');writeFileSync(path,JSON.stringify(bad));
  const result=spawnSync(binary,[path],{encoding:'utf8'});
  assert.equal(result.status,1);assert.match(result.stderr,/E_PACKAGE_VERSION/);
} finally {rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({result:'PASS',centers:6144,anchors:5,occupied,
  fields_materials_contributors:'MATCH',canonical_bytes_hashes_seeds:'MATCH',repeat_bytes:'MATCH',
  reverse_queries:'MATCH',invalid_version:'REJECTED'}));
