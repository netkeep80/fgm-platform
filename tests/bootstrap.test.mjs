import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { root, checkBootstrap, PIN } from "../scripts/check-bootstrap.mjs";

const paths=[
  "README.md","docs/requirements-hierarchy.md","LICENSE",
  "requirements/FGMP-PRODUCT-000.rg.yaml",
  "requirements/FGMP-PROJECT-000.rg.yaml",
  ".github/workflows/repo-guard.yml",
  "scripts/check-bootstrap.mjs","tests/bootstrap.test.mjs",
  "scripts/verify-repoguard-transition.mjs",
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
test("negative: replaced RepoGuard SHA fails closed",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/repo-guard.yml");
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
  const p=join(tmp,".github/workflows/repo-guard.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("node scripts/verify-repoguard-transition.mjs","echo ignored"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));
test("negative: CI cannot continue on a failed RepoGuard action",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/repo-guard.yml");
  writeFileSync(p,readFileSync(p,"utf8").replace("id: required_guard","id: required_guard\n        continue-on-error: true"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));


test("negative: commented RepoGuard uses plus fake run cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/repo-guard.yml");
  const w=readFileSync(p,"utf8");
  const needle="        uses: netkeep80/repo-guard@"+PIN+"\n        with:\n";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"        # uses: netkeep80/repo-guard@"+PIN+"\n        run: echo fake-green\n        with:\n"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: commented oracle invocation plus echo cannot pass",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/repo-guard.yml");
  const w=readFileSync(p,"utf8");
  const needle="          node scripts/verify-repoguard-transition.mjs";
  assert.ok(w.includes(needle));
  writeFileSync(p,w.replace(needle,"          # node scripts/verify-repoguard-transition.mjs\n          echo fake-green"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));

test("negative: conditional RepoGuard action cannot be skipped",()=>temporary(tmp=>{
  const p=join(tmp,".github/workflows/repo-guard.yml");
  const w=readFileSync(p,"utf8");
  writeFileSync(p,w.replace("        id: required_guard","        id: required_guard\n        if: false"));
  assert.throws(()=>checkBootstrap(tmp),/E_FGMP_GUARD_PIN/);
}));
