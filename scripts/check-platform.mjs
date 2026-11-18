// One current policy. Historical stage policies execute only on their immutable trees.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const POLICY='fgm-platform-policy/2';
export const SCOPE='S05-to-S06A-native-renderer-raster-ownership-shared-quality';
export const BASE='c64a1b7ae9a414386e75d1904efc319bb30a68aa';
export const BASE_TREE='6abd50abcc801f44ead655cdf60a1f96edcad193';
export const HISTORY=Object.freeze([
  ['faff85c3683a7dd87026796bf33ad11ac6d22b33','de224a85b0957ca1de1e26d593a3c1ee099f85e2'],
  ['4c46d0f3aa2176a8d63448c01df55614ce169956','e0f16e7dcbbb66f713f9e3a529291e2e632f78bb'],
  ['5f5971eae131b2b5c79992203d2f27281d217a75','0410d0f6dd49247c53ee0f43a0426f8d82539543'],
  ['0ed4c333cfed939b13180029871043900b372520',BASE_TREE],
]);
const MOVES=Object.freeze({
  "renderer/tests/rvi-v02.test.cpp": "raster/tests/rvi-v02.test.cpp",
  "renderer/tests/v02-c05.test.cpp": "raster/tests/v02-c05.test.cpp",
  "renderer/tests/fixtures/v02-scenes.txt": "raster/tests/fixtures/v02-scenes.txt",
  "renderer/scripts/test-v02.mjs": "raster/scripts/test-v02.mjs",
  "renderer/scripts/mutate-v02.mjs": "raster/scripts/mutate-v02.mjs",
  "core/scripts/check-document-language.mjs": "scripts/check-document-language.mjs",
  "core/tests/document-language.test.mjs": "tests/document-language.test.mjs"
});
const CONSOLIDATED=Object.freeze({
  "regenerator/scripts/check-document-language.mjs": "scripts/check-document-language.mjs",
  "renderer/scripts/check-document-language.mjs": "scripts/check-document-language.mjs"
});
const RETIRED=Object.freeze([
  "regenerator/scripts/check-document-language.mjs",
  "renderer/scripts/check-document-language.mjs",
  "core/.github/workflows/repo-guard.yml",
  "regenerator/.github/workflows/repo-guard.yml",
  "renderer/package-lock.json"
]);
const MOVED_EDITED=Object.freeze([
  "renderer/scripts/test-v02.mjs",
  "renderer/scripts/mutate-v02.mjs"
]);
const ALIASES=Object.freeze(['core/tests/document-language.test.mjs','regenerator/tests/document-language.test.mjs','renderer/tests/document-language.test.mjs','renderer/scripts/test-v02.mjs']);
const ADDED=Object.freeze([
  "raster/tests/rvi-v02.test.cpp",
  "raster/tests/v02-c05.test.cpp",
  "raster/tests/fixtures/v02-scenes.txt",
  "raster/scripts/test-v02.mjs",
  "raster/scripts/mutate-v02.mjs",
  "scripts/check-document-language.mjs",
  "tests/document-language.test.mjs",
  "renderer/tests/scene.test.cpp",
  "requirements/FGMP-RENDERER-001.rg.yaml"
]);
const EDITED=Object.freeze([
  ".gitignore",
  ".github/workflows/core-ci.yml",
  ".github/workflows/repo-guard.yml",
  ".github/workflows/source-snapshots.yml",
  "CMakeLists.txt",
  "README.md",
  "core/README.md",
  "docs/platform.md",
  "docs/requirements-hierarchy.md",
  "package-lock.json",
  "package.json",
  "raster/CMakeLists.txt",
  "regenerator/README.md",
  "renderer/CMakeLists.txt",
  "renderer/README.md",
  "renderer/docs/v02-cpu.md",
  "renderer/package.json",
  "renderer/scripts/test-v03-map.mjs",
  "renderer/scripts/test-v03.mjs",
  "scripts/check-bootstrap.mjs",
  "scripts/check-ctest.mjs",
  "tests/ctest-gate.test.mjs",
  "scripts/check-platform.mjs",
  "tests/platform-policy.test.mjs"
]);
// Reviewed constants. This policy itself is an external exact-HEAD audit boundary.
// BEGIN REVIEWED PINS
const PINS={
  "CMakeLists.txt": {
    "mode": "100644",
    "blob": "d8d5004b71c2995bc474355664a7d5e335a0c02d",
    "sha256": "1cb59cb777a4a0c0d75152327f8d62295587e0ddc2904c874be5564f9a342f37"
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
    "blob": "bd718f121e8a25858fcd53771eb314b82ac13df9",
    "sha256": "46a279eacc736794dd5163fceb659f1253e33501fafda61ff9ea87c3d3f94a4a"
  },
  ".github/workflows/core-ci.yml": {
    "mode": "100644",
    "blob": "deab14f1ab9a375a275226d61508ea6d1a078981",
    "sha256": "2ee9e5c93a94dce344fe332f62371e1fa746a0edbb0c5853fd83a1e645d5f79c"
  },
  ".github/workflows/source-snapshots.yml": {
    "mode": "100644",
    "blob": "afeef085d32daf5c9656593bee5b561c8055a660",
    "sha256": "a4ac76f14256707ffb3780bc4920d16c2322f7b77cfb06762df653ce2bf584e3"
  },
  ".github/workflows/repo-guard.yml": {
    "mode": "100644",
    "blob": "fe75780b2efa30e44575ae45185bd49eea1f78db",
    "sha256": "8d8e7c105f6a3cc4fa0823db0672d03395f98a639f6ade9f69917532c7cf5d5c"
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
    "blob": "4e97f209d80cca2284993149dbee7deea10d3a59",
    "sha256": "034bff824478275a44716b5ea40c1cf49cc5ef712bdb0599cbc8f038ed96f01f"
  },
  "tests/bootstrap.test.mjs": {
    "mode": "100644",
    "blob": "856309851afab01b3ca669051fbc9459f5a4c13f",
    "sha256": "a14f6abe3d83aef27db225f46bb690f9467d5d1228c373fca34da5deb2b3dd74"
  },
  "tests/ctest-gate.test.mjs": {
    "mode": "100644",
    "blob": "c378f55384cf9b99464cf18db17f56dfd9fa9ba0",
    "sha256": "7241a44732d34dc5465dfc7404d4a35865216503ad21ba55d93c8c8610de655f"
  },
  "tests/platform-policy.test.mjs": {
    "mode": "100644",
    "blob": "39418ea79a80c798b5ececab5d580caa1edc1b1c",
    "sha256": "f4eb7dc943fd374cb0bf7a1e8059bc5f1dda8052a4e7bc603f51d37e3d2f52d8"
  },
  "requirements/FGMP-RENDERER-001.rg.yaml": {
    "mode": "100644",
    "blob": "0cb539faf61aad8d6433eb1acb74478b7de6350e",
    "sha256": "6306c6dd8007edaa5f8e4f081dfee93cbed55f6bf49266f7402a366d37b96a3d"
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
  "core/tests/document-language.test.mjs": {
    "mode": "100644",
    "blob": "c51bc1a516460d478f852c89657fd5170c47b3ed",
    "sha256": "d2b5b30c04750629da94636e8697fc317754a0894f7011de5cc0ebafc139163a"
  },
  "regenerator/tests/document-language.test.mjs": {
    "mode": "100644",
    "blob": "c51bc1a516460d478f852c89657fd5170c47b3ed",
    "sha256": "d2b5b30c04750629da94636e8697fc317754a0894f7011de5cc0ebafc139163a"
  },
  "renderer/tests/document-language.test.mjs": {
    "mode": "100644",
    "blob": "c51bc1a516460d478f852c89657fd5170c47b3ed",
    "sha256": "d2b5b30c04750629da94636e8697fc317754a0894f7011de5cc0ebafc139163a"
  },
  "renderer/scripts/test-v02.mjs": {
    "mode": "100644",
    "blob": "596e077fd79e8f94818014207ef901857cebf3b0",
    "sha256": "08772f41e0d785f167854d452bf4686d59a3cb4682947d3964fa352f2f2cb3d4"
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
const PATH_MAP=Object.freeze({
  "renderer/tests/rvi-v02.test.cpp": "raster/tests/rvi-v02.test.cpp",
  "renderer/tests/v02-c05.test.cpp": "raster/tests/v02-c05.test.cpp",
  "renderer/tests/fixtures/v02-scenes.txt": "raster/tests/fixtures/v02-scenes.txt",
  "renderer/scripts/test-v02.mjs": "raster/scripts/test-v02.mjs",
  "renderer/scripts/mutate-v02.mjs": "raster/scripts/mutate-v02.mjs",
  "core/scripts/check-document-language.mjs": "scripts/check-document-language.mjs",
  "core/tests/document-language.test.mjs": "tests/document-language.test.mjs",
  "regenerator/scripts/check-document-language.mjs": "scripts/check-document-language.mjs",
  "regenerator/tests/document-language.test.mjs": "tests/document-language.test.mjs",
  "renderer/scripts/check-document-language.mjs": "scripts/check-document-language.mjs",
  "renderer/tests/document-language.test.mjs": "tests/document-language.test.mjs",
  "core/.github/workflows/repo-guard.yml": ".github/workflows/core-ci.yml",
  "regenerator/.github/workflows/repo-guard.yml": ".github/workflows/repo-guard.yml",
  "renderer/package-lock.json": "package-lock.json"
});
export function requirement(source){
  const out=structuredClone(source);
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    if(value.kind==='artifact'&&PATH_MAP[value.path])value.path=PATH_MAP[value.path];
    if(typeof value.key==='string'&&value.key.startsWith('execution:')){
      const path=value.key.slice('execution:'.length);
      if(PATH_MAP[path])value.key='execution:'+PATH_MAP[path];
    }
    for(const child of Object.values(value))walk(child);
  };
  walk(out);
  if(['FGMC-DOC-001','FGMR-DOC-001','FGMV-DOC-001'].includes(out.id))
    for(const r of out.relations||[])
      if(r.predicates.includes('implemented_by')&&r.target?.path?.endsWith('/repo-guard.yml')
        ||r.predicates.includes('implemented_by')&&r.target?.path==='.github/workflows/core-ci.yml')
        r.target.path='.github/workflows/repo-guard.yml';
  const module=({'FGMC-DOC-001':'core','FGMR-DOC-001':'regenerator','FGMV-DOC-001':'renderer'})[out.id];
  const alias=module?module+'/tests/document-language.test.mjs':out.id.startsWith('FGMV-RVI-')?'renderer/scripts/test-v02.mjs':undefined;
  if(alias)out.relations.push({predicates:['verified_by'],target:{kind:'artifact',path:alias}});
  return out;
}

export function checkPlatform(repo=root,head='HEAD'){
  head=git(repo,'rev-parse',head+'^{commit}');
  git(repo,'merge-base','--is-ancestor',BASE,head);
  equal(git(repo,'rev-parse',BASE+'^{tree}'),BASE_TREE,'BASE_TREE');
  for(const [ref,tree]of HISTORY)equal(git(repo,'rev-parse',ref+'^{tree}'),tree,'HISTORICAL_TREE:'+ref);
  const before=files(repo,BASE),after=files(repo,head);
  const reqs=[...before.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p));
  const editable=new Set([...EDITED,...reqs]);
  // Explicit retirement/consolidation; reintroducing a second owner is a failure.
  for(const ext of ['cpp','hpp'])ensure(!after.has('renderer/src/rvi-v02.'+ext),'DUPLICATE_IMPLEMENTATION:renderer/src/rvi-v02.'+ext);
  for(const p of ALIASES)ensure(after.has(p),'MISSING_TRANSITION_ALIAS:'+p);
  for(const [p,meta]of before){
    if(MOVES[p]){
      if(!ALIASES.includes(p))ensure(!after.has(p),'DUPLICATE_IMPLEMENTATION:'+p);
      if(!MOVED_EDITED.includes(p))equal(after.get(MOVES[p]),meta,'MOVED_CONTENT:'+p);
    }else if(ALIASES.includes(p)){
      ensure(after.has(p),'MISSING_TRANSITION_ALIAS:'+p);
    }else if(RETIRED.includes(p)){
      ensure(!after.has(p),'RETIRED_RESOURCE:'+p);
      if(CONSOLIDATED[p])equal(after.get(CONSOLIDATED[p]),meta,'CONSOLIDATED_CONTENT:'+p);
    }else if(!editable.has(p))equal(after.get(p),meta,'PRESERVED_RESOURCE:'+p);
    else ensure(after.has(p),'MISSING_CURRENT_RESOURCE:'+p);
  }
  equal([...after.keys()].filter(p=>!before.has(p)).sort(),[...ADDED].sort(),'UNDECLARED_NEW_RESOURCE');
  const critical=Object.keys(PINS);
  ensure(critical.length>=12,'POLICY_PINS_MISSING');
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
  ensure([...after.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p)).length===80,'REQUIREMENT_COUNT');
  return {result:'PASS',policy:POLICY,scope:SCOPE,base:BASE,head,
    tree:git(repo,'rev-parse',head+'^{tree}'),critical_content_pins:critical.length,
    normative_values_preserved:79,canonical_requirements:80,historical_refs:HISTORY.length,
    internal_git_fetchcontent:0,raster_implementations:1,required_native_tests:30,
    language_implementations:1,npm_locks:1,nested_legacy_workflows:3,
    temporary_policy_owner:'S06 #9; baseline-specific rules retire/replace S08 #14'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(checkPlatform(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('PLATFORM_POLICY_FAILED: '+error.message);process.exitCode=1;}
}
