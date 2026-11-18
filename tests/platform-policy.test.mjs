import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stringify} from 'yaml';
import {root,git,parse,checkPlatform} from '../scripts/check-platform.mjs';

test('current Platform integrity, ownership and no-op resistance',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'fgmp-policy-'));
  try{
    execFileSync('git',['clone','--quiet','--shared','--no-checkout',root,temp]);
    const head=git(root,'rev-parse','HEAD');git(temp,'checkout','--quiet','--detach',head);
    git(temp,'config','user.name','FGM synthetic verification');
    git(temp,'config','user.email','synthetic@example.invalid');
    const edit=(path,fn)=>{const p=join(temp,path),value=parse(readFileSync(p));fn(value);writeFileSync(p,stringify(value));};
    await t.test('current audited transition passes',()=>{
      const r=checkPlatform(temp,head);assert.equal(r.required_native_tests,30);
      assert.equal(r.canonical_requirements,80);assert.equal(r.internal_git_fetchcontent,0);
    });
    const req='requirements/regenerator/FGMR-FIT-001.rg.yaml';
    const cases=[
      ['Core implementation drift','core/src/evaluator.cpp','PRESERVED_RESOURCE'],
      ['Python orchestration drift','regenerator/scripts/r07_whole_source_fit.py','PRESERVED_RESOURCE'],
      ['R05 projection drift','regenerator/src/projection.cpp','PRESERVED_RESOURCE'],
      ['changed moved ray implementation','raster/rvi-v02.cpp','PRESERVED_RESOURCE'],
      ['successful but empty root CMake','CMakeLists.txt','CRITICAL_CONTENT'],
      ['external Core consumer CMake','tests/core/consumer/CMakeLists.txt','PRESERVED_RESOURCE'],
      ['weakened historical S04 checker','scripts/check-core-integration.mjs','PRESERVED_RESOURCE'],
      ['historical snapshot manifest','docs/source-snapshots.json','PRESERVED_RESOURCE'],
      ['ordinary CI replaced with echo PASS','.github/workflows/core-ci.yml','CRITICAL_CONTENT'],
      ['scene mathematical implementation drift','renderer/src/scene.cpp','PRESERVED_RESOURCE'],
      ['camera mathematical implementation drift','renderer/src/v03-camera.cpp','PRESERVED_RESOURCE'],
      ['Renderer contracts no-op','renderer/package.json','CRITICAL_CONTENT'],
      ['weakened root guard','.github/workflows/repo-guard.yml','CRITICAL_CONTENT'],
      ['weakened root bootstrap checker','scripts/check-bootstrap.mjs','CRITICAL_CONTENT'],
      ['workspace lock drift','package-lock.json','CRITICAL_CONTENT'],
      ['historical replay removed','.github/workflows/source-snapshots.yml','CRITICAL_CONTENT'],
    ].map(([name,path,code])=>[name,()=>writeFileSync(join(temp,path),'synthetic successful bypass\n'),code]);
    cases.push(
      ['duplicate old ray implementation',()=>writeFileSync(join(temp,'renderer/src/rvi-v02.cpp'),'copy\n'),'DUPLICATE_IMPLEMENTATION'],
      ['new unowned resource',()=>writeFileSync(join(temp,'unowned.txt'),'orphan\n'),'UNDECLARED_NEW_RESOURCE'],
      ['normative drift',()=>edit(req,r=>{r.normative+=' drift';}),'REQUIREMENT_DRIFT'],
      ['lifecycle promotion',()=>edit(req,r=>{r.lifecycle.accepted=true;}),'REQUIREMENT_DRIFT'],
      ['removed verification',()=>edit(req,r=>{r.relations=r.relations.filter(x=>!x.predicates.includes('verified_by'));}),'REQUIREMENT_DRIFT'],
      ['execution constraint drift',()=>edit('requirements/renderer/FGMV-RVI-001.rg.yaml',r=>{r.constraints[0].evidence.key='execution:missing';}),'REQUIREMENT_DRIFT'],
      ['external renderer fetch reintroduced',()=>{
        const p=join(temp,'regenerator/CMakeLists.txt');writeFileSync(p,readFileSync(p,'utf8')+'\ninclude(FetchContent)\n');
      },'CRITICAL_CONTENT|PRESERVED_RESOURCE'],
      ['critical executable mode changed',()=>git(temp,'update-index','--chmod=+x','scripts/check-ctest.mjs'),'CRITICAL_CONTENT'],
    );
    for(const path of ['scripts/check-ctest.mjs','tests/ctest-gate.test.mjs','tests/core-parity.test.mjs',
      'scripts/check-core-consumer.mjs','tests/platform-policy.test.mjs','scripts/verify-repoguard-transition.mjs',
      'scripts/check-document-language.mjs','tests/document-language.test.mjs',
      'renderer/scripts/test-v03.mjs','renderer/scripts/test-v03-map.mjs',
      'raster/scripts/test-v02.mjs','raster/scripts/mutate-v02.mjs'])
      cases.push(['successful no-op '+path,()=>{
        writeFileSync(join(temp,path),'console.log("PASS");\n');
        const r=spawnSync(process.execPath,[join(temp,path)],{encoding:'utf8'});
        assert.equal(r.status,0);assert.match(r.stdout,/PASS/);
      },'CRITICAL_CONTENT|PRESERVED_RESOURCE|MOVED_CONTENT|CONSOLIDATED_CONTENT']);
    cases.push(
      ['duplicate old Raster test',()=>writeFileSync(join(temp,'renderer/tests/rvi-v02.test.cpp'),'copy\n'),'DUPLICATE_IMPLEMENTATION'],
      ['duplicate language checker',()=>{mkdirSync(join(temp,'core/scripts'),{recursive:true});writeFileSync(join(temp,'core/scripts/check-document-language.mjs'),'copy\n');},'DUPLICATE_IMPLEMENTATION'],
      ['retired module lock resurrected',()=>writeFileSync(join(temp,'renderer/package-lock.json'),'{}\n'),'RETIRED_RESOURCE'],
      ['retired Core workflow resurrected',()=>{
        const path=join(temp,'core/.github/workflows');mkdirSync(path,{recursive:true});
        writeFileSync(join(path,'repo-guard.yml'),'name: bypass\n');
      },'RETIRED_RESOURCE'],
      ['moved RVI oracle changed',()=>writeFileSync(join(temp,'raster/tests/rvi-v02.test.cpp'),'int main(){return 0;}\n'),'MOVED_CONTENT'],
      ['transition alias replaced with successful no-op',()=>writeFileSync(join(temp,'renderer/scripts/test-v02.mjs'),'console.log("PASS");\n'),'CRITICAL_CONTENT'],
      ['transition alias removed',()=>rmSync(join(temp,'core/tests/document-language.test.mjs')),'MISSING_TRANSITION_ALIAS|CRITICAL_CONTENT'],
      ['scene verifier successful no-op',()=>writeFileSync(join(temp,'renderer/tests/scene.test.cpp'),'int main(){return 0;}\n'),'CRITICAL_CONTENT'],
    );
    cases.push(['no-op plus historical manifest rewritten',()=>{
      writeFileSync(join(temp,'tests/core-parity.test.mjs'),'console.log("PASS");\n');
      writeFileSync(join(temp,'docs/core-integration.json'),'{}\n');
    },'PRESERVED_RESOURCE|CRITICAL_CONTENT']);
    for(const [name,mutate,code]of cases)await t.test(name,()=>{
      git(temp,'reset','--hard',head);git(temp,'clean','-fd');mutate();git(temp,'add','-A');
      if(name==='critical executable mode changed')git(temp,'update-index','--chmod=+x','scripts/check-ctest.mjs');
      git(temp,'commit','--quiet','-m','synthetic negative current policy');
      assert.throws(()=>checkPlatform(temp,'HEAD'),new RegExp(code));
    });
  }finally{rmSync(temp,{recursive:true,force:true});}
});
