import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stringify} from 'yaml';
import {root,git,parse} from '../scripts/check-requirements-migration.mjs';
import {checkCore} from '../scripts/check-core-integration.mjs';

test('S04 approved changes and unapproved drift',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'fgmp-s04-mutations-'));
  try{
    execFileSync('git',['clone','--quiet','--shared','--no-checkout',root,temp]);
    const head=git(root,'rev-parse','HEAD');git(temp,'checkout','--quiet','--detach',head);
    git(temp,'config','user.name','FGM synthetic verification');git(temp,'config','user.email','synthetic@example.invalid');
    const change=(path,fn)=>{const p=join(temp,path),d=parse(readFileSync(p));fn(d);writeFileSync(p,stringify(d));};
    const req='requirements/core/FGMC-EVAL-001.rg.yaml';
    await t.test('approved local target and requirement updates pass',()=>{
      const r=checkCore(temp,head);assert.equal(r.module_files_changed,1);assert.equal(r.module_files_preserved,231);
    });
    const cases=[
      ['unexpected Core implementation edit',()=>writeFileSync(join(temp,'core/src/evaluator.cpp'),'synthetic drift\n'),'UNDECLARED_CHANGE'],
      ['unexpected Regenerator edit',()=>writeFileSync(join(temp,'regenerator/CMakeLists.txt'),'synthetic drift\n'),'UNDECLARED_CHANGE'],
      ['unapproved CMake change',()=>writeFileSync(join(temp,'core/CMakeLists.txt'),'synthetic replacement\n'),'CORE_CMAKE_CHANGE'],
      ['removed verified_by',()=>change(req,d=>{d.relations=d.relations.filter(r=>!r.predicates.includes('verified_by'));}),'S04_REQUIREMENT_DRIFT'],
      ['normative drift',()=>change(req,d=>{d.normative+=' drift';}),'S04_REQUIREMENT_DRIFT'],
      ['constraint drift',()=>change(req,d=>{d.constraints[0].evidence.verifier.path='missing';}),'S04_REQUIREMENT_DRIFT'],
      ['lifecycle promotion',()=>change(req,d=>{d.lifecycle.accepted=true;}),'S04_REQUIREMENT_DRIFT'],
      ['weakened historical checker',()=>writeFileSync(join(temp,'scripts/check-requirements-migration.mjs'),'synthetic bypass\n'),'UNDECLARED_CHANGE'],
      ['unlisted new resource',()=>writeFileSync(join(temp,'s04-orphan.txt'),'synthetic orphan\n'),'S04_NEW_FILE_SET'],
      ['skipped native CI',()=>change('.github/workflows/core-ci.yml',d=>{d.jobs.core.steps.at(-1).if='false';}),'CORE_WORKFLOW_GATE'],
      ['root CMake without native tests',()=>writeFileSync(join(temp,'CMakeLists.txt'),
        'cmake_minimum_required(VERSION 3.24)\nproject(noop LANGUAGES NONE)\ninclude(CTest)\n'),'CRITICAL_CONTENT_DRIFT'],
      ['empty consumer CMake',()=>writeFileSync(join(temp,'tests/core/consumer/CMakeLists.txt'),
        'cmake_minimum_required(VERSION 3.24)\nproject(noop LANGUAGES NONE)\ninclude(CTest)\n'),'CRITICAL_CONTENT_DRIFT'],
      ['no-op native sample',()=>writeFileSync(join(temp,'tests/core/sample.cpp'),'int main(){return 0;}\n'),'CRITICAL_CONTENT_DRIFT'],
      ['weakened historical workflow',()=>writeFileSync(join(temp,'.github/workflows/source-snapshots.yml'),
        'name: noop\non: [pull_request]\njobs:\n  noop:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo PASS\n'),'CRITICAL_CONTENT_DRIFT'],
      ['modified critical file mode',()=>{},'CRITICAL_CONTENT_DRIFT',
        ()=>git(temp,'update-index','--chmod=+x','tests/core-parity.test.mjs')],
    ];
    const noop='console.log("PASS");\n';
    for(const path of ['tests/core-parity.test.mjs','scripts/check-core-consumer.mjs',
      'scripts/verify-requirements-transition.mjs','tests/requirements-migration.test.mjs',
      'tests/core-integration.test.mjs','scripts/check-ctest.mjs','tests/ctest-gate.test.mjs'])
      cases.push(['successful no-op '+path,()=>{
        writeFileSync(join(temp,path),noop);
        const run=spawnSync(process.execPath,[join(temp,path)],{encoding:'utf8'});
        assert.equal(run.status,0);assert.match(run.stdout,/PASS/);
      },'CRITICAL_CONTENT_DRIFT']);
    cases.push(['no-op plus rewritten manifest pin',()=>{
      const path='tests/core-parity.test.mjs';writeFileSync(join(temp,path),noop);
      const p=join(temp,'docs/core-integration.json'),m=JSON.parse(readFileSync(p));
      const pin=m.critical_artifacts.find(p=>p.path===path);
      pin.sha256=createHash('sha256').update(noop).digest('hex');
      pin.blob=createHash('sha1').update('blob '+Buffer.byteLength(noop)+'\0').update(noop).digest('hex');
      writeFileSync(p,JSON.stringify(m));
    },'CRITICAL_CONTENT_DRIFT']);
    for(const [name,mutate,code,afterAdd]of cases)await t.test(name,()=>{
      git(temp,'reset','--hard',head);git(temp,'clean','-fd');mutate();git(temp,'add','-A');
      afterAdd?.();
      git(temp,'commit','--quiet','-m','synthetic S04 negative');
      assert.throws(()=>checkCore(temp,'HEAD'),new RegExp(code));
    });
  }finally{rmSync(temp,{recursive:true,force:true});}
});
