// FGM Platform bootstrap governance checker; only declarative, local, no network.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument, visit, isAlias, isMap, isScalar, isSeq } from "yaml";

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
  "package.json",
  "package-lock.json",
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


/*
 * Parse the effective YAML graph, not source-text approximations.
 * Lockfile-pinned yaml v2.8.3 uses YAML 1.2 semantics.
 * Duplicate keys, aliases, tags, anchors, merges and any unapproved job/step
 * shape fail closed. Branch-side required-check enforcement is a separate gate.
 */
function checkWorkflowGate(workflow) {
  let doc;
  try { doc = parseDocument(workflow, {version:"1.2", uniqueKeys:true, merge:false, strict:true}); }
  catch { fail("GUARD_PIN"); }
  if(doc.errors.length) fail("GUARD_PIN");
  try {
    visit(doc,(_key,node)=>{
      if(node && (isAlias(node) || node.anchor != null || node.tag != null))
        fail("GUARD_PIN");
    });
  } catch { fail("GUARD_PIN"); }

  const map=(node, keys)=>{
    if(!isMap(node)) fail("GUARD_PIN");
    const actual=node.items.map(pair=>{
      if(!isScalar(pair.key) || typeof pair.key.value!=="string" ||
         pair.key.value==="<<") fail("GUARD_PIN");
      return pair.key.value;
    });
    if(new Set(actual).size!==actual.length ||
       actual.length!==keys.length ||
       actual.some(key=>!keys.includes(key))) fail("GUARD_PIN");
    return node;
  };
  const node=(m,key)=>m.get(key,true);
  const eq=(v,expected)=>isScalar(v) && v.value===expected;
  const must=(ok)=>{if(!ok)fail("GUARD_PIN");};
  const strings=(seq,want)=>{
    must(isSeq(seq) && seq.items.length===want.length);
    seq.items.forEach((v,i)=>must(eq(v,want[i])));
  };

  const root=map(doc.contents,["name","on","permissions","jobs"]);
  must(eq(node(root,"name"),"FGM Platform — RepoGuard v6.0.1 exact BASE/HEAD"));
  const on=map(node(root,"on"),["pull_request"]);
  const pr=map(node(on,"pull_request"),["types","branches"]);
  strings(node(pr,"types"),["opened","reopened","synchronize","ready_for_review"]);
  strings(node(pr,"branches"),["main"]);
  const perms=map(node(root,"permissions"),["contents"]);
  must(eq(node(perms,"contents"),"read"));
  const jobs=map(node(root,"jobs"),["repo-guard"]);
  const job=map(node(jobs,"repo-guard"),["name","runs-on","steps"]);
  must(eq(node(job,"name"),"RepoGuard exact BASE/HEAD") &&
       eq(node(job,"runs-on"),"ubuntu-24.04"));
  const steps=node(job,"steps");
  must(isSeq(steps) && steps.items.length===9);
  const step=(index,name,keys)=>{
    const s=map(steps.items[index],["name",...keys]);
    must(eq(node(s,"name"),name));
    return s;
  };
  const withOptions=(s,expected)=>{
    const m=map(node(s,"with"),Object.keys(expected));
    for(const [key,value] of Object.entries(expected))
      must(eq(node(m,key),value));
  };
  const checkout="actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803";
  const setupNode="actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38";
  const pinned="74db97791e6da8a75287164f0d0b41579108f114";
  const eventSha=dim=>"$"+"{{ github.event.pull_request."+dim+".sha }}";

  const source=step(0,"Checkout exact PR HEAD",["uses","with"]);
  must(eq(node(source,"uses"),checkout));
  withOptions(source,{ref:eventSha("head"),"fetch-depth":0,"persist-credentials":false});
  const setup=step(1,"Set up Node.js 24",["uses","with"]);
  must(eq(node(setup,"uses"),setupNode));
  withOptions(setup,{"node-version":"24"});

  const bootstrap=step(2,"Independent positive and negative bootstrap checks",["run"]);
  must(eq(node(bootstrap,"run"),
    "npm ci --ignore-scripts --no-audit --no-fund\n"+
    "node --test tests/bootstrap.test.mjs\n"+
    "node scripts/check-bootstrap.mjs\n"+
    "node --test --test-isolation=none tests/document-language.test.mjs core/tests/document-language.test.mjs regenerator/tests/document-language.test.mjs renderer/tests/document-language.test.mjs\n"+
    "node scripts/check-document-language.mjs\n"));

  const compiler=step(3,"Checkout immutable RepoGuard for independent synthetic transition tests",["uses","with"]);
  must(eq(node(compiler,"uses"),checkout));
  withOptions(compiler,{repository:"netkeep80/repo-guard",ref:pinned,
    path:".rg-transition","persist-credentials":false});

  const oracle=step(4,"Verify real RepoGuard positive and orphan-negative transitions",["run"]);
  must(eq(node(oracle,"run"),
    "(cd .rg-transition && npm install --omit=dev --silent)\n"+
    "node scripts/verify-repoguard-transition.mjs\n"));

  const required=step(5,"RepoGuard exact immutable snapshot",["id","uses","with"]);
  must(eq(node(required,"id"),"required_guard") &&
       eq(node(required,"uses"),"netkeep80/repo-guard@"+pinned));
  withOptions(required,{base:eventSha("base"),head:eventSha("head"),"node-version":"24"});

  const diagCheckout=step(6,"Checkout exact diagnostic compiler after a failed gate",["if","uses","with"]);
  must(eq(node(diagCheckout,"if"),"failure()") &&
       eq(node(diagCheckout,"uses"),checkout));
  withOptions(diagCheckout,{repository:"netkeep80/repo-guard",ref:pinned,
    path:".rg-diagnostics","persist-credentials":false});

  const diag=step(7,"Print exact typed RepoGuard findings (gate remains failed)",["if","run"]);
  must(eq(node(diag,"if"),"failure()") && isScalar(node(diag,"run")) &&
       typeof node(diag,"run").value==="string");

  const summary=step(8,"Show exact RepoGuard diagnostics without bypassing failure",["if","env","run"]);
  must(eq(node(summary,"if"),"always()"));
  const env=map(node(summary,"env"),["RG_STEP","RG_RESULT","RG_SUMMARY"]);
  must(eq(node(env,"RG_STEP"),"$"+"{{ steps.required_guard.outcome }}") &&
       eq(node(env,"RG_RESULT"),"$"+"{{ steps.required_guard.outputs.result }}") &&
       eq(node(env,"RG_SUMMARY"),"$"+"{{ steps.required_guard.outputs.summary }}") &&
       isScalar(node(summary,"run")) && typeof node(summary,"run").value==="string");
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
