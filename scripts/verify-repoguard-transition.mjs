// Exact RepoGuard v6.0.1 integration regression: real synthetic Git BASE/HEAD.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {parseDocument,stringify} from "yaml";
import { runRepoGuard } from "./run-repoguard.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pin = "74db97791e6da8a75287164f0d0b41579108f114";
const toolDir = resolve(repo, ".rg-transition");
const cli = resolve(repo, ".rg-transition/dist/repo-guard.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, {cwd, encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
}
function probe(directory, base, head) {
  return runRepoGuard(cli,"netkeep80/fgm-platform",directory,base,head);
}
function ensure(ok, code) {if(!ok) throw new Error("E_FGMP_REPOGUARD_"+code);}
ensure(git(toolDir,"rev-parse","HEAD")===pin, "COMPILER_SHA");
const names=execFileSync("git",["ls-files","-z"],{cwd:repo})
  .toString("utf8").split("\0").filter(Boolean);
ensure(names.includes("requirements/FGMP-PRODUCT-000.rg.yaml") &&
  names.includes("requirements/FGMP-PROJECT-000.rg.yaml"), "ROOTS_MISSING");
const temp=mkdtempSync(join(tmpdir(),"fgmp-rg-real-"));
try {
  git(temp,"init","-q","-b","main");
  git(temp,"config","user.name","FGM Synthetic CI");
  git(temp,"config","user.email","synthetic@example.invalid");
  git(temp,"remote","add","origin","https://github.com/netkeep80/fgm-platform.git");
  for(const path of names) {
    const target=join(temp,path);mkdirSync(dirname(target),{recursive:true});
    cpSync(join(repo,path),target);
  }
  git(temp,"add","-A");git(temp,"commit","-qm","synthetic accepted normative BASE");
  const goodBase=git(temp,"rev-parse","HEAD");
  appendFileSync(join(temp,"README.md"),"\nSynthetic documented transition, no gameplay data.\n");
  git(temp,"add","-A");git(temp,"commit","-qm","synthetic justified README transition");
  const goodHead=git(temp,"rev-parse","HEAD");
  const positive=probe(temp,goodBase,goodHead);
  ensure(positive.status===0&&positive.report.ok===true, "POSITIVE_TRANSITION");
  ensure(positive.report.base===goodBase&&positive.report.head===goodHead, "EXACT_REFS");
  ensure(positive.report.j1?.justified===positive.report.j1?.tracked &&
    positive.report.j2?.rooted>=2 &&
    (positive.report.diagnostics||[]).length===0, "POSITIVE_CLOSURE");

  writeFileSync(join(temp,"not-authorized-in-requirements.txt"), "synthetic orphan\n");
  git(temp,"add","-A");git(temp,"commit","-qm","synthetic orphan tracked resource");
  const badHead=git(temp,"rev-parse","HEAD");
  const negative=probe(temp,goodHead,badHead);
  ensure(negative.status!==0 && negative.report.ok===false, "NEGATIVE_FALSE_PASS");
  ensure(negative.report.base===goodHead&&negative.report.head===badHead, "NEGATIVE_EXACT_REFS");
  ensure((negative.report.diagnostics||[]).some(x=>
    x.code==="unjustified_resource" &&
    String(x.subject||"").includes("not-authorized-in-requirements.txt")), "NEGATIVE_TYPED_DIAGNOSTIC");
  const typed=[];
  const req=join(temp,"requirements/core/FGMC-EVAL-001.rg.yaml");
  for(const kind of ["removed_verified_by","missing_target"]){
    git(temp,"reset","--hard",goodHead);git(temp,"clean","-fd");
    const document=parseDocument(readFileSync(req,"utf8")).toJS();
    if(kind==="removed_verified_by")document.relations=document.relations.filter(r=>!r.predicates.includes("verified_by"));
    else document.relations.find(r=>r.target.path==="core/src/evaluator.cpp").target.path="core/src/missing-policy-target.cpp";
    writeFileSync(req,stringify(document));git(temp,"add","-A");git(temp,"commit","-qm","synthetic "+kind);
    const result=probe(temp,goodHead,git(temp,"rev-parse","HEAD"));
    ensure(result.status!==0&&!result.report.ok,"TYPED_NEGATIVE_FALSE_PASS");
    ensure(result.report.diagnostics.some(d=>d.code==="unjustified_resource"),"TYPED_NEGATIVE_DIAGNOSTIC");
    if(kind==="missing_target")ensure(result.report.diagnostics.some(d=>d.code==="missing_resource_target"),"MISSING_TARGET_DIAGNOSTIC");
    typed.push({case:kind,result:"REJECTED_AS_EXPECTED",j3:result.report.j3,diagnostics:result.report.diagnostics});
  }
  console.log(JSON.stringify({result:"PASS",repoGuard:pin,typed_negative:typed,positive:{
    base:goodBase,head:goodHead,j1:positive.report.j1,j2:positive.report.j2,
    diagnostics:positive.report.diagnostics.length},
    negative:{base:goodHead,head:badHead,diagnostics:negative.report.diagnostics}},null,2));
} finally {rmSync(temp,{recursive:true,force:true});}
