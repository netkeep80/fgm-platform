// Mutate independently committed trees, keeping the historical baseline available.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {stringify} from 'yaml';
import {root,git,parse,checkMigration} from '../scripts/check-requirements-migration.mjs';

test('S03 exact migration and independent integrity mutations', async t=>{
  const temp=mkdtempSync(join(tmpdir(),'fgmp-s03-map-'));
  try {
    execFileSync('git',['clone','--quiet','--shared','--no-checkout',root,temp]);
    const positive=git(root,'rev-parse','HEAD');
    git(temp,'checkout','--quiet','--detach',positive);
    git(temp,'config','user.name','FGM synthetic verification');
    git(temp,'config','user.email','synthetic@example.invalid');
    const commit=()=>{git(temp,'add','-A');git(temp,'commit','--quiet','-m','synthetic S03 mutation');};
    const change=(path,fn)=>{const absolute=join(temp,path),d=parse(readFileSync(absolute,'utf8'));fn(d);writeFileSync(absolute,stringify(d));};
    await t.test('exact 73/73 snapshot passes',()=>{
      const report=checkMigration(temp,positive);
      assert.equal(report.counts.mapped,73);assert.equal(report.counts.unmapped,0);
      assert.equal(report.module_files_preserved,232);assert.equal(report.canonical_requirements,77);
    });
    const requirement='requirements/core/FGMC-EVAL-001.rg.yaml';
    const cases=[
      ['normative text drift',()=>change(requirement,d=>{d.normative+=' synthetic drift';}),'REQUIREMENT_DRIFT'],
      ['duplicate ID',()=>change(requirement,d=>{d.id='FGMC-SPACE-001';}),'REQUIREMENT_DRIFT'],
      ['automatic lifecycle promotion',()=>change(requirement,d=>{d.lifecycle.accepted=true;}),'REQUIREMENT_DRIFT'],
      ['removed verified_by',()=>change(requirement,d=>{d.relations=d.relations.filter(r=>!r.predicates.includes('verified_by'));}),'REQUIREMENT_DRIFT'],
      ['wrong artifact path',()=>change(requirement,d=>{d.relations.find(r=>r.target.kind==='artifact').target.path='core/missing.cpp';}),'REQUIREMENT_DRIFT'],
      ['wrong constraint verifier',()=>change(requirement,d=>{d.constraints[0].evidence.verifier.path='core/missing.cpp';}),'REQUIREMENT_DRIFT'],
      ['changed original implementation',()=>writeFileSync(join(temp,'core/src/evaluator.cpp'),'synthetic replacement\n'),'MODULE_RESOURCE_DRIFT'],
      ['tampered attestation',()=>{const p=join(temp,'docs/requirements-migration.json');const d=JSON.parse(readFileSync(p));d.counts.unmapped=1;writeFileSync(p,JSON.stringify(d));},'ATTESTATION_DRIFT'],
      ['duplicate old normative file',()=>{const p=join(temp,'core/requirements/FGMC-EVAL-001.rg.yaml');mkdirSync(dirname(p),{recursive:true});writeFileSync(p,readFileSync(join(temp,requirement)));},'DUPLICATE_MODULE_AUTHORITY'],
      ['blanket inventory authority',()=>change('requirements/FGMP-MIG-SNAPSHOT-001.rg.yaml',d=>{const r=d.relations.find(r=>r.target.path==='docs/source-snapshot-resources.json');r.predicates=['requires'];r.collection=true;}),'SNAPSHOT_REQUIREMENT_DRIFT'],
    ];
    for(const [name,mutate,code] of cases)await t.test(name,()=>{
      git(temp,'reset','--hard',positive);git(temp,'clean','-fd');mutate();commit();
      assert.throws(()=>checkMigration(temp,'HEAD'),new RegExp(code));
    });
  } finally {rmSync(temp,{recursive:true,force:true});}
});
