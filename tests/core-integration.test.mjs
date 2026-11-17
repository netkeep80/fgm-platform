import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
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
    ];
    for(const [name,mutate,code]of cases)await t.test(name,()=>{
      git(temp,'reset','--hard',head);git(temp,'clean','-fd');mutate();git(temp,'add','-A');
      git(temp,'commit','--quiet','-m','synthetic S04 negative');
      assert.throws(()=>checkCore(temp,'HEAD'),new RegExp(code));
    });
  }finally{rmSync(temp,{recursive:true,force:true});}
});
