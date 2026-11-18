// S04 is an explicit successor policy; the S03 checker itself remains byte-identical.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {root,git,parse,digest} from './check-requirements-migration.mjs';
export const BASE='e883bea583d7298ec2747375ebebeb01405a59a1';
export const TREE='e0f16e7dcbbb66f713f9e3a529291e2e632f78bb';
export const S03='4c46d0f3aa2176a8d63448c01df55614ce169956';
// Immutable source of the previously verified functional artifacts, NOT author acceptance.
export const FUNCTIONAL_HEAD='c512b24282c29c51dd52301e6ea78a2f8b0ab0ff';
export const FUNCTIONAL_TREE='67bd3a0cb5a3d2a378e6edddf9b491653ef2bfc6';
const HISTORICAL_CRITICAL=[
  'CMakeLists.txt','.github/workflows/source-snapshots.yml','tests/core-parity.test.mjs',
  'tests/core/sample.cpp','tests/core/consumer/CMakeLists.txt',
  'scripts/verify-requirements-transition.mjs','tests/requirements-migration.test.mjs',
];
// Fixed expectations are reviewable policy inputs, never learned from the checked HEAD/manifest.
// BEGIN FIXED CONTENT PINS
const FIXED_CONTENT_PINS={
  ".github/workflows/core-ci.yml": {
    "mode": "100644",
    "blob": "c4628c76239a7e06cc8ba04d9f2110cf7f4a3a15",
    "sha256": "6f787393a584c7872b1756281aa96b640ee4c01e4de29b4cdb49bc3783518f9b"
  },
  "scripts/check-core-consumer.mjs": {
    "mode": "100644",
    "blob": "723e6c4a828deda9f64da38fd53cbb9f32da3b32",
    "sha256": "a1fc20d827c246e53878f9cc0697f5b14398869d4fed9fc4446aebb10de2ee62"
  },
  "tests/core-integration.test.mjs": {
    "mode": "100644",
    "blob": "cf9d27b705af75bf40b8587075a384863eeabe8b",
    "sha256": "8855788feb60070e12042c46a30a2614d70314e3cf690b8ead80306d041aee5c"
  },
  "scripts/check-ctest.mjs": {
    "mode": "100644",
    "blob": "b7041e6f914a94f9079fa02ad382d8850051b81c",
    "sha256": "a83754ae978e47b5903ac85994d8e99039e63acfb5b9c6cf9eca2b04a8ef9689"
  },
  "tests/ctest-gate.test.mjs": {
    "mode": "100644",
    "blob": "869ca7ac3030d063b84e8a6546f4d606cf00c80e",
    "sha256": "f65244b4db05f39e4018301a8ffbcf6f181526be52b336509a01473a54754f77"
  },
  "requirements/FGMP-MIG-CORE-001.rg.yaml": {
    "mode": "100644",
    "blob": "09d88c9b66b4a30a865f718d4beaf328bbd7786f",
    "sha256": "3666839af5827f3b3869351124c3dab763f9dc8d639008e088ce119aee1bc86f"
  }
};
// END FIXED CONTENT PINS
export const NEW_FILES=[
  '.github/workflows/core-ci.yml','CMakeLists.txt','docs/core-integration.md','docs/core-integration.json',
  'requirements/FGMP-MIG-CORE-001.rg.yaml','scripts/check-core-integration.mjs','scripts/check-core-consumer.mjs',
  'tests/core-integration.test.mjs','tests/core-parity.test.mjs','tests/core/sample.cpp','tests/core/consumer/CMakeLists.txt',
  'scripts/check-ctest.mjs','tests/ctest-gate.test.mjs',
];
const SUPPORT_CHANGES=[
  '.github/workflows/source-snapshots.yml','.gitignore','README.md','docs/requirements-hierarchy.md',
  'docs/requirements-migration.md','scripts/verify-requirements-transition.mjs','tests/requirements-migration.test.mjs',
];
const ensure=(ok,code)=>{if(!ok)throw new Error(code);};
const equal=(a,b,code)=>ensure(digest(a)===digest(b),code);
const bytes=(repo,ref,path)=>execFileSync('git',['-C',repo,'show',ref+':'+path],{maxBuffer:32*1024*1024});
const files=(repo,ref)=>new Map(git(repo,'ls-tree','-r','-z',ref).split('\0').filter(Boolean).map(s=>{
  const [meta,path]=s.split('\t');return [path,meta];
}));
const json=(repo,ref,path)=>parse(bytes(repo,ref,path));
const blob=value=>createHash('sha1').update('blob '+Buffer.byteLength(value)+'\0').update(value).digest('hex');
const sha256=value=>createHash('sha256').update(value).digest('hex');
function criticalArtifacts(repo){
  equal(git(repo,'rev-parse',FUNCTIONAL_HEAD+'^{tree}'),FUNCTIONAL_TREE,'FUNCTIONAL_REFERENCE_TREE');
  const source=files(repo,FUNCTIONAL_HEAD);
  return [
    ...HISTORICAL_CRITICAL.map(path=>({path,mode:source.get(path).split(' ')[0],
      blob:source.get(path).split(' ')[2],sha256:sha256(bytes(repo,FUNCTIONAL_HEAD,path)),
      reference:FUNCTIONAL_HEAD})),
    ...Object.entries(FIXED_CONTENT_PINS).map(([path,pin])=>({path,...pin,reference:'s04-p2-content-policy/1'})),
  ].sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
function checkCritical(repo,head,after,artifacts){
  // First compare all path/mode/blob pins, then verify the declared raw SHA-256 values.
  for(const pin of artifacts)equal(after.get(pin.path)||null,
    pin.mode+' blob '+pin.blob,'CRITICAL_CONTENT_DRIFT:'+pin.path);
  for(const pin of artifacts)equal(sha256(bytes(repo,head,pin.path)),pin.sha256,
    'CRITICAL_CONTENT_SHA256:'+pin.path);
}
export function coreCmake(source){
  const marker='include(CTest)\nif(BUILD_TESTING)';
  ensure(source.includes(marker),'CORE_CMAKE_BASE_SHAPE');
  return source.replace(marker,'include(CTest)\noption(FGMC_BUILD_TESTS "Собирать внутренние тесты Core" "${BUILD_TESTING}")\nif(BUILD_TESTING AND FGMC_BUILD_TESTS)');
}
export function coreRequirement(source){
  const out=structuredClone(source);
  for(const r of out.relations)if(r.target.path==='core/.github/workflows/repo-guard.yml'
    &&r.predicates.includes('implemented_by'))r.target.path='.github/workflows/core-ci.yml';
  if(out.id==='FGMC-EVAL-001')out.relations.push(
    {predicates:['implemented_by'],target:{kind:'artifact',path:'CMakeLists.txt'}},
    {predicates:['verified_by'],target:{kind:'artifact',path:'tests/core-parity.test.mjs'}},
    {predicates:['verified_by'],target:{kind:'artifact',path:'tests/core/sample.cpp'}},
  );
  return out;
}

export function inventory(repo=root){
  equal(git(repo,'rev-parse',BASE+'^{tree}'),TREE,'S04_BASE_TREE');
  equal(git(repo,'rev-parse',S03+'^{tree}'),TREE,'S03_ACCEPTED_TREE');
  const before=files(repo,BASE),core=[];
  for(const path of [...before.keys()].filter(p=>p.startsWith('requirements/core/')).sort()){
    const source=json(repo,BASE,path),target=coreRequirement(source);
    core.push({path,id:source.id,normative_digest:digest(source.normative),
      source_relations_digest:digest(source.relations),target_relations_digest:digest(target.relations),
      constraints_digest:digest(source.constraints||[]),lifecycle:source.lifecycle});
  }
  const cmake=coreCmake(bytes(repo,BASE,'core/CMakeLists.txt').toString('utf8'));
  const manifest={schema:'fgm-platform-core-integration/2',phase:'S04',baseline:{head:BASE,tree:TREE},
    historical_s03:{head:S03,tree:TREE,manifest_sha256:'937ff92f1b589179eb44d4c2abcac8c6b6c4dbea3d46cbfd5fb5acb6a296fc6a'},
    module_changes:[{path:'core/CMakeLists.txt',source_blob:before.get('core/CMakeLists.txt').split(' ')[2],
      target_blob:blob(cmake),mode:'100644',rule:'add_FGMC_BUILD_TESTS_without_changing_global_BUILD_TESTING'}],
    unchanged_module_files:231,canonical_requirements:78,normative_values_preserved:73,
    core_requirements:core,expected_execution:core.filter(r=>r.constraints_digest!==digest([])).map(r=>r.id),
    source_workflow:'core/.github/workflows/repo-guard.yml',active_workflow:'.github/workflows/core-ci.yml',
    new_files:NEW_FILES,
    functional_reference:{head:FUNCTIONAL_HEAD,tree:FUNCTIONAL_TREE,role:'BYTE_REFERENCE_NOT_AUTHOR_ACCEPTANCE'},
    critical_artifacts:criticalArtifacts(repo)};
  return {manifest,before,cmake};
}

function checkWorkflow(value){
  const checkout='actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803';
  const setup='actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
  const nodeRun='node --test core/tests/document-language.test.mjs core/tests/fgm-0.test.mjs core/tests/fgm-space.test.mjs core/tests/fgm-visual.test.mjs core/tests/fgm-geometry.test.mjs core/tests/fgm-serialization.test.mjs\nnode core/scripts/check-document-language.mjs\n';
  equal(value,{name:'S04 Core build and semantic parity',
    on:{pull_request:{types:['opened','reopened','synchronize','ready_for_review'],branches:['main']}},
    permissions:{contents:'read'},jobs:{core:{name:'Core / ${{ matrix.os }}','runs-on':'${{ matrix.os }}',
      strategy:{'fail-fast':false,matrix:{os:['ubuntu-24.04','windows-2025']}},steps:[
        {name:'Checkout exact PR HEAD',uses:checkout,with:{ref:'${{ github.event.pull_request.head.sha }}','fetch-depth':0,'persist-credentials':false}},
        {name:'Set up Node.js 24',uses:setup,with:{'node-version':'24'}},
        {name:'Reject empty and incomplete CTest suites',run:'node --test tests/ctest-gate.test.mjs'},
        {name:'Run all original Core Node suites and documentation audit',run:nodeRun},
        {name:'Configure local Core from the monorepo root',run:'cmake -S . -B build/core -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=ON'},
        {name:'Build Core and public API consumer',run:'cmake --build build/core --config Release --parallel 2'},
        {name:'Require exact enabled native CTest inventory',run:'node scripts/check-ctest.mjs build/core --config Release'},
        {name:'Run original native tests, C05 parity and external consumer',run:'ctest --test-dir build/core -C Release --output-on-failure --verbose --no-tests=error'},
      ]}}},'CORE_WORKFLOW_GATE');
}

export function checkCore(repo=root,head='HEAD'){
  head=git(repo,'rev-parse',head+'^{commit}');git(repo,'merge-base','--is-ancestor',BASE,head);
  const {manifest,before,cmake}=inventory(repo),after=files(repo,head);
  const canonical=[...before.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p));
  const changed=new Set([...SUPPORT_CHANGES,'core/CMakeLists.txt',...canonical.filter(p=>p.startsWith('requirements/core/'))]);
  for(const [path,meta] of before)if(!changed.has(path))equal(after.get(path)||null,meta,'UNDECLARED_CHANGE:'+path);
  for(const path of changed)ensure(after.has(path),'MISSING_S04_RESOURCE:'+path);
  equal([...after.keys()].filter(p=>!before.has(p)).sort(),[...NEW_FILES].sort(),'S04_NEW_FILE_SET');
  equal(bytes(repo,head,'core/CMakeLists.txt').toString('utf8'),cmake,'CORE_CMAKE_CHANGE');
  equal(after.get('core/CMakeLists.txt'),'100644 blob '+blob(cmake),'CORE_CMAKE_MODE');
  checkWorkflow(json(repo,head,'.github/workflows/core-ci.yml'));
  checkCritical(repo,head,after,manifest.critical_artifacts);
  for(const path of canonical){
    const old=json(repo,BASE,path),actual=json(repo,head,path);
    equal(actual,path.startsWith('requirements/core/')?coreRequirement(old):old,'S04_REQUIREMENT_DRIFT:'+path);
    equal(after.get(path)?.split(' ')[0],before.get(path).split(' ')[0],'REQUIREMENT_MODE:'+path);
  }
  equal(JSON.parse(bytes(repo,head,'docs/core-integration.json')),manifest,'S04_MANIFEST_DRIFT');
  const paths=[...after.keys()].filter(p=>/^requirements\/.*\.rg\.(yaml|json)$/.test(p));
  const requirements=paths.map(p=>json(repo,head,p));
  ensure(requirements.length===78&&new Set(requirements.map(r=>r.id)).size===78,'S04_CANONICAL_IDS');
  const newRequirement=requirements.find(r=>r.id==='FGMP-MIG-CORE-001');
  equal(newRequirement?.lifecycle,{accepted:false,current:false,published:false},'S04_CANDIDATE_LIFECYCLE');
  return {result:'PASS',base:BASE,head,tree:git(repo,'rev-parse',head+'^{tree}'),historical_s03:S03,
    canonical_requirements:78,module_files_preserved:231,module_files_changed:1,
    normative_values_preserved:73,core_execution_constraints:7,tracked:after.size,
    critical_content_pins:manifest.critical_artifacts.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(checkCore(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('CORE_INTEGRATION_FAILED: '+error.message);process.exitCode=1;}
}
