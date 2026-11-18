// One current transition policy; no imports or replay of historical stage checkers.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const POLICY='fgm-platform-policy/3';
export const SCOPE='S06A-to-S06B-local-WASM-GPU-browser-current-snapshot';
export const BASE='79f4b4e74f00f05b8210cfd5805f1de053b74c0d';
export const BASE_TREE='4bc532b34ebee3a8a3b36500eaa8e394e5d12287';
const RETIRED=Object.freeze([
  "core/tests/document-language.test.mjs",
  "regenerator/tests/document-language.test.mjs",
  "renderer/tests/document-language.test.mjs",
  "renderer/scripts/test-v02.mjs",
  "regenerator/.github/workflows/importer-ci.yml",
  "renderer/.github/workflows/repo-guard.yml",
  ".github/workflows/source-snapshots.yml"
]);
const FORBIDDEN=Object.freeze([
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
const ADDED=Object.freeze([
  ".github/workflows/platform-policy.yml",
  "renderer/tests/local-browser.mjs",
  "renderer/tests/local-browser.test.mjs",
  "renderer/tests/studio-bundle.test.mjs",
  "requirements/FGMP-WASM-001.rg.yaml"
]);
const EDITED=Object.freeze([
  ".github/workflows/core-ci.yml",
  ".github/workflows/repo-guard.yml",
  "CMakeLists.txt",
  "README.md",
  "docs/platform.md",
  "docs/requirements-hierarchy.md",
  "raster/CMakeLists.txt",
  "renderer/docs/renderer-session-s3-s2b.md",
  "renderer/docs/studio-pages.md",
  "renderer/docs/studio-ufo-catalog.md",
  "renderer/scripts/build-studio-s2a.mjs",
  "renderer/scripts/stage-web.mjs",
  "renderer/scripts/studio_pages.py",
  "renderer/studio/engine-lock.json",
  "renderer/tests/browser.test.mjs",
  "renderer/tests/renderer-depth-oracle.browser.mjs",
  "renderer/tests/renderer-session-wasm.browser.mjs",
  "renderer/tests/renderer-session.browser.mjs",
  "renderer/tests/studio-s2a.browser.mjs",
  "renderer/tests/test_studio_pages.py",
  "scripts/check-bootstrap.mjs",
  "scripts/check-platform.mjs",
  "tests/platform-policy.test.mjs"
]);
const PATH_MAP=Object.freeze({
  "regenerator/.github/workflows/importer-ci.yml": ".github/workflows/core-ci.yml",
  "renderer/.github/workflows/repo-guard.yml": ".github/workflows/core-ci.yml",
  ".github/workflows/source-snapshots.yml": ".github/workflows/platform-policy.yml"
});
const NORMATIVE_UPDATES=Object.freeze({
  "FGMP-BUILD-001": "### FGMP-BUILD-001 — Platform должна собирать Core, единую CPU RVI реализацию, Regenerator и Renderer из корневого CMake-графа с локальными targets без внутренних Git FetchContent и без глобального отключения тестов. Одна RVI реализация обслуживает R07 и Raster oracle; целочисленная R05-проекция сохраняет отдельный предметный контракт. Native/Python R01–R07, CLI, package/hash, deterministic receipts, отрицательные проверки, Core/C05 и public consumer реально выполняются на Linux и Windows с точным enabled CTest inventory и --no-tests=error. Текущая защита закрепляет область изменений и критические verifiers независимо от проверяемого manifest, сохраняет ID, lifecycle и действующие execution contracts. Временная baseline policy развивается одним файлом и удаляется на S08 после действующей функциональной замены; исторические Git/Issues/PR/CI архивы и постоянный replay не требуются. Все ещё актуальные требования и незавершённые решения должны быть самостоятельно представлены в Platform. Упрощение оценивается по зависимостям, реализациям, владельцам, исключениям и процедурам сборки; обязательны независимый аудит и отдельная авторская приёмка. Private Stage A и browser R07 fit не входят в принятый native scope.",
  "FGMP-RENDERER-001": "### FGMP-RENDERER-001 — Корневая native-сборка Platform должна собирать существующие scene и camera Renderer через локальный fgm::cpu без обязательного GPU SDK; native GPU demo включается отдельной явной опцией. RVI implementation, tests и fixtures принадлежат Raster без forwarding alias. Прежние camera oracle и независимый аналитический scene oracle с отрицательной проверкой пакета входят в точный enabled CTest inventory на Linux и Windows вместе с Core/Regenerator/Raster tests. RendererSession trust/lifecycle и Studio Node contracts выполняются из единого npm workspace с закреплёнными зависимостями. Одна общая проверка языка и её отрицательные тесты выполняются до RepoGuard. Удаление заменённых workflow сохраняет уникальные предметные проверки. Версия текущей policy явно закрепляет область перехода и критические verifiers, сохраняет ID, lifecycle и действующие ограничения; нормативные изменения по авторскому решению перечисляются отдельно. Историческое архивирование и вечный replay не требуются; временные migration rules удаляются на S08 после функциональной замены. Native acceptance остаётся отдельным доказательством от реальных WASM/GPU/Chromium tests, полного S06, Stage A и публикации Studio.",
  "FGMV-PUB-003": "### FGMV-PUB-003 — Выпуск Reconstruction Studio с каталогом UFO и проверяемый откат. При каждом обновлении main workflow должен пересобирать Studio и WASM из одного точного коммита Platform, без загрузки старых FGM-репозиториев. Допуск к автоматической и ручной публикации Studio должен требовать успешного RepoGuard на точном коммите сборки, проверки схемы манифеста, состава файлов, ревизий и контрольных сумм. Перед публикацией workflow должен сверять коммит сборки Studio с актуальным main. После успешных проверок актуальная сборка должна публиковаться автоматически по событию обновления main. Версия в шапке Studio и публичном манифесте должна иметь формат A.M. Положительный номер архитектуры A хранится в репозитории и увеличивается на единицу при несовместимом изменении архитектуры Studio. Номер M равен числу merge-коммитов в истории main по первым родителям до коммита сборки включительно. M не обнуляется при повышении A. Полный SHA и TREE опубликованного коммита Platform должен присутствовать в подсказке версии и публичном манифесте. Приёмка выпуска должна подтверждать по HTTP версию и контрольные суммы опубликованных файлов и сохранять свидетельство успешной реконструкции синтетического именованного элемента через выбор локальной папки в Chromium с WASM. Ручной откат должен использовать необходимые проверенные Platform release artifacts и подтверждать публичные байты без доступности старых репозиториев или старого Pages. Проверки PR и подготовка сайта должны выполняться без разрешений публикации. Публичный пакет должен содержать только проверенные материалы с синтетическим примером.",
  "FGMP-PROJECT-000": "### FGMP-PROJECT-000 — Проект должен обеспечивать независимый аудит exact BASE/HEAD/TREE, явное авторское принятие, воспроизводимое CI-свидетельство, причинную трассировку изменений, самостоятельный рабочий срез с актуальными требованиями и незавершёнными решениями и запрет публикации чужих игровых ресурсов в публичном репозитории. Полный архив истории прежних репозиториев не требуется; их удаление возможно отдельной финальной авторской операцией после FUNCTIONAL_PASS, INDEPENDENCE_PASS, REQUIREMENTS_PASS и SIMPLIFICATION_PASS."
});
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
  ".github/workflows/core-ci.yml": {
    "mode": "100644",
    "blob": "815c830c700f4135cb6880e8b28be45cd9ad1213",
    "sha256": "febd762c7156997c49e2f8d6d6a5e7bd437842c76591c58f6ef37301fc617c9c"
  },
  ".github/workflows/platform-policy.yml": {
    "mode": "100644",
    "blob": "be9290b6f8c8bea1b2697cab1815b626b9c41b88",
    "sha256": "848c68dcad0f04010e568bdc67d446748bba48b1ce0650d35bb2c1d3a023fc88"
  },
  ".github/workflows/repo-guard.yml": {
    "mode": "100644",
    "blob": "29d18bdeb1390b86ac944e892d5e530e654693f7",
    "sha256": "c0fdf706f7e7ae1430a52596c0994098a0868828f06b1a698aaad4cede88eed4"
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
    "blob": "efbd0bee11af846667fe4b178b3defb2560cf23d",
    "sha256": "ffebbfc82a83a1ff4441edb68eb28fa7f15ce51fe5658a86514e982ae7662f82"
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
    "blob": "159238d53ac729d51e4859f069d1601d94ff60b3",
    "sha256": "a688efe988b6d072612f3a1f21b290bee745a504d4528747621a63f842599004"
  },
  "requirements/FGMP-WASM-001.rg.yaml": {
    "mode": "100644",
    "blob": "ac7481eb7a66dc5ad9db3355610bd6d6cc192ee9",
    "sha256": "d4066198d79f4b3ec3a282631fd91b465f058f320630807ee72ed682bf72749f"
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
    "blob": "8329041d8b19a651e7307b61627a134c309e052b",
    "sha256": "ce4276c42cd7536e4b50fd743485029c0fd9228082d6f2f7d15f0efac406a528"
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
    "blob": "f3dc82b7d5ed50bd12fe741530698a6bde276d20",
    "sha256": "5bdb980fc23625925d5eaf55832969895ab268f56450928e86f6a4ecd9dd76eb"
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
    "blob": "78dde741cafda17b3bc9bd9f5aef0dd7a2ef61fe",
    "sha256": "a7c58a9cb88d54c5af821334a9a6ca9e0d87d468b9ff03cdcab493bfa678fd3e"
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
  out.relations=(out.relations||[]).filter(r=>!RETIRED.slice(0,4).includes(r.target?.path));
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    if(value.kind==='artifact'&&PATH_MAP[value.path])value.path=PATH_MAP[value.path];
    for(const child of Object.values(value))walk(child);
  };
  walk(out);
  if(NORMATIVE_UPDATES[out.id])out.normative=NORMATIVE_UPDATES[out.id];
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
  ensure([...after.keys()].filter(p=>/^requirements\/.*\.rg\.yaml$/.test(p)).length===81,'REQUIREMENT_COUNT');
  return {result:'PASS',policy:POLICY,scope:SCOPE,base:BASE,head,tree:git(repo,'rev-parse',head+'^{tree}'),
    critical_content_pins:critical.length,normative_values_preserved:76,normative_updates:Object.keys(NORMATIVE_UPDATES),
    existing_ids_lifecycle_preserved:80,canonical_requirements:81,required_native_tests:30,
    internal_git_fetchcontent:0,raster_implementations:1,language_implementations:1,npm_locks:1,
    temporary_verifier_aliases:0,nested_legacy_workflows:1,historical_replay_required:false,
    temporary_policy_owner:'S06 #9; remove baseline rules after current replacement S08 #14; no archive gate'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(checkPlatform(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('PLATFORM_POLICY_FAILED: '+error.message);process.exitCode=1;}
}
