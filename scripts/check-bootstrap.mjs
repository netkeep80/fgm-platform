// FGM Platform bootstrap governance checker; only declarative, local, no network.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PIN = "74db97791e6da8a75287164f0d0b41579108f114";
const requiredPaths = [
  "README.md",
  "docs/requirements-hierarchy.md",
  "LICENSE",
  "requirements/FGMP-PRODUCT-000.rg.yaml",
  "requirements/FGMP-PROJECT-000.rg.yaml",
  ".github/workflows/repo-guard.yml",
  "scripts/check-bootstrap.mjs",
  "tests/bootstrap.test.mjs",
  "scripts/verify-repoguard-transition.mjs",
];

function fail(code) { throw new Error("E_FGMP_" + code); }
const safe = path => typeof path === "string" &&
  !path.startsWith("/") && !path.includes("\\") &&
  path.split("/").every(x => x !== ".." && x !== "." && x.length);
const source = (base, path) => {
  if (!safe(path)) fail("UNSAFE_PATH");
  const absolute=resolve(base,path);
  const rel=relative(base,absolute);
  if (rel.startsWith(".."+sep) || rel===".." || rel.startsWith(sep)) fail("UNSAFE_PATH");
  if (!existsSync(absolute)) fail("MISSING_FILE:" + path);
  return readFileSync(absolute,"utf8");
};

/**
 * Guard only a small, explicit workflow YAML subset. Inactive comment strings
 * and scalar block contents must never count as executable GitHub Actions.
 * Independent branch protection is a separate trust boundary.
 */
function checkWorkflowGate(workflow) {
  const lines=workflow.replace(/\r\n/g,"\n").split("\n");
  if(lines.some(x=>x.includes("\t"))) fail("GUARD_PIN");
  const active=lines.filter(x=>! /^\s*(?:#|$)/.test(x));
  const exactly=(xs,v)=>xs.filter(x=>x===v).length===1;
  const single=(xs,v)=>{if(!exactly(xs,v))fail("GUARD_PIN");return xs.indexOf(v);};
  single(active,"on:");
  single(active,"  pull_request:");
  if(!exactly(active,"    types: [opened, reopened, synchronize, ready_for_review]") ||
     !exactly(active,"    branches: [main]")) fail("GUARD_PIN");
  const jobs=active.slice(single(active,"jobs:")+1);
  const jobNames=jobs.filter(x=>/^  [\w-]+:\s*$/.test(x));
  if(jobNames.length!==1||jobNames[0]!=="  repo-guard:") fail("GUARD_PIN");
  const job=jobs.slice(single(jobs,"  repo-guard:")+1);
  if(!exactly(job,"    name: RepoGuard exact BASE/HEAD") ||
     !exactly(job,"    runs-on: ubuntu-24.04") ||
     job.some(x=>/^    (?:if|continue-on-error):/.test(x))) fail("GUARD_PIN");
  const steps=job.slice(single(job,"    steps:")+1);
  if(steps.some(x=>/^    [\w-]+:/.test(x))) fail("GUARD_PIN");
  const starts=[];
  for(let i=0;i<steps.length;i++)
    if(/^      - name: [^#]+$/.test(steps[i])) starts.push(i);
  const step=label=>{
    const ix=starts.filter(i=>steps[i]==="      - name: "+label);
    if(ix.length!==1) fail("GUARD_PIN");
    const next=starts.find(i=>i>ix[0])??steps.length;
    return steps.slice(ix[0],next);
  };
  const guard=step("RepoGuard exact immutable snapshot");
  if(!exactly(guard,"        id: required_guard") ||
     !exactly(guard,"        uses: netkeep80/repo-guard@"+PIN) ||
     !exactly(guard,"        with:") ||
     !exactly(guard,"          base: ${{ github.event.pull_request.base.sha }}") ||
     !exactly(guard,"          head: ${{ github.event.pull_request.head.sha }}") ||
     !exactly(guard,"          node-version: '24'") ||
     guard.some(x=>/^        (?:run|if|continue-on-error):/.test(x)))
    fail("GUARD_PIN");
  if(steps.filter(x=>x==="        id: required_guard").length!==1)
    fail("GUARD_PIN");
  const oracle=step("Verify real RepoGuard positive and orphan-negative transitions");
  if(!exactly(oracle,"        run: |") ||
     !exactly(oracle,"          node scripts/verify-repoguard-transition.mjs") ||
     oracle.some(x=>/^        (?:if|continue-on-error|uses):/.test(x)) ||
     oracle.some(x=>/\|\|\s*true/.test(x))) fail("GUARD_PIN");
  if(!starts.length || /continue-on-error:\s*true/.test(workflow))
    fail("GUARD_PIN");
}

export function checkBootstrap(base=root) {
  for (const p of requiredPaths) source(base,p);
  const workflow=source(base,".github/workflows/repo-guard.yml");
  checkWorkflowGate(workflow);
  for(const [file,id] of [
    ["requirements/FGMP-PRODUCT-000.rg.yaml","FGMP-PRODUCT-000"],
    ["requirements/FGMP-PROJECT-000.rg.yaml","FGMP-PROJECT-000"],
  ]) {
    const raw=source(base,file);
    if(!raw.startsWith("format: repo-guard/requirement-v1\nid: "+id+"\n") ||
       !/normative:/.test(raw) ||
       !/accepted: true\s+current: true\s+published: false/.test(raw)) fail("ROOT_SCHEMA:"+id);
    for(const match of raw.matchAll(/path: "([^"]+)"/g))
      source(base,match[1]);
  }
  return {ok:true,roots:2,repoGuard:PIN};
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(checkBootstrap()));
