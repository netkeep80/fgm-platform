import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {spawnSync} from "node:child_process";
import { root, checkBootstrap, PIN } from "../scripts/check-bootstrap.mjs";
import {parse,stringify} from "yaml";

const paths=[
  "README.md","docs/requirements-hierarchy.md","LICENSE",
  "requirements/FGMP-PRODUCT-000.rg.yaml",
  "requirements/FGMP-PROJECT-000.rg.yaml",
  ".github/workflows/platform.yml",
  "scripts/check-bootstrap.mjs","tests/bootstrap.test.mjs",
  "scripts/verify-repoguard-transition.mjs",
  "package.json","package-lock.json",
];
function temporary(operate) {
  const tmp=mkdtempSync(join(tmpdir(),"fgmp-bootstrap-"));
  try {
    for(const path of paths) {
      const dst=join(tmp,path);mkdirSync(resolve(dst,".."),{recursive:true});
      cpSync(join(root,path),dst);
    }
    return operate(tmp);
  } finally {rmSync(tmp,{recursive:true,force:true});}
}
test("positive: exact frozen RepoGuard revision, roots and artifact links",()=>
  assert.deepEqual(checkBootstrap(),{ok:true,roots:2,repoGuard:PIN})
);
test("negative: every run step must use a fail-fast shell on Windows and Ubuntu",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml"),v=parse(readFileSync(p,"utf8"));
  v.defaults.run.shell="pwsh";writeFileSync(p,stringify(v));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
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
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));
test("negative: missing verified_by target fails closed",()=>temporary(tmp=>{
  const p=join(tmp,"requirements/FGMP-PROJECT-000.rg.yaml");
  writeFileSync(p,readFileSync(p,"utf8").replace("tests/bootstrap.test.mjs","tests/non-existent-verifier.mjs"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_MISSING_FILE/);
}));
test("negative: candidate root lifecycle cannot masquerade as accepted bootstrap",()=>temporary(tmp=>{
  const p=join(tmp,"requirements/FGMP-PRODUCT-000.rg.yaml");
  writeFileSync(p,readFileSync(p,"utf8").replace("accepted: true","accepted: false"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_ROOT_SCHEMA/);
}));

test("negative: CI cannot skip real synthetic transition regression",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("node scripts/verify-repoguard-transition.mjs","echo ignored"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));
test("negative: CI cannot continue on a failed RepoGuard action",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("id: required_guard","id: required_guard\n        continue-on-error: true"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));


test("negative: commented RepoGuard uses plus fake run cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  const needle="        uses: netkeep80/repo-guard@"+PIN+"\n        with:\n";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"        # uses: netkeep80/repo-guard@"+PIN+"\n        run: echo fake-green\n        with:\n"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: commented oracle invocation plus echo cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  const needle="          node scripts/verify-repoguard-transition.mjs";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"          # node scripts/verify-repoguard-transition.mjs\n          echo fake-green"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: conditional RepoGuard action cannot be skipped",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/platform.yml");
  const w=readFileSync(p,"utf8");
  writeFileSync(p,w.replace("        id: required_guard","        id: required_guard\n        if: false"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));


function workflowMutation(label, needle, replacement) {
  test("negative YAML semantics: "+label,()=>temporary(tmp=>{
    const p=join(tmp,".github/workflows/platform.yml");
    const w=readFileSync(p,"utf8");
    assert.ok(w.includes(needle),"missing mutation anchor");
    writeFileSync(p,w.replace(needle,replacement));
    assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
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
])test("negative publication authority: "+name,()=>temporary(tmp=>{
  const path=join(tmp,".github/workflows/platform.yml"),w=parse(readFileSync(path,"utf8"));
  mutate(w);writeFileSync(path,stringify(w));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));
