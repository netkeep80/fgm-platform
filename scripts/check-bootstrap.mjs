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
  ".github/workflows/platform.yml",
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

  const root=map(doc.contents,["name","on","permissions","env","defaults","jobs"]);
  must(eq(node(root,"name"),"FGM Platform — verify, publish and rollback"));
  const on=map(node(root,"on"),["pull_request","push","workflow_dispatch"]);
  const pr=map(node(on,"pull_request"),["types","branches"]);
  strings(node(pr,"types"),["opened","reopened","synchronize","ready_for_review"]);
  strings(node(pr,"branches"),["main"]);
  const push=map(node(on,"push"),["branches"]);strings(node(push,"branches"),["main"]);
  const perms=map(node(root,"permissions"),["contents"]);
  must(eq(node(perms,"contents"),"read"));
  const environment=map(node(root,"env"),["SOURCE_REV"]);
  must(eq(node(environment,"SOURCE_REV"),"$"+"{{ github.event.pull_request.head.sha || github.sha }}"));
  const defaults=map(node(root,"defaults"),["run"]);
  const runDefaults=map(node(defaults,"run"),["shell"]);
  must(eq(node(runDefaults,"shell"),"bash"));
  const jobs=map(node(root,"jobs"),["repo-guard","platform-policy","core","wasm-browser","release"]);
  const verification="github.event_name != 'workflow_dispatch' || inputs.mode != 'rollback'";
  const expectedNames={"repo-guard":"RepoGuard exact BASE/HEAD","platform-policy":"Platform policy / $"+"{{ matrix.os }}",
    core:"Native Platform / $"+"{{ matrix.os }}","wasm-browser":"Local WASM, WebGPU and Chromium / ubuntu-24.04"};
  for(const [id,name]of Object.entries(expectedNames)){
    const j=node(jobs,id);must(isMap(j)&&eq(node(j,"name"),name)&&eq(node(j,"if"),verification));
    must(!j.has("continue-on-error")&&!j.has("permissions"));
  }
  const release=node(jobs,"release");must(isMap(release));
  must(eq(node(release,"if"),"always() && github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && ((github.event_name == 'workflow_dispatch' && inputs.mode == 'rollback') || (needs.repo-guard.result == 'success' && needs.platform-policy.result == 'success' && needs.core.result == 'success' && needs.wasm-browser.result == 'success'))"));
  strings(node(release,"needs"),["repo-guard","platform-policy","core","wasm-browser"]);
  const releasePermissions=map(node(release,"permissions"),["contents","actions","pages","id-token","attestations"]);
  for(const [name,value]of Object.entries({contents:"write",actions:"read",pages:"write","id-token":"write",attestations:"write"}))
    must(eq(node(releasePermissions,name),value));
  const concurrency=map(node(release,"concurrency"),["group","cancel-in-progress"]);
  must(eq(node(concurrency,"group"),"fgm-platform-pages")&&eq(node(concurrency,"cancel-in-progress"),false));
  const job=map(node(jobs,"repo-guard"),["name","runs-on","steps","if"]);
  must(eq(node(job,"name"),"RepoGuard exact BASE/HEAD")&&eq(node(job,"runs-on"),"ubuntu-24.04"));
  const steps=node(job,"steps");
  must(isSeq(steps) && steps.items.length===10);
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

  const source=step(0,"Checkout exact source",["uses","with"]);
  must(eq(node(source,"uses"),checkout));
  withOptions(source,{ref:"$"+"{{ env.SOURCE_REV }}","fetch-depth":0,"persist-credentials":false});
  const setup=step(1,"Set up Node.js 24",["uses","with"]);
  must(eq(node(setup,"uses"),setupNode));
  withOptions(setup,{"node-version":"24"});

  const bootstrap=step(2,"Independent positive and negative bootstrap checks",["run"]);
  must(eq(node(bootstrap,"run"),
    "npm ci --ignore-scripts --no-audit --no-fund\n"+
    "node --test tests/bootstrap.test.mjs\n"+
    "node scripts/check-bootstrap.mjs\n"+
    "node --test tests/document-language.test.mjs\n"+
    "node scripts/check-document-language.mjs\n"));

  const compiler=step(3,"Checkout immutable RepoGuard for independent synthetic transition tests",["uses","with"]);
  must(eq(node(compiler,"uses"),checkout));
  withOptions(compiler,{repository:"netkeep80/repo-guard",ref:pinned,
    path:".rg-transition","persist-credentials":false});

  const oracle=step(4,"Verify real RepoGuard positive and orphan-negative transitions",["run"]);
  must(eq(node(oracle,"run"),
    "(cd .rg-transition && npm install --omit=dev --silent)\n"+
    "node scripts/verify-repoguard-transition.mjs\n"));

  const transition=step(5,"Determine exact transition BASE",["id","env","run"]);
  must(eq(node(transition,"id"),"transition"));
  const event=map(node(transition,"env"),["EVENT_BASE"]);
  must(eq(node(event,"EVENT_BASE"),"$"+"{{ github.event.pull_request.base.sha || github.event.before }}"));
  must(eq(node(transition,"run"),[
    'base="'+"$"+'{EVENT_BASE:-'+"$"+'(git rev-parse HEAD^1)}"',
    '[[ "'+"$"+'base" =~ ^[0-9a-f]{40}$ ]]',
    'git cat-file -e "'+"$"+'base^{commit}"',
    "printf 'base=%s\\n' \""+"$"+"base\" >> \""+"$"+"GITHUB_OUTPUT\"", ""].join("\n")));
  const required=step(6,"RepoGuard exact immutable snapshot",["id","uses","with"]);
  must(eq(node(required,"id"),"required_guard")&&eq(node(required,"uses"),"netkeep80/repo-guard@"+pinned));
  withOptions(required,{base:"$"+"{{ steps.transition.outputs.base }}",head:"$"+"{{ env.SOURCE_REV }}","node-version":"24"});

  const diagCheckout=step(7,"Checkout exact diagnostic compiler after a failed gate",["if","uses","with"]);
  must(eq(node(diagCheckout,"if"),"failure()") &&
       eq(node(diagCheckout,"uses"),checkout));
  withOptions(diagCheckout,{repository:"netkeep80/repo-guard",ref:pinned,
    path:".rg-diagnostics","persist-credentials":false});

  const diag=step(8,"Print exact typed RepoGuard findings (gate remains failed)",["if","run"]);
  must(eq(node(diag,"if"),"failure()") && isScalar(node(diag,"run")) &&
       typeof node(diag,"run").value==="string");

  const summary=step(9,"Show exact RepoGuard diagnostics without bypassing failure",["if","env","run"]);
  must(eq(node(summary,"if"),"always()"));
  const env=map(node(summary,"env"),["RG_STEP","RG_RESULT","RG_SUMMARY"]);
  must(eq(node(env,"RG_STEP"),"$"+"{{ steps.required_guard.outcome }}") &&
       eq(node(env,"RG_RESULT"),"$"+"{{ steps.required_guard.outputs.result }}") &&
       eq(node(env,"RG_SUMMARY"),"$"+"{{ steps.required_guard.outputs.summary }}") &&
       isScalar(node(summary,"run")) && typeof node(summary,"run").value==="string");
}


export function checkBootstrap(base=root) {
  for (const p of requiredPaths) source(base,p);
  const workflow=source(base,".github/workflows/platform.yml");
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
