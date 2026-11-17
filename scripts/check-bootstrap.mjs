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
export function checkBootstrap(base=root) {
  for (const p of requiredPaths) source(base,p);
  const workflow=source(base,".github/workflows/repo-guard.yml");
  if(!workflow.includes("uses: netkeep80/repo-guard@"+PIN) ||
     !workflow.includes("github.event.pull_request.base.sha") ||
     !workflow.includes("github.event.pull_request.head.sha") ||
     !workflow.includes("ready_for_review") ||
     !workflow.includes("node scripts/verify-repoguard-transition.mjs") ||
     !workflow.includes("id: required_guard") ||
     /continue-on-error:\s*true/.test(workflow)) fail("GUARD_PIN");
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
