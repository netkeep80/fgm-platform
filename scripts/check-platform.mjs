// One current policy. Historical stage policies execute only on their immutable trees.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const POLICY='fgm-platform-policy/1';
export const SCOPE='S04-to-S05-native-core-raster-regenerator';
export const BASE='431977d0a9d3126b74dce2373003c229786f596b';
export const BASE_TREE='0410d0f6dd49247c53ee0f43a0426f8d82539543';
export const HISTORY=Object.freeze([
  ['faff85c3683a7dd87026796bf33ad11ac6d22b33','de224a85b0957ca1de1e26d593a3c1ee099f85e2'],
  ['4c46d0f3aa2176a8d63448c01df55614ce169956','e0f16e7dcbbb66f713f9e3a529291e2e632f78bb'],
  ['5f5971eae131b2b5c79992203d2f27281d217a75',BASE_TREE],
]);
const MOVES=Object.freeze(Object.fromEntries(['cpp','hpp'].map(ext=>[
  'renderer/src/rvi-v02.'+ext,'raster/rvi-v02.'+ext])));
const ADDED=['raster/CMakeLists.txt','scripts/check-platform.mjs','tests/platform-policy.test.mjs',
  'requirements/FGMP-BUILD-001.rg.yaml','docs/platform.md',...Object.values(MOVES)];
const EDITED=['CMakeLists.txt','core/CMakeLists.txt','regenerator/CMakeLists.txt','renderer/CMakeLists.txt',
  'renderer/tests/rvi-v02.test.cpp','renderer/tests/v02-c05.test.cpp',
  'renderer/scripts/test-v02.mjs','renderer/scripts/mutate-v02.mjs','renderer/docs/v02-cpu.md',
  'scripts/check-ctest.mjs','tests/ctest-gate.test.mjs',
  '.github/workflows/core-ci.yml','.github/workflows/source-snapshots.yml',
  'README.md','docs/requirements-hierarchy.md','scripts/verify-repoguard-transition.mjs'];
// Reviewed constants. This policy itself is an external exact-HEAD audit boundary.
// BEGIN REVIEWED PINS
const PINS={
  "CMakeLists.txt": {
    "mode": "100644",
    "blob": "0288712c6cb0e194976e7940dbb49a1216cac49d",
    "sha256": "de06f9a63a8ea1afffa0ddfb985704980d405efb957cf445ef47d87d40e757e1"
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
    "blob": "f081c8852a2b7be5d24007c79a9a6e1a0e36ba98",
    "sha256": "cf2cb01581576e87ba0f899ac77a65d5e5575fd1f3e13a00642467eae8a8ad02"
  },
  "raster/CMakeLists.txt": {
    "mode": "100644",
    "blob": "14ce850d24634d741bee7b4e81bd8d21ea374024",
    "sha256": "8ad0aed0f02c53ebf32693005fc18d8a835631528d8b420630f45dd1074c9224"
  },
  ".github/workflows/core-ci.yml": {
    "mode": "100644",
    "blob": "aac41c0bbe51a1e5cf5a3ca52cca3dd209b70018",
    "sha256": "fd4ba8a6d4df3cce6add8df81bbb34c1c77e18acdd53956ebaaac5a14cf77032"
  },
  ".github/workflows/source-snapshots.yml": {
    "mode": "100644",
    "blob": "6b774c45c0a536c6aaef63de15689657db44ae40",
    "sha256": "eda60e4b03b316cc50e41569a89a4f67c0eb39b812ad9fbae0958207e8400f84"
  },
  "scripts/check-ctest.mjs": {
    "mode": "100644",
    "blob": "bed32331ccf55b3f8d2598a76db030bd597e34e3",
    "sha256": "62e491106e8949406e297ad36cb436b98329da3edd0f79079efacdc00cad0671"
  },
  "scripts/verify-repoguard-transition.mjs": {
    "mode": "100644",
    "blob": "74473cd2d5c82f9c9fd420ad1dd344d2025fc74d",
    "sha256": "050c6d3848361909e5f6482dd8a6eb704cfc2f99440b69455c5732168c81d7c4"
  },
  "tests/ctest-gate.test.mjs": {
    "mode": "100644",
    "blob": "8fd8c7b65d8f7826beae67daafef3a60beaba3be",
    "sha256": "49af664d988698026af0c59146a0242a69d4c174cdd2ba9f4a2d282a0b607d31"
  },
  "tests/platform-policy.test.mjs": {
    "mode": "100644",
    "blob": "9e04e1dd2d20c91334d5dc96cdfbf2ea2b928b79",
    "sha256": "422c74a28df27aeab15d81f91414b6aceb4e796935e1bbfb21358ab8fd882edf"
  },
  "requirements/FGMP-BUILD-001.rg.yaml": {
    "mode": "100644",
    "blob": "64e24477cd8c2ab69862ffff060e47699a2b2c23",
    "sha256": "d740189e29ef6a380259cd5266cae30aefdd42aa0cca4860767e392d4c7b8c0c"
  },
  "renderer/scripts/test-v02.mjs": {
    "mode": "100644",
    "blob": "cd7f2cf9683859a539b395e7553fdf3c8be3136b",
    "sha256": "78b7a84096bd1ea2d8ecee29097700ad2951919ec0735c2846b66c32a7858c7b"
  },
  "renderer/scripts/mutate-v02.mjs": {
    "mode": "100644",
    "blob": "51e6e95f4d4195d8e25449c1be924df2df16f571",
    "sha256": "cb69d4b1f61a22e0ac84c2f0599e76dd28a72a0e29ff32fb577b8f2bb7377ec9"
  },
  "renderer/tests/rvi-v02.test.cpp": {
    "mode": "100644",
    "blob": "a5fbb4870e6ec3ac8a67db4a783bebbd8a90c2b3",
    "sha256": "a598c4708d068d729a0c512ed97ead31ab7247b6a4651c47dfff4a20929b5f66"
  },
  "renderer/tests/v02-c05.test.cpp": {
    "mode": "100644",
    "blob": "53d8bb8f880361d42b074f70e829deb87002ecd4",
    "sha256": "cc9e5f69e9c9440a9048aae6e4024d9254ba464721e619a9d8024c7009bed4ff"
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
  for(const r of out.relations||[]){
    if(MOVES[r.target?.path])r.target.path=MOVES[r.target.path];
    if(out.id.startsWith('FGMR-')&&r.target?.path==='regenerator/.github/workflows/importer-ci.yml'
      &&r.predicates.includes('implemented_by'))r.target.path='.github/workflows/core-ci.yml';
  }
  return out;
}

export function checkPlatform(repo=root,head='HEAD'){
  head=git(repo,'rev-parse',head+'^{commit}');
  git(repo,'merge-base','--is-ancestor',BASE,head);
  equal(git(repo,'rev-parse',BASE+'^{tree}'),BASE_TREE,'BASE_TREE');
  for(const [ref,tree]of HISTORY)equal(git(repo,'rev-parse',ref+'^{tree}'),tree,'HISTORICAL_TREE:'+ref);
  const before=files(repo,BASE),after=files(repo,head);
  const reqs=[...before.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p));
  const editable=new Set([...EDITED,...reqs,...Object.keys(MOVES)]);
  for(const [p,meta]of before){
    if(MOVES[p]){equal(after.get(MOVES[p]),meta,'MOVED_CONTENT:'+p);ensure(!after.has(p),'DUPLICATE_IMPLEMENTATION:'+p);}
    else if(!editable.has(p))equal(after.get(p),meta,'PRESERVED_RESOURCE:'+p);
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
  ensure([...after.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p)).length===79,'REQUIREMENT_COUNT');
  return {result:'PASS',policy:POLICY,scope:SCOPE,base:BASE,head,
    tree:git(repo,'rev-parse',head+'^{tree}'),critical_content_pins:critical.length,
    normative_values_preserved:78,canonical_requirements:79,historical_refs:HISTORY.length,
    internal_git_fetchcontent:0,raster_implementations:1,required_native_tests:27,
    temporary_policy_owner:'S05 #8; baseline-specific rules retire/replace S08 #14'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(checkPlatform(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('PLATFORM_POLICY_FAILED: '+error.message);process.exitCode=1;}
}
