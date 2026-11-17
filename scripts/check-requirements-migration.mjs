// S03: exact historical baseline, lossless normative identity and explicit path/lifecycle migration.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'yaml';

export const BASE = '495ebf1a28d8563a0fd6681aadb2cc77d76cb696';
export const BASE_TREE = 'de224a85b0957ca1de1e26d593a3c1ee099f85e2';
export const IMPORT_HEAD = 'faff85c3683a7dd87026796bf33ad11ac6d22b33';
export const IMPORT_BASE = '9a1b41b7050ee2342d247f8d43ce5e3977de2ee6';
export const PIN = '74db97791e6da8a75287164f0d0b41579108f114';
export const MODULES = ['core', 'regenerator', 'renderer'];
export const CANDIDATE = {accepted:false, current:false, published:false};
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const git = (repo, ...args) => execFileSync('git', ['-C',repo,...args],
  {maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe']}).toString('utf8').trim();
const bytes = (repo, ref, path) => execFileSync('git',['-C',repo,'show',ref+':'+path],
  {maxBuffer:32*1024*1024, stdio:['ignore','pipe','pipe']});
const stable = v => JSON.stringify(v && typeof v === 'object'
  ? Array.isArray(v) ? v.map(v=>JSON.parse(stable(v)))
    : Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(stable(v[k]))])) : v);
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const equal = (a,b,code) => {if(stable(a)!==stable(b))throw new Error(code);};
const ensure = (ok,code) => {if(!ok)throw new Error(code);};
export function parse(raw) {
  const d=parseDocument(String(raw), {version:'1.2',uniqueKeys:true,merge:false,strict:true});
  ensure(!d.errors.length && !d.warnings.length, 'INVALID_YAML');
  return d.toJS({maxAliasCount:0});
}
const read = (repo,ref,path) => parse(bytes(repo,ref,path));
const files = (repo,ref) => new Map(git(repo,'ls-tree','-r','-z',ref).split('\0')
  .filter(Boolean).map(s=>{const [meta,path]=s.split('\t');return [path,meta];}));
const safePath = p => typeof p==='string' && !p.startsWith('/') && !p.includes('\\')
  && p.split('/').every(s=>s && s!=='.' && s!=='..') && !/[\x00-\x1f*?\[\]{}]/.test(p);

export function transform(source,module) {
  const out=structuredClone(source);
  out.lifecycle={...CANDIDATE};
  const mappedPath=p=>{
    ensure(safePath(p),'UNSAFE_SOURCE_PATH');
    // Only GOV's live compiler owner is shared; domain execution workflows stay historical.
    if(/-GOV-001$/.test(source.id) && p==='.github/workflows/repo-guard.yml')return p;
    return p.startsWith('requirements/') ? 'requirements/'+module+'/'+p.slice(13) : module+'/'+p;
  };
  const walk=v=>{
    if(!v || typeof v!=='object')return;
    if(['artifact','document'].includes(v.kind))v.path=mappedPath(v.path);
    if(v.class==='execution') {
      ensure(v.key==='execution:'+v.verifier?.path,'UNEXPECTED_EXECUTION_KEY');
      v.key='execution:'+mappedPath(v.verifier.path);
    }
    for(const value of Object.values(v))walk(value);
  };
  walk(out.relations);walk(out.constraints);
  return out;
}

export function inventory(repo=root) {
  equal(git(repo,'rev-parse',BASE+'^{tree}'),BASE_TREE,'BASE_TREE_DRIFT');
  const baseline=files(repo,BASE);
  const snapshot=JSON.parse(bytes(repo,BASE,'docs/source-snapshots.json'));
  const rows=[], requirements=[];
  for(const [module,expectedCount] of MODULES.map((m,i)=>[m,[11,31,31][i]])) {
    const source=snapshot.sources.find(s=>s.target===module);
    const paths=[...baseline.keys()].filter(p=>p.startsWith(module+'/requirements/')&&p.endsWith('.rg.yaml')).sort();
    ensure(paths.length===expectedCount,'SOURCE_COUNT:'+module);
    equal(git(repo,'rev-parse',BASE+':'+module),source.tree,'SOURCE_TREE:'+module);
    for(const path of paths) {
      const raw=bytes(repo,BASE,path),old=parse(raw),value=transform(old,module);
      const destination='requirements/'+module+'/'+path.split('/').at(-1);
      const pathMap={};
      old.relations.forEach((r,i)=>{
        if(['artifact','document'].includes(r.target.kind))pathMap[r.target.path]=value.relations[i].target.path;
      });
      const executionMap={};
      (old.constraints||[]).forEach((c,i)=>{
        if(c.evidence?.class==='execution')executionMap[c.evidence.key]=value.constraints[i].evidence.key;
      });
      const semantic=digest(old.normative);
      rows.push({id:old.id,module,
        source:{repository:'netkeep80/fgm-'+module,head:source.head,tree:source.tree,
          path:path.slice(module.length+1),blob:baseline.get(path).split(' ')[2],
          sha256:createHash('sha256').update(raw).digest('hex'),
          subject:{kind:'semantic_requirement',repository:'netkeep80/fgm-'+module,requirementId:old.id,digest:semantic}},
        target:{path:destination,subject:{kind:'semantic_requirement',repository:'netkeep80/fgm-platform',requirementId:old.id,digest:semantic}},
        lifecycle:{source:old.lifecycle,target:value.lifecycle},
        relations:{count:old.relations.length,source_digest:digest(old.relations),target_digest:digest(value.relations)},
        constraints:{count:(old.constraints||[]).length,source_digest:digest(old.constraints||[]),target_digest:digest(value.constraints||[])},
        artifact_path_map:pathMap,execution_key_map:executionMap});
      requirements.push({oldPath:path,path:destination,value});
    }
  }
  ensure(new Set(rows.map(r=>r.id)).size===73,'DUPLICATE_SOURCE_ID');
  const manifest={schema:'fgm-platform-requirements-migration/1',phase:'S03',
    baseline:{head:BASE,tree:BASE_TREE},historical_import:{head:IMPORT_HEAD,base:IMPORT_BASE},
    compiler:PIN,policy:'candidate-subjects-no-automatic-author-acceptance',
    counts:{old:73,new:73,mapped:73,unmapped:0,source_accepted_current:15,candidate_lifecycle_changes:15,
      relations:rows.reduce((n,r)=>n+r.relations.count,0),constraints:rows.reduce((n,r)=>n+r.constraints.count,0)},
    requirements:rows};
  return {manifest,requirements,baseline};
}

export function checkMigration(repo=root,head='HEAD') {
  head=git(repo,'rev-parse',head+'^{commit}');
  git(repo,'merge-base','--is-ancestor',BASE,head);
  const {manifest,requirements,baseline}=inventory(repo),current=files(repo,head);
  for(const path of ['docs/source-snapshots.json','docs/source-snapshot-resources.json',
    'scripts/check-source-snapshots.py','tests/test_source_snapshots.py'])
    equal(current.get(path),baseline.get(path),'HISTORICAL_PROVENANCE_CHANGED:'+path);
  equal(JSON.parse(bytes(repo,head,'docs/requirements-migration.json')),manifest,'ATTESTATION_DRIFT');
  const expectedPaths=requirements.map(r=>r.path).sort();
  equal([...current.keys()].filter(p=>/^requirements\/(core|regenerator|renderer)\//.test(p)).sort(),expectedPaths,'CANONICAL_PATH_SET');
  for(const r of requirements) {
    ensure(!current.has(r.oldPath),'DUPLICATE_MODULE_AUTHORITY:'+r.oldPath);
    equal(read(repo,head,r.path),r.value,'REQUIREMENT_DRIFT:'+r.path);
    equal(current.get(r.path)?.split(' ')[0],baseline.get(r.oldPath).split(' ')[0],'REQUIREMENT_MODE:'+r.path);
  }
  let preserved=0;
  for(const [path,meta] of baseline)if(/^(core|regenerator|renderer)\//.test(path)&&!path.includes('/requirements/')) {
    equal(current.get(path),meta,'MODULE_RESOURCE_DRIFT:'+path);preserved++;
  }
  equal([...current.keys()].filter(p=>/^(core|regenerator|renderer)\//.test(p)).length,preserved,'MODULE_EXTRA_RESOURCE');
  // The 305-member inventory is historical evidence, never blanket current resource authority.
  const oldSnapshot=read(repo,BASE,'requirements/FGMP-MIG-SNAPSHOT-001.rg.yaml');
  const expectedSnapshot=structuredClone(oldSnapshot);
  const inventoryRelation=expectedSnapshot.relations.find(r=>r.collection===true);
  ensure(inventoryRelation?.target.path==='docs/source-snapshot-resources.json','SNAPSHOT_INVENTORY');
  inventoryRelation.predicates=['documents'];delete inventoryRelation.collection;
  equal(read(repo,head,'requirements/FGMP-MIG-SNAPSHOT-001.rg.yaml'),expectedSnapshot,'SNAPSHOT_REQUIREMENT_DRIFT');
  const canonical=[...current.keys()].filter(p=>/^requirements\/.*\.rg\.(yaml|json)$/.test(p));
  const docs=canonical.map(p=>read(repo,head,p));
  ensure(docs.length===77 && new Set(docs.map(d=>d.id)).size===77,'CANONICAL_ID_SET');
  const ids=new Set(docs.map(d=>d.id));
  for(const d of docs) {
    const walk=v=>{
      if(!v || typeof v!=='object')return;
      if(['artifact','document'].includes(v.kind))ensure(safePath(v.path)&&current.has(v.path),'MISSING_ARTIFACT:'+v.path);
      if(v.kind==='requirement')ensure(ids.has(v.id),'MISSING_REQUIREMENT:'+v.id);
      for(const value of Object.values(v))walk(value);
    };
    walk(d.relations);walk(d.constraints);
  }
  return {result:'PASS',base:BASE,head,tree:git(repo,'rev-parse',head+'^{tree}'),
    counts:manifest.counts,normative_digests_preserved:73,repository_subject_changes:73,
    module_files_preserved:preserved,canonical_requirements:docs.length,
    historical_import:IMPORT_HEAD};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(checkMigration(root,process.argv[2]||'HEAD'),null,2));}
  catch(error){console.error('REQUIREMENTS_MIGRATION_FAILED: '+error.message);process.exitCode=1;}
}
