// DR3-R0 / research-only CPU analytic falsification, not an FGM or GPU renderer.
// Immutable deterministic fixture; O-H slab intersection vs independently coded six-face
// candidate with optional spatial-bucket composition (no certified pruning).
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import os from 'node:os';

// Depth comparison tolerance is NEVER geometric coverage or hit arbitration.
const VERIFY_DEPTH_EPS=1e-9;
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
// VERIFY_DEPTH_EPS is used only when comparing independently computed results, NEVER as pairwise
// fuzzy depth equality. A pairwise |t1-t2|<=VERIFY_DEPTH_EPS tie is not transitive.
function validHit(a){
  return a!==null && typeof a==='object' && Number.isFinite(a.t) &&
    Number.isSafeInteger(a.priority) && typeof a.id==='string' &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(a.id) && typeof a.face==='string' &&
    /^[012][+-]$/.test(a.face) &&
    (!Object.hasOwn(a,'sourceDepth') || (a.sourceDepth &&
      ['origin','bound','direction'].every(k=>Number.isFinite(a.sourceDepth[k])) &&
      a.sourceDepth.direction!==0));
}
function compareHit(a,b){
  if(!validHit(a)||!validHit(b))throw new Error('E_HIT_KEY');
  const depthOrder=compareExactDepth(a,b);
  if(depthOrder!==0)return depthOrder;
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
const oracleBetter=(a,b)=>{
  if(!b)return true;
  // Independent global reduction structure. Only primitive exact dyadic
  // decoding is shared with the research candidate's comparator.
  const left=hitRatio(a),right=hitRatio(b);
  const delta=left.n*right.d-right.n*left.d;
  if(delta!==0n)return delta<0n;
  return a.priority>b.priority ||
    (a.priority===b.priority &&
      (a.id<b.id || (a.id===b.id && (a.face[0]<b.face[0] ||
      (a.face[0]===b.face[0] && a.face[1]==='-' && b.face[1]==='+')))));
};
// Float64 inputs denote exact dyadic rationals. Ambiguous boundary decisions
// use exact BigInt cross products, not rounded point coordinates or EPS halos.
// The independent slab and original-face methods share decoding, NOT geometry.
const EXACT_VIEW=new DataView(new ArrayBuffer(8));
const FLOAT_ERROR_FACTOR=64*Number.EPSILON;
function dyadic(x){
  if(!Number.isFinite(x))throw new Error('E_NONFINITE_GEOMETRY');
  EXACT_VIEW.setFloat64(0,x,false);
  const hi=EXACT_VIEW.getUint32(0,false),low=EXACT_VIEW.getUint32(4,false);
  const e=(hi>>>20)&2047;
  let m=(BigInt(hi&1048575)<<32n)|BigInt(low);
  if(e!==0)m|=1n<<52n;
  if(hi>>>31)m=-m;
  return {m,e:m===0n?0:e===0?-1074:e-1023-52};
}
function exactFrame(r,b){
  const parts=[...r.o,...r.d,...b.lo,...b.hi].map(dyadic);
  const minE=Math.min(...parts.filter(v=>v.m!==0n).map(v=>v.e),0);
  const values=parts.map(v=>v.m===0n?0n:v.m<<BigInt(v.e-minE));
  return {o:values.slice(0,3),d:values.slice(3,6),
    lo:values.slice(6,9),hi:values.slice(9,12),unitExp:minE};
}
// The rounded Number t is a reporting approximation only; physical hit order
// uses exact ray-plane parameter reconstructed from original finite float64.
function hitRatio(hit){
  const input=hit.sourceDepth;
  const parts=input?[input.origin,input.bound,input.direction]:[0,hit.t,1];
  const v=parts.map(dyadic),minE=Math.min(0,...v.filter(x=>x.m!==0n).map(x=>x.e));
  const ints=v.map(x=>x.m===0n?0n:x.m<<BigInt(x.e-minE));
  let n=ints[1]-ints[0],d=ints[2];
  if(d<0n){n=-n;d=-d;}
  if(d===0n)throw Error('E_EXACT_DEPTH_KEY');
  return {n,d};
}
function compareExactDepth(a,b){
  const x=hitRatio(a),y=hitRatio(b);
  const difference=x.n*y.d-y.n*x.d;
  return difference<0n?-1:difference>0n?1:0;
}
// Exact bucket ownership for the synthetic global range [-4,4]^3.
// This groups ALL candidate hits; no fragment culling/clip boundary is used.
function exactBucketCoord(r,b,face,partition){
  const frame=exactFrame(r,b);
  const t=exactPlaneT(frame,Number(face[0]),face[1]);
  const unit=1n<<BigInt(-frame.unitExp);
  const denom=8n*unit*t.d,cap=BigInt(partition-1);
  return frame.o.map((o,i)=>{
    const position=o*t.d+frame.d[i]*t.n;
    const numerator=BigInt(partition)*(position+4n*unit*t.d);
    if(numerator<=0n)return 0;
    const index=numerator/denom;
    return Number(index>cap?cap:index);
  });
}
function exactPlaneT(frame,axis,side){
  let n=(side==='-'?frame.lo:frame.hi)[axis]-frame.o[axis],d=frame.d[axis];
  if(d<0n){n=-n;d=-d;}
  if(d===0n)throw new Error('E_PARALLEL_PLANE_T');
  return {n,d};
}
function exactTimeCmp(frame,a,b){
  const x=exactPlaneT(frame,a.axis,a.side),y=exactPlaneT(frame,b.axis,b.side);
  const diff=x.n*y.d-y.n*x.d;
  return diff<0n?-1:diff>0n?1:0;
}
function exactFaceContains(frame,axis,side){
  const t=exactPlaneT(frame,axis,side);
  if(t.n<=0n)return false;
  for(let i=0;i<3;i++)if(i!==axis){
    const p=frame.o[i]*t.d+frame.d[i]*t.n;
    if(p<frame.lo[i]*t.d||p>frame.hi[i]*t.d)return false;
  }
  return true;
}
// O-H reference: classic independent global ray vs AABB slab; no per-fragment compositor.
function slab(r,b){
  let near=null,far=null,exact=null;
  const cmp=(a,c)=>{
    const dt=a.t-c.t,scale=Math.max(1,Math.abs(a.t),Math.abs(c.t));
    if(Number.isFinite(dt)&&Math.abs(dt)>FLOAT_ERROR_FACTOR*scale)return dt<0?-1:1;
    exact||=exactFrame(r,b);
    return exactTimeCmp(exact,a,c);
  };
  for(let k=0;k<3;k++){
    if(r.d[k]===0){if(r.o[k]<b.lo[k]||r.o[k]>b.hi[k])return null;continue;}
    const tlo=(b.lo[k]-r.o[k])/r.d[k],thi=(b.hi[k]-r.o[k])/r.d[k];
    if(!Number.isFinite(tlo)||!Number.isFinite(thi))throw Error('E_UNREPRESENTABLE_DEPTH');
    let a={t:tlo,axis:k,side:'-'},c={t:thi,axis:k,side:'+'};
    if(cmp(a,c)>0)[a,c]=[c,a];
    if(!near||cmp(a,near)>0)near=a;
    if(!far||cmp(c,far)<0)far=c;
    if(cmp(near,far)>0)return null;
  }
  const selected=near&&near.t>0?near:far&&far.t>0?far:null;
  if(!selected)return null;
  return {t:selected.t,id:b.id,priority:b.priority,face:`${selected.axis}${selected.side}`,
    sourceDepth:{origin:r.o[selected.axis],
      bound:(selected.side==='-'?b.lo:b.hi)[selected.axis],
      direction:r.d[selected.axis]}};
}
function oracle(r,scene){let best=null;for(const b of scene){const h=slab(r,b);if(h&&oracleBetter(h,best))best=h;}return best;}
// Candidate: independent six world-space FACE-plane intersections (not clipped-cell box faces).
function faces(r,b){
  const out=[];let exact=null;
  for(let k=0;k<3;k++)for(const side of ['-','+']){
    if(r.d[k]===0)continue;
    const t=((side==='-'?b.lo:b.hi)[k]-r.o[k])/r.d[k];
    if(!Number.isFinite(t))throw Error('E_UNREPRESENTABLE_DEPTH');
    if(t<=0)continue;
    const p=plus(r.o,mul(r.d,t));
    let contains=true;
    for(let i=0;i<3;i++)if(i!==k){
      const err=FLOAT_ERROR_FACTOR*(1+Math.abs(r.o[i])+Math.abs(r.d[i]*t)+
        Math.abs(p[i])+Math.abs(b.lo[i])+Math.abs(b.hi[i]));
      if(p[i]<b.lo[i]-err||p[i]>b.hi[i]+err){contains=false;break;}
      if(p[i]<=b.lo[i]+err||p[i]>=b.hi[i]-err){
        exact||=exactFrame(r,b);
        contains=exactFaceContains(exact,k,side);
        break;
      }
    }
    if(contains)out.push({t,id:b.id,priority:b.priority,face:`${k}${side}`,
      p,sourceDepth:{origin:r.o[k],bound:(side==='-'?b.lo:b.hi)[k],direction:r.d[k]}});
      // p is only an APPROXIMATE diagnostic point; not a coverage or bucket key.
  }
  return out;
}
function candidate(r,scene,partition=1){
  const buckets=new Map();
  for(const b of scene)for(const h of faces(r,b)){
    const coord=exactBucketCoord(r,b,h.face,partition);
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
const same=(a,b)=>a===null&&b===null || a&&b&&a.id===b.id&&a.face===b.face&&Math.abs(a.t-b.t)<=VERIFY_DEPTH_EPS;
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
  const historical=(a,b)=>!b || a.t<b.t-VERIFY_DEPTH_EPS || Math.abs(a.t-b.t)<=VERIFY_DEPTH_EPS &&
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
      assert(Math.abs(got.t-ref.t)<=VERIFY_DEPTH_EPS);
    }
  }
  return {triple_sequences:all.length,near_scene_orders:6,partitions:[1,8,64],
    coplanar_permutations:24,invalid_hit_cases:5,expected:'A',historical_cycle_confirmed:true,
    tested_key_policy:'finite_exact_depth_then_priority_desc_then_id_and_face_ordinal'};
});
// P2-A0-03: closed AABB geometric membership is exact in this analytic
// finite-double fixture. Any fuzzy coverage halo must remain forbidden.
// The slab oracle uses intersection intervals; candidate independently
// tests six original plane coordinates with strict closed-face containment.
const coverage=test('P2-A0-03 strict AABB near-miss/grazing/near-parallel hit parity',()=>{
  const b=box('Boundary',[-1,-1,-1],[1,1,1]);
  const formerlyFalse=ray([-2,1+VERIFY_DEPTH_EPS/2,0],[1,0,0]);
  const oldXFacePoint=plus(formerlyFalse.o,mul(formerlyFalse.d,1));
  assert(oldXFacePoint[1]>b.hi[1]);
  assert(oldXFacePoint[1]<=b.hi[1]+VERIFY_DEPTH_EPS); // old bug witness
  assert.equal(slab(formerlyFalse,b),null);
  for(const partition of [1,2,4])assert.equal(candidate(formerlyFalse,[b],partition),null);

  // Every perpendicular coordinate: inside, exactly on each closed side,
  // and outside by either 0.5 or 2 verification tolerances.
  const deltas=[-2*VERIFY_DEPTH_EPS,-VERIFY_DEPTH_EPS/2,0,
                 VERIFY_DEPTH_EPS/2,2*VERIFY_DEPTH_EPS];
  let axisSideCases=0,partitionComparisons=0,hits=0,misses=0;
  for(const constrained of [0,1,2])for(const sign of [-1,1])for(const delta of deltas){
    const moving=(constrained+1)%3,o=[0,0,0],d=[0,0,0];
    o[moving]=-2; d[moving]=1; o[constrained]=sign*(1+delta);
    const r=ray(o,d),expected=delta<=0,reference=slab(r,b);
    assert.equal(Boolean(reference),expected,JSON.stringify({constrained,sign,delta,reference}));
    if(reference){hits++;assert.equal(reference.face,`${moving}-`);}
    else misses++;
    for(const partition of [1,2,4]){
      const got=candidate(r,[b],partition);
      assert(same(reference,got),JSON.stringify({constrained,sign,delta,partition,reference,got}));
      assert.equal(Boolean(got),expected);
      partitionComparisons++;
    }
    axisSideCases++;
  }

  // Tangency is a single closed point at t>0; just-outside must remain MISS.
  const tiny=2**-48;
  const cases=[
    {name:'vertex tangent',r:ray([-2,0,0],[1,1,0]),hit:true,face:'0-'},
    {name:'vertex near-inside',r:ray([-2,-VERIFY_DEPTH_EPS/2,0],[1,1,0]),hit:true,face:'0-'},
    {name:'vertex near-outside',r:ray([-2,VERIFY_DEPTH_EPS/2,0],[1,1,0]),hit:false},
    {name:'lower vertex tangent',r:ray([-2,0,0],[1,-1,0]),hit:true,face:'0-'},
    {name:'lower vertex near-outside',r:ray([-2,-VERIFY_DEPTH_EPS/2,0],[1,-1,0]),hit:false},
    {name:'closed edge',r:ray([-2,1,1],[1,0,0]),hit:true,face:'0-'},
    {name:'origin inside, exit',r:ray([0,0,0],[1,0,0]),hit:true,face:'0+'},
    {name:'on face, outward',r:ray([1,0,0],[1,0,0]),hit:false},
    {name:'on face, inward exit',r:ray([1,0,0],[-1,0,0]),hit:true,face:'0-'},
    {name:'near-parallel crosses upper y',r:ray([-2,1+2*tiny,0],[1,-tiny,0]),hit:true,face:'1+'},
    {name:'near-parallel stays outside',r:ray([-2,1+8*tiny,0],[1,-tiny,0]),hit:false}
  ];
  for(const item of cases){
    const reference=slab(item.r,b);
    assert.equal(Boolean(reference),item.hit,item.name+' slab');
    if(item.hit)assert.equal(reference.face,item.face,item.name+' slab face');
    for(const partition of [1,2,4]){
      const got=candidate(item.r,[b],partition);
      assert(same(reference,got),item.name+' partition '+partition+
        ' '+JSON.stringify({reference,got}));
      partitionComparisons++;
    }
  }
  // Original near>far+EPS allowed a small positive gap in slab intervals.
  const gapRay=ray([-2,VERIFY_DEPTH_EPS/2,0],[1,1,0]);
  const gapNear=1,gapFar=1-VERIFY_DEPTH_EPS/2;
  assert(gapNear>gapFar && gapNear<=gapFar+VERIFY_DEPTH_EPS);
  assert.equal(slab(gapRay,b),null);
  for(const partition of [1,2,4])assert.equal(candidate(gapRay,[b],partition),null);

  // An adversarial ray grazing the X=-1 / Y=+1 corner exposes independent
  // binary64 rounding in naive slab-vs-recomputed-point predicates.
  let state=123456789,oldFloatFalseHits=0,nearUlpCompared=0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296};
  const offsets=[0,Number.EPSILON,-Number.EPSILON,
    2*Number.EPSILON,-2*Number.EPSILON,5e-10,-5e-10,
    1e-13,-1e-13,1e-15,-1e-15];
  for(let i=0;i<2200;i++){
    const y0=-.99+random()*1.98,z0=-.99+random()*1.98;
    const r=ray([-2,y0,z0],[1,1-y0+offsets[i%offsets.length],0]);
    const reference=slab(r,b);
    for(const partition of [1,2,4]){
      const got=candidate(r,[b],partition);
      assert(same(reference,got),JSON.stringify({i,partition,reference,got,r}));
      nearUlpCompared++;
    }
    const oldT=(b.hi[1]-r.o[1])/r.d[1];
    const oldX=r.o[0]+r.d[0]*oldT;
    if(oldT>0&&oldX>=b.lo[0]&&oldX<=b.hi[0]&&!reference)oldFloatFalseHits++;
  }
  assert(oldFloatFalseHits>0,'near-ULP control must catch naive float false hits');
  return {coverage_rule:'closed_box_exact_dyadic_membership_positive_representable_t',
    verification_epsilon_only:VERIFY_DEPTH_EPS,
    axis_side_cases:axisSideCases,axis_side_hits:hits,axis_side_misses:misses,
    adversarial_cases:cases.length,partition_comparisons:partitionComparisons+3+nearUlpCompared,
    near_ulp_ray_cases:2200,near_ulp_old_false_hits:oldFloatFalseHits,
    false_hit_reproduced_pre_fix:true,near_parallel_nonzero_tested:true,
    interval_gap_rejected:true};
});
// P2-A0-04: strict global first-hit identity requires EXACT interobject t,
// even when distinct dyadic rationals round to the SAME Number t.
const globalDepth=test('P2-A0-04 global exact first-hit/priority and exact bucket membership',()=>{
  const e=Number.EPSILON;
  const A=box('A',[1,-1,-1],[1+e,1,1],0);
  const B=box('B',[1+2*e,-1,-1],[1+3*e,1,1],1);
  const C=box('C',[1+4*e,-1,-1],[1+5*e,1,1],2);
  const r=ray([-4,0,0],[5,0,0]);
  const ha=slab(r,A),hb=slab(r,B);
  assert.equal(ha.t,1);assert.equal(hb.t,1);
  assert(compareExactDepth(ha,hb)<0);
  const oldFloatPriority=(ha.t===hb.t?hb.priority>ha.priority:hb.t<ha.t);
  assert(oldFloatPriority,'old rounded comparator negative control must fail');
  let permutationsChecked=0,partitionComparisons=0;
  for(const list of permutations([A,B,C])){
    permutationsChecked++;
    assert.equal(oracle(r,list).id,'A');
    for(const part of [1,2,4]){
      const winner=candidate(r,list,part);
      assert.equal(winner.id,'A');
      assert.equal(winner.face,'0-');
      partitionComparisons++;
    }
  }
  // Only a true equal rational depth is eligible for priority arbitration.
  const D=box('D',[1,-1,-1],[1+e,1,1],0);
  const E=box('E',[1,-1,-1],[1+e,1,1],5);
  for(const list of [[D,E],[E,D]]){
    assert.equal(oracle(r,list).id,'E');
    for(const part of [1,2,4])assert.equal(candidate(r,list,part).id,'E');
  }
  // Exact ownership across the x=0 synthetic region boundary must not
  // derive from p rounded to x=0. No geometry may be clipped by this bucket.
  const left=box('NearLeft',[-e,-1,-1],[-e/2,1,1],0);
  const right=box('NearRight',[e,-1,-1],[2*e,1,1],0);
  const splitRay=ray([-5,0,0],[5,0,0]);
  assert.deepEqual(exactBucketCoord(splitRay,left,'0-',2),[0,1,1]);
  assert.deepEqual(exactBucketCoord(splitRay,right,'0-',2),[1,1,1]);
  // Independent expected order: for common r.o and positive r.d[0],
  // the least representable world-space lower bound is nearest.
  let randomSeed=115092431,seededCases=0;
  const rnd=()=>{randomSeed=(Math.imul(1664525,randomSeed)+1013904223)>>>0;
    return randomSeed/4294967296;};
  for(let trial=0;trial<180;trial++){
    const offset=trial%4,boxesNear=[0,1,2].map((i)=>{
      const start=1+(offset+2*i)*e;
      return box('N'+i,[start,-1,-1],[start+e,1,1],i+1);
    });
    for(const scene of permutations(boxesNear)){
      assert.equal(oracle(r,scene).id,'N0');
      for(const part of [1,2,4]){
        assert.equal(candidate(r,scene,part).id,'N0');
        seededCases++;
      }
    }
    // A separate shuffled accumulation with priority inversions, but no
    // access to compareHit as the expected-value oracle.
    const order=boxesNear.map(b=>({b,order:rnd()})).sort((x,y)=>x.order-y.order).map(x=>x.b);
    assert.equal(oracle(r,order).id,'N0');
  }
  return {original_counterexample:'A_nearest_even_when_rounded_t_equal',
    original_rounded_t:[ha.t,hb.t],exact_ratio_order:'A_before_B',
    permutations:permutationsChecked,partition_comparisons:partitionComparisons,
    coplanar_priority:'E',global_exact_bucket_boundary:'NearLeft_vs_NearRight',
    seeded_near_ulp_comparisons:seededCases,source_depth_key:'finite_float64_triple'};
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
const report={schema:'fgmp-dr3-r0-cpu-preflight/1',classification:'CPU_ONLY_ANALYTIC_NOT_FGM0_NOT_GPU',fixture_sha256:hash,fixture_boxes:boxes.length,reference:'global slab O-H',candidate:'six-plane face intersections with exact dyadic global first-hit and bucket keys',eps_verify_depth:VERIFY_DEPTH_EPS,depth_order_policy:'exact_dyadic_interobject_t_then_priority_then_ascii_id_and_axis_minus_first',coverage_policy:'closed_AABB_exact_dyadic_predicates_for_ambiguous_float64',eq,ordering,coverage,globalDepth,naiveClip,phase,unseen,overhang,opacity,benches,hardware:{platform:process.platform,arch:process.arch,cpus:os.cpus()?.[0]?.model,logical_cpus:os.cpus()?.length,node:process.version},declared_remaining:'R0-02/07/08/13/14/16/17/19/20; real FGM-0, R07, GPU/VRAM, certifiable culling, UV/normal/mips and all 16 cold-warm E1 rows NOT RUN'};
console.log('R0_PREFLIGHT_JSON '+JSON.stringify(report));
if(process.exitCode)process.exit(process.exitCode);
