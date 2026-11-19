import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {spawnSync} from "node:child_process";
import { root, checkWorkflow, PIN } from "../scripts/check-workflow.mjs";
import {parse,stringify} from "yaml";

const paths=[
  "README.md","docs/requirements-hierarchy.md","LICENSE",
  "requirements/FGMP-PRODUCT-000.rg.yaml",
  "requirements/FGMP-PROJECT-000.rg.yaml",
  ".github/workflows/platform.yml",
  "scripts/check-workflow.mjs","tests/workflow.test.mjs",
  "scripts/verify-repoguard-transition.mjs",
  "package.json","package-lock.json",
  "CMakeLists.txt","core/CMakeLists.txt","raster/CMakeLists.txt",
  "regenerator/CMakeLists.txt","renderer/CMakeLists.txt",
];
function temporary(operate) {
  const tmp=mkdtempSync(join(tmpdir(),"fgmp-workflow-"));
  try {
    for(const path of paths) {
      const dst=join(tmp,path);mkdirSync(resolve(dst,".."),{recursive:true});
      cpSync(join(root,path),dst);
    }
    return operate(tmp);
  } finally {rmSync(tmp,{recursive:true,force:true});}
}
test("positive: exact frozen RepoGuard revision, roots and artifact links",()=>
  assert.deepEqual(checkWorkflow(),{ok:true,roots:2,repoGuard:PIN})
);
test("negative: every run step must use a fail-fast shell on Windows and Ubuntu",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml"),v=parse(readFileSync(p,"utf8"));
  v.defaults.run.shell="pwsh";writeFileSync(p,stringify(v));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));
test("real shell: a failed native command stops before the next successful command",()=>{
  const r=spawnSync("bash",["--noprofile","--norc","-e","-o","pipefail","-c",
    'node -e "process.exit(7)"\nnode -e \'console.log("SHOULD_NOT_RUN")\''],{encoding:"utf8"});
  assert.equal(r.status,7,r.stderr);assert.doesNotMatch(r.stdout,/SHOULD_NOT_RUN/);
});
test("negative: replaced RepoGuard SHA fails closed",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace(
    "uses: netkeep80/repo-guard@"+PIN,
    "uses: netkeep80/repo-guard@0000000000000000000000000000000000000000"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));
test("negative: missing verified_by target fails closed",()=>temporary(tmp=>{
  const p=join(tmp,"requirements/FGMP-PROJECT-000.rg.yaml");
  writeFileSync(p,readFileSync(p,"utf8").replace("tests/workflow.test.mjs","tests/non-existent-verifier.mjs"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_MISSING_FILE/);
}));
test("negative: candidate root lifecycle cannot masquerade as accepted project roots",()=>temporary(tmp=>{
  const p=join(tmp,"requirements/FGMP-PRODUCT-000.rg.yaml");
  writeFileSync(p,readFileSync(p,"utf8").replace("accepted: true","accepted: false"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_ROOT_SCHEMA/);
}));

test("negative: CI cannot skip real synthetic transition regression",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("node scripts/verify-repoguard-transition.mjs","echo ignored"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));
test("negative: CI cannot continue on a failed RepoGuard action",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("id: required_guard","id: required_guard\n        continue-on-error: true"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));


test("negative: commented RepoGuard uses plus fake run cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  const needle="        uses: netkeep80/repo-guard@"+PIN+"\n        with:\n";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"        # uses: netkeep80/repo-guard@"+PIN+"\n        run: echo fake-green\n        with:\n"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: commented oracle invocation plus echo cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  const needle="          node scripts/verify-repoguard-transition.mjs";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"          # node scripts/verify-repoguard-transition.mjs\n          echo fake-green"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: conditional RepoGuard action cannot be skipped",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  writeFileSync(p,w.replace("        id: required_guard","        id: required_guard\n        if: false"));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));


function workflowMutation(label, needle, replacement) {
  test("negative YAML semantics: "+label,()=>temporary(tmp=>{
    const p=join(tmp,".github/workflows/platform.yml");
    const w=readFileSync(p,"utf8");
    assert.ok(w.includes(needle),"missing mutation anchor");
    writeFileSync(p,w.replace(needle,replacement));
    assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
  }));
}
workflowMutation("guard whitespace-before-colon conditional",
  "        id: required_guard","        id: required_guard\n        if : false");
workflowMutation("guard quoted conditional key",
  "        id: required_guard",'        id: required_guard\n        "if": false');
workflowMutation("guard whitespace-before-colon continue-on-error",
  "        id: required_guard","        id: required_guard\n        continue-on-error : true");
workflowMutation("oracle whitespace-before-colon conditional",
  "      - name: Verify real RepoGuard positive and orphan-negative transitions",
  "      - name: Verify real RepoGuard positive and orphan-negative transitions\n        if : false");
workflowMutation("oracle whitespace-before-colon continue-on-error",
  "      - name: Verify real RepoGuard positive and orphan-negative transitions",
  "      - name: Verify real RepoGuard positive and orphan-negative transitions\n        continue-on-error : true");
workflowMutation("job whitespace-before-colon conditional",
  "    runs-on: ubuntu-24.04","    runs-on: ubuntu-24.04\n    if : false");
workflowMutation("duplicate effective guard key",
  "        id: required_guard","        id: required_guard\n        id: required_guard");
workflowMutation("alias/anchor forbidden in governance workflow",
  "        id: required_guard","        id: &guard_id required_guard");
workflowMutation("unapproved extra job with identical check name",
  "jobs:\n","jobs:\n  fake:\n    name: RepoGuard exact BASE/HEAD\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo fake-green\n");
workflowMutation("quoted continue-on-error job key",
  "    runs-on: ubuntu-24.04",'    runs-on: ubuntu-24.04\n    "continue-on-error": true');
workflowMutation("block scalar action uses cannot impersonate pinned uses",
  "        uses: netkeep80/repo-guard@"+PIN,
  "        run: |\n          uses: netkeep80/repo-guard@"+PIN);

for(const [name,mutate]of [
  ["release cannot run on PR",w=>{w.jobs.release.if="true";}],
  ["release requires all verification roles",w=>{w.jobs.release.needs.pop();}],
  ["global permissions cannot publish",w=>{w.permissions.contents="write";}],
  ["verification job cannot mint tokens",w=>{w.jobs.core.permissions={"id-token":"write"};}],
  ["a different approved job cannot impersonate RepoGuard",w=>{w.jobs.core.name="RepoGuard exact BASE/HEAD";}],
  ["main push cannot omit documentation merges",w=>{w.on.push.paths=["renderer/**"];}],
  ["main push cannot ignore documentation merges",w=>{w.on.push['paths-ignore']=["**/*.md"];}],
  ["Windows native verification cannot disappear",w=>{w.jobs.core.strategy.matrix.os=["ubuntu-24.04"];}],
  ["native workflow negatives cannot be filtered to one case",w=>{const s=w.jobs.core.steps.find(s=>s.run?.includes('node --test tests/workflow.test.mjs'));s.run=s.run.replace('node --test tests/workflow.test.mjs','node --test --test-name-pattern="real shell:" tests/workflow.test.mjs');}],
  ["native tests cannot be replaced by successful echo",w=>{w.jobs.core.steps.find(s=>s.run?.includes('ctest --test-dir')).run='echo PASS';}],
  ["native inventory cannot be bypassed",w=>{w.jobs.core.steps.find(s=>s.run?.startsWith('node scripts/check-ctest.mjs')).if=false;}],
  ["publisher admission suite cannot be bypassed",w=>{w.jobs.core.steps.find(s=>s.run?.includes('test_pages_*.py')).if=false;}],
  ["WASM depth oracle must execute",w=>{const s=w.jobs['wasm-browser'].steps.find(s=>s.run?.includes('node tests/renderer-depth-oracle.browser.mjs'));s.run=s.run.replace('node tests/renderer-depth-oracle.browser.mjs','echo PASS');}],
  ["WASM whole-object parity must execute",w=>{const s=w.jobs['wasm-browser'].steps.find(s=>s.run?.includes('node tests/test_studio_whole.mjs'));s.run=s.run.replace(/node tests\/test_studio_whole[^\n]+/,'echo PASS');}],
  ["compiled RVI mutation testing cannot be disabled",w=>{w.jobs['wasm-browser'].steps.find(s=>s.run==='node scripts/mutate-v02.mjs').if=false;}],
])test("negative publication authority: "+name,()=>temporary(tmp=>{
  const path=join(tmp,".github/workflows/platform.yml"),w=parse(readFileSync(path,"utf8"));
  mutate(w);writeFileSync(path,stringify(w));
  assert.throws(()=>checkWorkflow(tmp),/E_FGMP_GUARD_PIN/);
}));

for(const [name,path,append,code]of [
  ["internal Core fetch","regenerator/CMakeLists.txt","\nFetchContent_Declare(fgm_core GIT_REPOSITORY example)\n","LOCAL_BUILD"],
  ["global test disabling","renderer/CMakeLists.txt","\nset(BUILD_TESTING OFF CACHE BOOL \"\" FORCE)\n","LOCAL_BUILD"],
  ["second module lockfile","renderer/package-lock.json","{}\n","DUPLICATE_MODULE_INFRASTRUCTURE"],
  ["nested module workflow","renderer/.github/workflows/duplicate.yml","name: duplicate\n","DUPLICATE_MODULE_INFRASTRUCTURE"],
])test("negative local architecture: "+name,()=>temporary(tmp=>{
  const p=join(tmp,path);mkdirSync(resolve(p,".."),{recursive:true});
  writeFileSync(p,(path.endsWith('CMakeLists.txt')?readFileSync(p,'utf8'):'')+append);
  assert.throws(()=>checkWorkflow(tmp),new RegExp('E_FGMP_'+code));
}));
