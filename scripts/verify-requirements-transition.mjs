// Use only the immutable compiler to prove nested discovery and three real negative transitions.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {stringify} from 'yaml';
import {root,BASE,PIN,git,parse,checkMigration} from './check-requirements-migration.mjs';
import {runRepoGuard} from './run-repoguard.mjs';

const compiler=resolve(root,'.rg-transition');
if(git(compiler,'rev-parse','HEAD')!==PIN)throw new Error('S03_COMPILER_PIN');
const cli=join(compiler,'dist/repo-guard.mjs');
// S03 is closed: its accepted transition is verified at its immutable historical HEAD.
const head='4c46d0f3aa2176a8d63448c01df55614ce169956';
const migration=checkMigration(root,head);
function probe(repo,base,head) {
  return runRepoGuard(cli,'netkeep80/fgm-platform',repo,base,head);
}
const positive=probe(root,BASE,head);
if(positive.status!==0||!positive.report.ok||positive.report.diagnostics.length)
  throw new Error('S03_POSITIVE: '+JSON.stringify(positive.report.diagnostics));
if(positive.report.j2.rooted!==77||positive.report.j1.justified!==positive.report.j1.tracked)
  throw new Error('S03_NESTED_DISCOVERY');
const temp=mkdtempSync(join(tmpdir(),'fgmp-s03-compiler-'));
const negatives=[];
try {
  execFileSync('git',['clone','--quiet','--shared','--no-checkout',root,temp]);
  git(temp,'checkout','--quiet','--detach',head);
  git(temp,'config','user.name','FGM synthetic verification');
  git(temp,'config','user.email','synthetic@example.invalid');
  git(temp,'remote','set-url','origin','https://github.com/netkeep80/fgm-platform.git');
  const requirement=join(temp,'requirements/core/FGMC-EVAL-001.rg.yaml');
  const cases=[
    {name:'removed_verified_by',mutate:()=>{const d=parse(readFileSync(requirement));d.relations=d.relations.filter(r=>!r.predicates.includes('verified_by'));writeFileSync(requirement,stringify(d));},
      subject:'core/tests/fgm-eval.test.cpp',code:'unjustified_resource'},
    {name:'wrong_artifact_path',mutate:()=>{const d=parse(readFileSync(requirement));d.relations.find(r=>r.target.path==='core/src/evaluator.cpp').target.path='core/src/missing-s03.cpp';writeFileSync(requirement,stringify(d));},
      subject:'core/src/evaluator.cpp',code:'unjustified_resource'},
    {name:'orphan_resource',mutate:()=>writeFileSync(join(temp,'s03-unowned-resource.txt'),'synthetic orphan\n'),
      subject:'s03-unowned-resource.txt',code:'unjustified_resource'},
  ];
  for(const c of cases) {
    git(temp,'reset','--hard',head);git(temp,'clean','-fd');c.mutate();
    git(temp,'add','-A');git(temp,'commit','--quiet','-m','synthetic '+c.name);
    const badHead=git(temp,'rev-parse','HEAD'),negative=probe(temp,head,badHead);
    if(negative.status===0||negative.report.ok||!negative.report.diagnostics.some(d=>d.code===c.code&&d.subject.includes(c.subject)))
      throw new Error('S03_NEGATIVE_FALSE_PASS:'+c.name+':'+JSON.stringify(negative.report.diagnostics));
    negatives.push({name:c.name,base:head,head:badHead,result:'REJECTED_AS_EXPECTED',
      diagnostics:negative.report.diagnostics.map(({code,subject})=>({code,subject}))});
  }
} finally {rmSync(temp,{recursive:true,force:true});}
console.log(JSON.stringify({result:'PASS',compiler:PIN,migration,
  positive:{base:BASE,head,j1:positive.report.j1,j2:positive.report.j2,
    j3:{ok:positive.report.j3.ok,changed:positive.report.j3.changed},diagnostics:0},
  negatives},null,2));
