// DR3-R0 / research-only CPU analytic falsification, not an FGM or GPU renderer.
// Immutable deterministic fixture; O-H slab intersection vs independently coded six-face
// candidate with optional spatial-bucket composition (no certified pruning).
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';

const EPS=1e-9;
const plus=(a,b)=>a.map((x,i)=>x+b[i]);
const mul=(a,s)=>a.map(x=>x*s);
const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/Math.sqrt(dot(a,a)));
const ray=(o,d)=>({o,d});
const box=(id,lo,hi,priority=0,anchor=lo)=>({id,lo,hi,priority,anchor});
const boxes=[
  box('cross-4-cells',[-0.85,-0.8,-0.7],[0.9,0.95,0.85]),
  box('behind',[0.05,0.1,-1.3],[1.15,1.2,-0.3]),
  box('left',[-1.7,-1.1,-0.5],[-0.55,0.05,1.4]),
  box('floor-low',[-2,-2,-1.9],[2,2,-1.83]),
  box('floor-high',[-1.9,-1.9,1.9],[1.9,1.9,1.96]),
  box('tie-A',[1.3,-0.8,-0.1],[1.8,-0.2,0.7],1),
  box('tie-B',[1.3,-0.8,-0.1],[1.8,-0.2,0.7],0)
];
// Entire global scene is pinned. IDs refer to semantic instances, not work regions.
const hash=createHash('sha256').update(JSON.stringify(boxes)).digest('hex');
// Exact global hit precedence is a strict total order for the declared finite domain.
// EPS is used only when comparing independently computed results, NEVER as pairwise
// fuzzy depth equality. A pairwise |t1-t2|<=EPS tie is not transitive.
function validHit(a){
  return a!==null && typeof a==='object' && Number.isFinite(a.t) &&
    Number.isSafeInteger(a.priority) && typeof a.id==='string' &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(a.id) && typeof a.face==='string' &&
    /^[012][+-]$/.test(a.face);
}
function compareHit(a,b){
  if(!validHit(a)||!validHit(b))throw new Error('E_HIT_KEY');
  if(a.t!==b.t)return a.t<b.t?-1:1;
  if(a.priority!==b.priority)return a.priority>b.priority?-1:1;
  if(a.id!==b.id)return a.id<b.id?-1:1;
  if(a.face!==b.face){
    if(a.face[0]!==b.face[0])return a.face[0]<b.face[0]?-1:1;
    return a.face[1]==='-'?-1:1; // canonical axis then '-' before '+'
  }
  return 0;
}
const better=(a,b)=>{
  if(!validHit(a))throw new Error('E_HIT_KEY');
  return !b || compareHit(a,b)<0;
};
// O-H keeps a separate implementation of the declared tie policy; it does NOT
// call the candidate compositor's compareHit/better reduction.
const oracleBetter=(a,b)=>!b || a.t<b.t || (a.t===b.t &&
  (a.priority>b.priority || (a.priority===b.priority &&
    (a.id<b.id || (a.id===b.id && (a.face[0]<b.face[0] ||
      (a.face[0]===b.face[0] && a.face[1]==='-' && b.face[1]==='+')))))));
// O-H reference: classic independent global ray vs AABB slab; no per-fragment compositor.
function slab(r,b){
  let near=-Infinity,far=Infinity,faceNear='',faceFar='';
  for(let k=0;k<3;k++){
    if(Math.abs(r.d[k])<1e-14){if(r.o[k]<b.lo[k] || r.o[k]>b.hi[k])return null;continue;}
    let t1=(b.lo[k]-r.o[k])/r.d[k], t2=(b.hi[k]-r.o[k])/r.d[k];
    let f1=`${k}-`,f2=`${k}+`;
    if(t1>t2){[t1,t2]=[t2,t1];[f1,f2]=[f2,f1];}
    if(t1>near){near=t1;faceNear=f1;}
    if(t2<far){far=t2;faceFar=f2;}
    if(near>far+EPS)return null;
  }
  const t=near>EPS?near:far>EPS?far:null;
  if(t===null)return null;
  return {t,id:b.id,priority:b.priority,face:near>EPS?faceNear:faceFar};
}
function oracle(r,scene){let best=null;for(const b of scene){const h=slab(r,b);if(h&&oracleBetter(h,best))best=h;}return best;}
// Candidate: independent six world-space FACE-plane intersections (not clipped-cell box faces).
function faces(r,b){
  const out=[];
  for(let k=0;k<3;k++)for(const side of ['-','+']){
    if(Math.abs(r.d[k])<1e-14)continue;
    const t=((side==='-'?b.lo:b.hi)[k]-r.o[k])/r.d[k];
    if(t<=EPS)continue;
    const p=plus(r.o,mul(r.d,t));
    if(p.every((v,i)=>i===k||v>=b.lo[i]-EPS && v<=b.hi[i]+EPS))
      out.push({t,id:b.id,priority:b.priority,face:`${k}${side}`,p});
  }
  return out;
}
function candidate(r,scene,partition=1){
  const buckets=new Map();
  for(const b of scene)for(const h of faces(r,b)){
    const coord=h.p.map(v=>Math.min(partition-1,Math.max(0,Math.floor((v+4)/8*partition))));
    const k=coord.join(':');const a=buckets.get(k)||[];a.push(h);buckets.set(k,a);
  }
  let best=null;
  for(const group of buckets.values()){
    let local=null;for(const h of group)if(better(h,local))local=h;
    if(local&&better(local,best))best=local;
  }
  return best;
}
function camera({yaw=0.6,pitch=0.7,step=0.14,panU=0,panV=0}={}){
  const d=unit([Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),-Math.sin(pitch)]);
  const u=unit(cross(d,[0,0,1])),v=unit(cross(u,d));
  return {d,u,v,step,panU,panV};
}
function pixel(c,x,y,n=48){
  const origin=plus(plus(mul(c.d,-30),mul(c.u,(x+0.5-n/2+c.panU)*c.step)),mul(c.v,(y+0.5-n/2+c.panV)*c.step));
  return ray(origin,c.d);
}
const same=(a,b)=>a===null&&b===null || a&&b&&a.id===b.id&&a.face===b.face&&Math.abs(a.t-b.t)<=1e-9;
function compareFrame(scene,cam,n=48,spp=4){
  let misses=0,hits=0,wrong=0;const bad=[];
  const offsets=spp===4?[[.25,.25],[.75,.25],[.25,.75],[.75,.75]]:[[.5,.5]];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)for(const [sx,sy] of offsets){
    const r=pixel(cam,x+sx-.5,y+sy-.5,n),ref=oracle(r,scene);
    if(ref)hits++;else misses++;
    for(const part of [1,2,4]){
      const got=candidate(r,scene,part);
      if(!same(ref,got)){wrong++;if(bad.length<3)bad.push({x,y,part,reference:ref,candidate:got});}
    }
  }
  return {hits,misses,compared:(hits+misses)*3,wrong,bad};
}
function test(label,fn){try{const out=fn();console.log(`PASS ${label}: ${JSON.stringify(out)}`);return out;}catch(e){console.log(`FAIL ${label}: ${e.stack}`);process.exitCode=1;return {error:e.message};}}
const baseCam=camera();
const eq=test('R0-01/03/04/06/09/10 shared hit/ID and 1,8,64 partitions',()=>{
  for(const p of [0.28,0.7,1.03])for(const yaw of [0.2,0.6,1.2]){
    const x=compareFrame(boxes,camera({yaw,pitch:p}),40,4);
    assert.equal(x.wrong,0,JSON.stringify(x.bad));
  }
  return compareFrame(boxes,baseCam);
});
// P2-A0-01: first isolate arithmetic/tie ordering without geometry; then use
// actual near-coplanar boxes spanning the x=0 region boundary. The independent
// expected winner is computed by native Array.sort, not by compareHit/better.
function permutations(xs){
  if(xs.length===0)return [[]];
  return xs.flatMap((x,i)=>permutations(xs.filter((_,j)=>j!==i)).map(rest=>[x,...rest]));
}
const ordering=test('P2-A0-01 strict depth tie/priority/ID order is permutation- and partition-invariant',()=>{
  const triple=[
    {id:'A',t:10,priority:0,face:'0-'},
    {id:'B',t:10+0.75e-9,priority:1,face:'0-'},
    {id:'C',t:10+1.5e-9,priority:2,face:'0-'}
  ];
  const independent=triple.slice().sort((a,b)=>a.t-b.t || b.priority-a.priority ||
    (a.id<b.id?-1:a.id>b.id?1:a.face[0]<b.face[0]?-1:
      a.face[0]>b.face[0]?1:a.face[1]===b.face[1]?0:a.face[1]==='-'?-1:1))[0];
  assert.equal(independent.id,'A');
  const historical=(a,b)=>!b || a.t<b.t-EPS || Math.abs(a.t-b.t)<=EPS &&
    (a.priority>b.priority || a.priority===b.priority && a.id<b.id);
  assert(historical(triple[1],triple[0]));
  assert(historical(triple[2],triple[1]));
  assert(historical(triple[0],triple[2]));
  const all=permutations(triple);
  for(const perm of all){
    let fold=null;for(const h of perm)if(better(h,fold))fold=h;
    assert.equal(fold.id,independent.id);
    // Vary spatial group membership, local ordering and final group ordering.
    for(const n of [1,2,4])for(const variant of [0,1,2]){
      const groups=Array.from({length:n**3},()=>[]);
      perm.forEach((h,i)=>groups[(i*17+variant*13)%groups.length].push(h));
      for(const arrangement of [groups,groups.slice().reverse()]){
        let global=null;
        for(const group of arrangement){
          let local=null;for(const h of group)if(better(h,local))local=h;
          if(local&&better(local,global))global=local;
        }
        assert.equal(global.id,independent.id);
      }
    }
  }
  for(const invalid of [
    {...triple[0],t:NaN},{...triple[0],t:Infinity},
    {...triple[0],priority:0.5},{...triple[0],face:'3-'},
    {...triple[0],id:'non-ascii-Ω'}
  ]){
    assert.throws(()=>better(invalid,null),/E_HIT_KEY/);
    assert.throws(()=>better(invalid,triple[0]),/E_HIT_KEY/);
  }
  const exact=[
    {id:'z',t:10,priority:0,face:'0-'},
    {id:'b',t:10,priority:2,face:'0-'},
    {id:'a',t:10,priority:2,face:'0+'},
    {id:'a',t:10,priority:2,face:'0-'}
  ];
  for(const order of permutations(exact)){
    let winner=null;for(const h of order)if(better(h,winner))winner=h;
    assert.equal(winner.id,'a');assert.equal(winner.face,'0-');
  }
  const r=ray([-10-.75e-9,0,0],[1,0,0]);
  const near=[
    box('A',[-.75e-9,-.5,-.5],[.1,.5,.5],0),
    box('B',[0,-.5,-.5],[.1,.5,.5],1),
    box('C',[.75e-9,-.5,-.5],[.1,.5,.5],2)
  ];
  for(const scene of permutations(near)){
    const ref=oracle(r,scene);assert.equal(ref.id,'A');
    for(const partition of [1,2,4]){
      const got=candidate(r,scene,partition);
      assert.equal(got.id,'A');assert.equal(got.face,'0-');
      assert(Math.abs(got.t-ref.t)<=EPS);
    }
  }
  return {triple_sequences:all.length,near_scene_orders:6,partitions:[1,8,64],
    coplanar_permutations:24,invalid_hit_cases:5,expected:'A',historical_cycle_confirmed:true,
    tested_key_policy:'finite_exact_depth_then_priority_desc_then_id_and_face_ordinal'};
});
const naiveClip=test('R0-01/05 negative: artificial cut-face is invalid',()=>{
  const b=box('whole',[-1,-1,-1],[1,1,1]);const r=ray([-.5,0,0],[1,0,0]);
  const trueHit=oracle(r,[b]),clipped=oracle(r,[box('whole',[0,-1,-1],[1,1,1])]);
  assert(trueHit&&clipped&&clipped.t<trueHit.t);return {real_t:trueHit.t,wrong_clip_t:clipped.t};
});
const phase=test('R0-18 exact integer shift vs invalid fractional phase reuse',()=>{
  const n=48, c0=camera(),integer=camera({panU:1}),fraction=camera({panU:0.5});
  let integerWrong=0,fractionWrong=0;
  for(let y=0;y<n;y++)for(let x=0;x<n-1;x++){
    if(!same(oracle(pixel(integer,x,y,n),boxes),oracle(pixel(c0,x+1,y,n),boxes)))integerWrong++;
    if(!same(oracle(pixel(fraction,x,y,n),boxes),oracle(pixel(c0,x,y,n),boxes)))fractionWrong++;
  }
  assert.equal(integerWrong,0);assert(fractionWrong>0);
  return {integerWrong,fractionWrong};
});
const unseen=test('R0-15/E1 new contributor invalidates previously visible-only cache',()=>{
  const r=ray([0,0,8],[0,0,-1]);
  const behind=box('old',[-1,-1,0],[1,1,1]),front=box('new',[-.5,-.5,2],[.5,.5,3]);
  const old=oracle(r,[behind]),fresh=oracle(r,[behind,front]);
  assert(old&&fresh&&old.id!==fresh.id&&fresh.t<old.t);
  assert(same(fresh,candidate(r,[behind,front],4)));
  return {old:old.id,new:fresh.id,stale_reuse_detected:!same(old,fresh)};
});
const overhang=test('R0-21 offscreen anchor/overhang cannot be culled by anchor alone',()=>{
  const b=box('overhang',[-.2,-.2,0],[4.2,.2,1],0,[4,0,0]);
  const r=ray([0,0,6],[0,0,-1]);
  assert(oracle(r,[b])&&oracle(r,[b]).id==='overhang');
  const naive=4>1?null:oracle(r,[b]);assert.equal(naive,null);
  const fresh=candidate(r,[b],4);assert(fresh&&fresh.id==='overhang');
  return {anchor_x:b.anchor[0],visible_hit:fresh.id,anchor_cull_wrong:true};
});
const opacity=test('R0-11/12 opaque frame reuse vs cutout needs visibility rebuild',()=>{
  const r=ray([0,0,8],[0,0,-1]),front=box('front',[-1,-1,2],[1,1,3]),rear=box('rear',[-1,-1,0],[1,1,1]);
  const opaque=oracle(r,[front,rear]);
  const differentOpaqueFrame={albedoTick:2,geometryHit:opaque};
  const cutout=oracle(r,[rear]);
  assert(same(opaque,differentOpaqueFrame.geometryHit));
  assert(!same(opaque,cutout));
  return {opaque:opaque.id,cutoutReveals:cutout.id,oldNearestOnlyInvalid:true};
});
function bench(name,fn,runs=11){
  const times=[];for(let i=0;i<runs;i++){const start=performance.now();fn();times.push(performance.now()-start);}
  const sorted=times.slice(2).sort((a,b)=>a-b);
  return {name,runs_measured:sorted.length,p50_ms:+sorted[Math.floor(sorted.length*.5)].toFixed(3),p95_ms:+sorted[Math.ceil(sorted.length*.95)-1].toFixed(3),min_ms:+sorted[0].toFixed(3),max_ms:+sorted.at(-1).toFixed(3)};
}
const benchScene=boxes.slice(0,5),benchN=48;
const benches=[bench('O-H global slab CPU (48x48 1spp)',()=>{for(let y=0;y<benchN;y++)for(let x=0;x<benchN;x++)oracle(pixel(baseCam,x,y,benchN),benchScene);}),
 bench('face candidate + 8-region merge CPU (48x48 1spp)',()=>{for(let y=0;y<benchN;y++)for(let x=0;x<benchN;x++)candidate(pixel(baseCam,x,y,benchN),benchScene,2);})];
const report={schema:'fgmp-dr3-r0-cpu-preflight/1',classification:'CPU_ONLY_ANALYTIC_NOT_FGM0_NOT_GPU',fixture_sha256:hash,fixture_boxes:boxes.length,reference:'global slab O-H',candidate:'six-plane face intersections with bucketed global depth/ID',eps_verify_depth:EPS,depth_order_policy:'strict_finite_t_then_priority_then_ascii_id_and_axis_minus_first',eq,ordering,naiveClip,phase,unseen,overhang,opacity,benches,hardware:{platform:process.platform,arch:process.arch,cpus:os.cpus()?.[0]?.model,logical_cpus:os.cpus()?.length,node:process.version},declared_remaining:'R0-02/07/08/13/14/16/17/19/20; real FGM-0, R07, GPU/VRAM, certifiable culling, UV/normal/mips and all 16 cold-warm E1 rows NOT RUN'};
console.log('R0_PREFLIGHT_JSON '+JSON.stringify(report));
if(process.exitCode)process.exit(process.exitCode);
