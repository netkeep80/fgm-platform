// One current transition policy; no imports or replay of historical stage checkers.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const POLICY='fgm-platform-policy/5';
export const SCOPE='S07A-to-S07B-unified-CI-trusted-release-and-rollback';
export const BASE='a8eb0bdbb1ac844c3d4b9ad1c1a83a1a529eedcd';
export const BASE_TREE='257f81b1517f098c86a17bd586a15ce7fc55f564';
const RETIRED=Object.freeze(['.github/workflows/repo-guard.yml','.github/workflows/core-ci.yml','.github/workflows/platform-policy.yml']);
const FORBIDDEN=Object.freeze([...RETIRED,
  "core/tests/document-language.test.mjs",
  "regenerator/tests/document-language.test.mjs",
  "renderer/tests/document-language.test.mjs",
  "renderer/scripts/test-v02.mjs",
  "regenerator/.github/workflows/importer-ci.yml",
  "renderer/.github/workflows/repo-guard.yml",
  ".github/workflows/source-snapshots.yml",
  "core/.github/workflows/repo-guard.yml",
  "regenerator/.github/workflows/repo-guard.yml",
  "core/scripts/check-document-language.mjs",
  "regenerator/scripts/check-document-language.mjs",
  "renderer/scripts/check-document-language.mjs",
  "renderer/package-lock.json",
  "renderer/tests/rvi-v02.test.cpp",
  "renderer/tests/v02-c05.test.cpp",
  "renderer/tests/fixtures/v02-scenes.txt",
  "renderer/scripts/mutate-v02.mjs",
  "renderer/src/rvi-v02.cpp",
  "renderer/src/rvi-v02.hpp"
]);
const ADDED=Object.freeze(['.github/workflows/platform.yml','renderer/scripts/studio_release.py','renderer/tests/test_studio_release.py','requirements/FGMP-RELEASE-001.rg.yaml']);
const EDITED=Object.freeze(["docs/platform.md", "renderer/docs/studio-pages.md",
  "scripts/check-platform.mjs", "tests/platform-policy.test.mjs"]);
// BEGIN REVIEWED PINS
const PINS={
  "CMakeLists.txt": {
    "mode": "100644",
    "blob": "7c93d45879eeb6dd8c5c6fff6f23ee96edc2bccd",
    "sha256": "6074d14cb27a9a0efcbfbd618cbd44e9e8265525b89749e4a4dbb989012e1e23"
  },
  "core/CMakeLists.txt": {
    "mode": "100644",
    "blob": "2c3ccca7d435ad145a96b8f62dcbfbd79e60d03a",
    "sha256": "acc6364c8c0a6b27cf3555007d58950a3f8b443e13197abc2f2ff7acfe92caad"
  },
  "regenerator/CMakeLists.txt": {
    "mode": "100644",
    "blob": "6d59abc965afc2a3cb03a936a5867a42e135ffd0",
    "sha256": "f41dd4d60d94e74e147ac7d01602337ec83d51b2013555b09a0551e885efe78c"
  },
  "renderer/CMakeLists.txt": {
    "mode": "100644",
    "blob": "95b8581d4235f5b0b5c8fafaab9d524db3020e90",
    "sha256": "81346f653142795176b5ccbdade615b037dae95c6ddd393bc9dddf243d718450"
  },
  "raster/CMakeLists.txt": {
    "mode": "100644",
    "blob": "eaa2e3b25a773b03a4587e3a95a6630b007907bc",
    "sha256": "ca0cc076a2b6eaef6d1f8ef528c7569f67d0ecd3175cf1553bee7b0b00ad614a"
  },
  "scripts/check-ctest.mjs": {
    "mode": "100644",
    "blob": "65998be432454b0412baada81f325e5bf7455bb2",
    "sha256": "c0c3d65fa69e15b065ff43a91a6250fa3346aab4bffcaf489d88047f639248ae"
  },
  "scripts/verify-repoguard-transition.mjs": {
    "mode": "100644",
    "blob": "74473cd2d5c82f9c9fd420ad1dd344d2025fc74d",
    "sha256": "050c6d3848361909e5f6482dd8a6eb704cfc2f99440b69455c5732168c81d7c4"
  },
  "scripts/check-bootstrap.mjs": {
    "mode": "100644",
    "blob": "45ba4fbc196d40b9b471579d951a152de8a0f147",
    "sha256": "845fea50381fa610202116b6382fcabdb7f3d56b540baf253c232312d4f3db89"
  },
  "tests/bootstrap.test.mjs": {
    "mode": "100644",
    "blob": "e055488fde5b0212772b470b31a270ab6ef0ec1d",
    "sha256": "dc80ffb22c1ab997e636b799d35ca01036f7f0fc0a644c4476c5e547b4da7c21"
  },
  "tests/ctest-gate.test.mjs": {
    "mode": "100644",
    "blob": "c378f55384cf9b99464cf18db17f56dfd9fa9ba0",
    "sha256": "7241a44732d34dc5465dfc7404d4a35865216503ad21ba55d93c8c8610de655f"
  },
  "tests/platform-policy.test.mjs": {
    "mode": "100644",
    "blob": "cc4964fea25ac485302d5867ed7a3b4ae64207bb",
    "sha256": "40951a5d547784f71e56bad22ea489bc056f9dd5da72171473e470e1a6aae26e"
  },
  "requirements/FGMP-WASM-001.rg.yaml": {
    "mode": "100644",
    "blob": "ea0fe875eb543b1f8ac459fc629ea5c8296fa14d",
    "sha256": "a56294b918a49a850c8eaa2fc55c8d263a192c48749c296cf7594bf4515a945c"
  },
  "package.json": {
    "mode": "100644",
    "blob": "17124ac3aa30e9dfc5b8c25e18f1c96823032ac0",
    "sha256": "ed7a2d25ceabdb380526e49e4a8d0d175e68f514223a66326b89ebb9a348a729"
  },
  "package-lock.json": {
    "mode": "100644",
    "blob": "c816b6800a04e4b1e732c2f74802a59815ba09e2",
    "sha256": "018ea6addc729feb64071da75103303a2ab4c2b09d2bc4e1a152ef75bd3d4ccc"
  },
  "renderer/package.json": {
    "mode": "100644",
    "blob": "022d4a10debafede030750d99f48774dac2988ae",
    "sha256": "4f36bdc782cff8217525b2b4a945cf09675779d667cb4442d337826964d30983"
  },
  "raster/scripts/test-v02.mjs": {
    "mode": "100644",
    "blob": "d9408731640ef18b09a78af3d738b482a469de48",
    "sha256": "cd46504bab36288b3a635a4818589a66f31deba8870375ed7d7a0c9168df8ecd"
  },
  "raster/scripts/mutate-v02.mjs": {
    "mode": "100644",
    "blob": "8459fcf5d0ac9feba54be3d4f6cdb1cb49784346",
    "sha256": "6cac5cf68c4c70f0c27923c762223f603dcb6145784779bf2b360dfdd9bbfe4b"
  },
  "renderer/scripts/test-v03.mjs": {
    "mode": "100644",
    "blob": "fcf8ea0d3003a7cd43b2a427664e2d4da6ef7aeb",
    "sha256": "2584677db7b459190d21c495aef364bcb38297a040d9078519d2679e28f24edf"
  },
  "renderer/scripts/test-v03-map.mjs": {
    "mode": "100644",
    "blob": "1cace628f2bbbb7bea675909cb37bec965a518d5",
    "sha256": "a564e574da8f1931c1d0d039cc4b12a4a37f96de8c34b2ca29264d42e72ba861"
  },
  "renderer/tests/scene.test.cpp": {
    "mode": "100644",
    "blob": "b05aedecabb80247a226471b32006e82b0c87e92",
    "sha256": "a80d53eb971bc7c828e1a02d9b9e398fb98288b5708fecda917a358c2dfad50b"
  },
  "renderer/scripts/build-studio-s2a.mjs": {
    "mode": "100644",
    "blob": "43a5bc098a31ffe9382086019e97ebbb2be693c5",
    "sha256": "9500eec9decca51d0dd42d912f9cd59b04b97679888c99099331c5cdf20d547a"
  },
  "renderer/scripts/stage-web.mjs": {
    "mode": "100644",
    "blob": "5649717496db8c9178f62c28d5cb395799d83798",
    "sha256": "ef1902ca10939acdd0c9ffebd306533d718f08f833537a1e4c91e4e5489069bf"
  },
  "renderer/scripts/studio_pages.py": {
    "mode": "100644",
    "blob": "e1f5f3b99c78d7b631454c88fb5432fde51c74cb",
    "sha256": "4fecdac42206823c88ba88a0e8bde58342c30db8d5802859b95db11ffa22781c"
  },
  "renderer/studio/engine-lock.json": {
    "mode": "100644",
    "blob": "0708971fa7077380dc4493649c30149efa56c6f7",
    "sha256": "b2729555da35396b1fa2e8e0186c95a94982e5c4389093c7287461046af74c4d"
  },
  "renderer/tests/studio-bundle.test.mjs": {
    "mode": "100644",
    "blob": "7b0f5e26f5788c2affeb4533b20c632e2c02d9ca",
    "sha256": "4546cc1ab7838faa6c6cb750809369c52fd6f12404aa1118f7e2f82f917652dc"
  },
  "renderer/tests/local-browser.mjs": {
    "mode": "100644",
    "blob": "992138d5606d651882f9f2c4af96cb9825c9309f",
    "sha256": "34600398edb36fbd1c1dcc5f036e4a553c85066a5dc1acd219e43026fae51730"
  },
  "renderer/tests/local-browser.test.mjs": {
    "mode": "100644",
    "blob": "8f1891849f421aa233c0166fce157213c79aede8",
    "sha256": "926d2a242bec27ac30a0e4e34f4b6ec32171d60eb054aa7e8d9d4763b3d485ac"
  },
  "renderer/tests/browser.test.mjs": {
    "mode": "100644",
    "blob": "bb313a7defe62c3000b2f2305b3f9fd774dacdb5",
    "sha256": "2845b88e5a63f5521fc8fbe008b41ed506f6ff919751ad132de4049c4b08d977"
  },
  "renderer/tests/renderer-session.browser.mjs": {
    "mode": "100644",
    "blob": "b432b91d21f3b634e4c9652068be4b0e4ff08ae6",
    "sha256": "d66ba148fc28baeb193bafb5c37a6fa372eff41ade9d6e9b0829d5a1b2013cba"
  },
  "renderer/tests/renderer-session-wasm.browser.mjs": {
    "mode": "100644",
    "blob": "d8379b5fa94dabd13610d579521b0f9a76ae133d",
    "sha256": "c081b200968df05765dad9064b8f711b474b00d7d648aed508644ff0322119d0"
  },
  "renderer/tests/renderer-depth-oracle.browser.mjs": {
    "mode": "100644",
    "blob": "eb36a5c63a0e37b96fe80dd435f1eb802dfbf3db",
    "sha256": "fa63184d7a73f7f66b7247c69814b06216eccd0569bb0a7e8e3318cb8b46a1d0"
  },
  "renderer/tests/studio-s2a.browser.mjs": {
    "mode": "100644",
    "blob": "5de71d15deb01cf9d30ddd143a1b81f3746b9842",
    "sha256": "2bc45955c380ca464db5c924d05bd9b44cce33facecafc322fa76bef7a188df4"
  },
  "renderer/tests/test_studio_pages.py": {
    "mode": "100644",
    "blob": "2363a2e834f3ad409501bdacb3cfcee00ba5948c",
    "sha256": "11bd11e92aab32dc09bfc53da2336df36f6a4a646fb5597b10c490cd2d4446cd"
  },
  "renderer/tests/studio-pages.live.mjs": {
    "mode": "100644",
    "blob": "b0e0fefc88f59677e415d2fe59a9689b38be65fa",
    "sha256": "08a047254d84648c5a9c177b39c063caba26e3301472687740a68c4d4e40ca6a"
  },
  "renderer/tests/studio-pages-live.test.mjs": {
    "mode": "100644",
    "blob": "40287bdfa373701d98687ec056e37a9a771713ea",
    "sha256": "48a0c51936cdf3f2d6d63d6fb8b0fcd168159303a014f90293e422cd91df55c9"
  },
  ".github/workflows/platform.yml": {
    "mode": "100644",
    "blob": "84c3d6b52c436b8667274c0bb393a1e054df160f",
    "sha256": "a5fc29f04734127def487b98df85d1efd8848d9b4d8fc015f88c6f2ecf951797"
  },
  "renderer/scripts/studio_release.py": {
    "mode": "100644",
    "blob": "53f8720d52f3f74fc2bf72d9d3c21abb4c5a0901",
    "sha256": "e17e338a87c505dc101809a810dee137bb7363e21f8f5178c73d69a7527887d3"
  },
  "renderer/tests/test_studio_release.py": {
    "mode": "100644",
    "blob": "8c6eb5435ce5f476d0089f0661a0d79e2adc4b2a",
    "sha256": "a0aa5cf0338f49b3981ccdf66121ca20f99b46626a0a588fad4c742d23b10414"
  },
  "requirements/FGMP-RELEASE-001.rg.yaml": {
    "mode": "100644",
    "blob": "9f4792f4df7e2468ed4a4dc11540d292d929b678",
    "sha256": "a08a3d0fd1d47c3ad8772830391e0adb7a7e559d14040faf6d6e75e2de919b63"
  }
};
// END REVIEWED PINS
const ensure=(ok,code)=>{if(!ok)throw new Error(code);};
export const git=(repo,...args)=>execFileSync('git',['-C',repo,...args],
  {encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
const stable=v=>JSON.stringify(v&&typeof v==='object'
  ?Array.isArray(v)?v.map(x=>JSON.parse(stable(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])):v);
const equal=(a,b,code)=>ensure(stable(a)===stable(b),code);
export function parse(raw){
  const d=parseDocument(String(raw),{version:'1.2',uniqueKeys:true,merge:false,strict:true});
  ensure(!d.errors.length&&!d.warnings.length,'INVALID_YAML');return d.toJS({maxAliasCount:0});
}
const files=(repo,ref)=>new Map(git(repo,'ls-tree','-r','-z',ref).split('\0').filter(Boolean).map(s=>{
  const [meta,path]=s.split('\t');return [path,meta];
}));
// One batch, not hundreds of git processes on Windows. Read immutable object bytes.
function contents(repo,requests){
  const output=execFileSync('git',['-C',repo,'cat-file','--batch'],
    {input:requests.join('\n')+'\n',maxBuffer:32*1024*1024,stdio:['pipe','pipe','pipe']});
  let at=0;const result=new Map();
  for(const name of requests){
    const end=output.indexOf(10,at),header=output.subarray(at,end).toString();
    const m=/^[a-f0-9]{40} blob (\d+)$/.exec(header);ensure(m,'MISSING_POLICY_RESOURCE:'+name);
    const size=Number(m[1]);at=end+1;result.set(name,output.subarray(at,at+size));at+=size+1;
  }
  return result;
}
export function requirement(source){
  const out=structuredClone(source);
  const oldCI=['.github/workflows/repo-guard.yml','.github/workflows/core-ci.yml','.github/workflows/platform-policy.yml'];
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    if(value.kind==='artifact'&&(oldCI.includes(value.path)||out.id==='FGMV-PUB-003'&&value.path==='renderer/.github/workflows/studio-pages.yml'))
      value.path='.github/workflows/platform.yml';
    for(const v of Object.values(value))walk(v);
  };
  walk(out);const seen=new Set();
  out.relations=out.relations.filter(r=>{const key=stable(r);if(seen.has(key))return false;seen.add(key);return true;});
  return out;
}
export function checkPlatform(repo=root,head='HEAD'){
  head=git(repo,'rev-parse',head+'^{commit}');
  git(repo,'merge-base','--is-ancestor',BASE,head);
  equal(git(repo,'rev-parse',BASE+'^{tree}'),BASE_TREE,'BASE_TREE');
  const before=files(repo,BASE),after=files(repo,head);
  const reqs=[...before.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p));
  for(const p of FORBIDDEN)ensure(!after.has(p),'RETIRED_RESOURCE:'+p);
  const critical=Object.keys(PINS),editable=new Set([...EDITED,...reqs,...critical]);
  for(const [p,meta]of before){
    if(RETIRED.includes(p))continue;
    if(!editable.has(p))equal(after.get(p),meta,'PRESERVED_RESOURCE:'+p);
    else ensure(after.has(p),'MISSING_CURRENT_RESOURCE:'+p);
  }
  equal([...after.keys()].filter(p=>!before.has(p)).sort(),[...ADDED].sort(),'UNDECLARED_NEW_RESOURCE');
  ensure(critical.length>=20,'POLICY_PINS_MISSING');
  const requests=[...reqs.flatMap(p=>[BASE+':'+p,head+':'+p]),...critical.map(p=>head+':'+p)];
  const raw=contents(repo,requests);
  for(const path of critical){
    const pin=PINS[path];equal(after.get(path),pin.mode+' blob '+pin.blob,'CRITICAL_CONTENT:'+path);
    equal(createHash('sha256').update(raw.get(head+':'+path)).digest('hex'),pin.sha256,'CRITICAL_SHA256:'+path);
  }
  for(const path of reqs){
    equal(parse(raw.get(head+':'+path)),requirement(parse(raw.get(BASE+':'+path))),'REQUIREMENT_DRIFT:'+path);
    equal(after.get(path)?.split(' ')[0],before.get(path).split(' ')[0],'REQUIREMENT_MODE:'+path);
  }
  ensure([...after.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p)).length===82,'REQUIREMENT_COUNT');
  return {result:'PASS',policy:POLICY,scope:SCOPE,base:BASE,head,tree:git(repo,'rev-parse',head+'^{tree}'),
    critical_content_pins:critical.length,normative_values_preserved:81,normative_updates:[],
    existing_ids_lifecycle_preserved:81,canonical_requirements:82,required_native_tests:30,
    internal_git_fetchcontent:0,raster_implementations:1,language_implementations:1,npm_locks:1,
    temporary_verifier_aliases:0,nested_legacy_workflows:1,historical_replay_required:false,
    execution_constraints_preserved:22,execution_constraints_added:1,root_ci_workflows:1,
    publication_admission:'Immutable current main CI origin/provider digest and signed retained Platform release',
    production_deployment:'REQUIRES_ACCEPTED_MAIN_AND_REAL_POSTMERGE_EVIDENCE',
    temporary_policy_owner:'S07B #10; remove baseline rules after current replacement S08 #14; no archive gate'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(checkPlatform(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('PLATFORM_POLICY_FAILED: '+error.message);process.exitCode=1;}
}
