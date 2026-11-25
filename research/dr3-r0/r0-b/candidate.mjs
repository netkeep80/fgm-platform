// B2a independent exact primitive-plane event kernel; single identity placement.
import fs from "node:fs";
import path from "node:path";
const abs=x=>x<0n?-x:x;
function gcd(a,b){a=abs(a);b=abs(b);while(b){[a,b]=[b,a%b]}return a;}
class R {
  constructor(n,d=1n){if(!d)throw Error("ZERO_DENOM");if(d<0n){n=-n;d=-d;}const g=gcd(n,d);this.n=n/g;this.d=d/g;}
  add(b){return new R(this.n*b.d+b.n*this.d,this.d*b.d);}
  sub(b){return new R(this.n*b.d-b.n*this.d,this.d*b.d);}
  mul(b){return new R(this.n*b.n,this.d*b.d);}
  div(b){return new R(this.n*b.d,this.d*b.n);}
  cmp(b){const v=this.n*b.d-b.n*this.d;return v<0n?-1:v>0n?1:0;}
  toString(){return this.d===1n?String(this.n):String(this.n)+"/"+String(this.d);}
}
function q(v){let s=String(v);if(s.includes("/")){let [n,d]=s.split("/");return new R(BigInt(n),BigInt(d));}if(!/^-?\d+(\.\d+)?$/.test(s))throw Error("RATIONAL_DOMAIN");let [a,b=""]=s.split(".");return new R(BigInt(a+b),10n**BigInt(b.length));}
const zero=q(0),two=q(2),cmp=(a,b)=>a.cmp(b);
function trace(pkg,ray){
  if(pkg.format!=="fgm-package/1"||pkg.interpreter!=="fgm-0/1"||pkg.model.contributions.length!==1)throw Error("B2A_DOMAIN");
  const c=pkg.model.contributions[0],e=c.field;
  if(e.op!=="program")throw Error("B2A_GRAMMAR");
  const ns=new Map(e.program.nodes.map(n=>[n.id,n])),leaves=[],groups=new Map();
  function getVec(id){const n=ns.get(id);if(n.type!=="vec3")throw Error("VECTOR");return (n.op==="constant"?n.value:e.parameters[id]).map(q);}
  function plane(a,x){const k=a+":"+x.toString();if(!groups.has(k))groups.set(k,{a,x,k});return groups.get(k);}
  function compile(id,offset,p,polarity){
    const n=ns.get(id);
    if(n.op==="box"){
      const h=getVec(n.halfSize),lo=offset.map((x,a)=>x.sub(h[a])),hi=offset.map((x,a)=>x.add(h[a]));
      if(h.some(x=>x.cmp(zero)<=0))throw Error("BOX");
      const faces=[];for(let a=0;a<3;a++){faces.push({g:plane(a,lo[a]),side:-1},{g:plane(a,hi[a]),side:1});}
      const l={id,p,polarity,faces};leaves.push(l);return {op:"box",l};
    }
    if(n.op==="translate")return compile(n.field,offset.map((x,a)=>x.add(getVec(n.offset)[a])),[...p,"field"],polarity);
    if(n.op==="material")return compile(n.field,offset,[...p,"field"],polarity);
    if(!["union","intersection","subtract"].includes(n.op))throw Error("B2A_GRAMMAR");
    return {op:n.op,l:compile(n.left,offset,[...p,"left"],polarity),r:compile(n.right,offset,[...p,"right"],n.op==="subtract"?-polarity:polarity)};
  }
  const g=compile(e.program.root,[zero,zero,zero],[],1);
  if(leaves.length>16)throw Error("B2A_DOMAIN");
  const planes=[...groups.values()].sort((a,b)=>a.a-b.a||cmp(a.x,b.x));
  const key=g=>[g.a,g.x.toString()];
  const o=ray.o.map(q),d=ray.d.map(q),near=q(ray.near),far=q(ray.far);
  if(d.every(x=>x.n===0n)||near.cmp(zero)<0||near.cmp(far)>=0||far.cmp(q(256))>0)throw Error("RAY_DOMAIN");
  function classify(t){
    const p=o.map((x,a)=>x.add(t.mul(d[a])));
    const raw=new Map(planes.map(s=>[s.k,p[s.a].cmp(s.x)]));
    const zg=planes.filter(s=>raw.get(s.k)===0), sectors=[];
    if(zg.length>3)throw Error("RANK");
    // Candidate uses Boolean sign propagation, never sampled spatial points.
    function sign(n,s){
      if(n.op==="box"){
        const out=n.l.faces.map(f=>s.get(f.g.k)*f.side);
        return [out.every(v=>v<0),out.some(v=>v>0)];
      }
      const [ln,lp]=sign(n.l,s),[rn,rp]=sign(n.r,s);
      if(n.op==="union")return [ln||rn,lp&&rp];
      if(n.op==="intersection")return [ln&&rn,lp||rp];
      return [ln&&rp,lp||rn];
    }
    for(let mask=0;mask<2**zg.length;mask++){
      const bits=zg.map((_,i)=>(mask&(1<<(zg.length-1-i)))?1:-1);
      const s=new Map(raw);zg.forEach((v,i)=>s.set(v.k,bits[i]));
      const [neg,pos]=sign(g,s);if(neg===pos)throw Error("SECTOR");
      sectors.push([bits,neg?-1:1]);
    }
    const vset=new Set(sectors.map(s=>s[1])),kind=vset.size===2?"BOUNDARY":vset.has(-1)?"INTERIOR":"EXTERIOR";
    const support=[];
    zg.forEach((v,i)=>{const bit=1<<(zg.length-1-i),sides=new Set();
      for(let mask=0;mask<sectors.length;mask++){if(mask&bit)continue;const l=sectors[mask][1],r=sectors[mask|bit][1];if(l!==r)sides.add(l===-1?1:-1);}
      if(sides.size)support.push([key(v),[...sides].sort((a,b)=>a-b)]);
    });
    const zeroWitnessSet=[];
    for(const l of leaves){
      if(l.faces.some(f=>raw.get(f.g.k)*f.side>0))continue;
      for(const f of l.faces)if(raw.get(f.g.k)===0)zeroWitnessSet.push(["i",c.id,l.id,l.p,[],l.polarity,key(f.g),f.side]);
    }
    const boundaryPrimitiveId=zeroWitnessSet.filter(w=>support.some(s=>s[0][0]===w[6][0]&&s[0][1]===w[6][1]));
    return {t:String(t),point:p.map(String),kind,zeroGroups:zg.map(key),sectors,support,zeroWitnessSet,boundaryPrimitiveId,
      normal:kind==="BOUNDARY"&&support.length===1&&support[0][1].length===1?support[0]:null,
      material:kind==="BOUNDARY"?c.material:null,contributor:kind==="BOUNDARY"?c.id:null};
  }
  const eventsByT=new Map([[String(near),near],[String(far),far]]);
  for(const s of planes){if(d[s.a].n===0n)continue;const t=s.x.sub(o[s.a]).div(d[s.a]);if(t.cmp(near)>=0&&t.cmp(far)<=0)eventsByT.set(String(t),t);}
  const ordered=[...eventsByT.values()].sort(cmp),events=[],intervals=[];
  for(let i=0;i<ordered.length;i++){const a=ordered[i];if(a.cmp(zero)>0)events.push(classify(a));if(i+1<ordered.length){const b=ordered[i+1];intervals.push({lo:String(a),hi:String(b),sample:classify(a.add(b).div(two))});}}
  const hit=events.find(e=>e.kind==="BOUNDARY")??null;
  const status=intervals.some(v=>v.sample.kind==="BOUNDARY")?"UNSUPPORTED_RAY_ON_SURFACE":hit?"HIT":"MISS";
  return {status,hit:status==="HIT"?hit:null,events,intervals};
}

// B2b.1: separate exact sign-sector scene evaluator, no spatial-point sampling.
async function b2bMain() {
  const {readFileSync}=await import('node:fs');
  const {createHash}=await import('node:crypto');
  const {join}=await import('node:path');
  const abs=x=>x<0n?-x:x;
  function gcd(a,b){a=abs(a);b=abs(b);while(b)[a,b]=[b,a%b];return a;}
  class Q {
    constructor(a,b=1n){if(!b)throw Error('denominator');if(b<0n){a=-a;b=-b;}const g=gcd(a,b);this.a=a/g;this.b=b/g;}
    add(x){return new Q(this.a*x.b+x.a*this.b,this.b*x.b);}
    sub(x){return new Q(this.a*x.b-x.a*this.b,this.b*x.b);}
    mul(x){return new Q(this.a*x.a,this.b*x.b);}
    div(x){return new Q(this.a*x.b,this.b*x.a);}
    cmp(x){const v=this.a*x.b-x.a*this.b;return v<0n?-1:v>0n?1:0;}
    floor(){return this.a>=0n?this.a/this.b:-((-this.a+this.b-1n)/this.b);}
    toString(){return this.b===1n?String(this.a):String(this.a)+'/'+String(this.b);}
  }
  // Decode JSON numeric values as exact IEEE754 binary64, not decimal rationals.
  function q(v){if(typeof v==='string'){const [a,b='1']=v.split('/');return new Q(BigInt(a),BigInt(b));}
    if(!Number.isFinite(v))throw Error('nonfinite');const dv=new DataView(new ArrayBuffer(8));dv.setFloat64(0,v);const u=dv.getBigUint64(0),e=Number((u>>52n)&2047n),m=(u&((1n<<52n)-1n))+(e===0?0n:1n<<52n),n=(u>>63n)?-m:m,k=(e===0?1:e)-1023-52;return k>=0?new Q(n<<BigInt(k)):new Q(n,1n<<BigInt(-k));}
  const z=q(0),add=(a,b)=>a.add(b),sum=a=>a.reduce(add,z),eq=(a,b)=>a.cmp(b)===0;
  function canonical(x){return x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';}
  const hash=x=>createHash('sha256').update(x).digest('hex');
  function lex(a,b){if(Array.isArray(a)){for(let k=0;k<Math.min(a.length,b.length);k++){const c=lex(a[k],b[k]);if(c)return c;}return a.length-b.length;}if(a instanceof Q)return a.cmp(b);return a<b?-1:a>b?1:0;}
  const rank=(a,b)=>b[3]-a[3]||lex(a.slice(0,2),b.slice(0,2));
  const root=process.argv[3], input=JSON.parse(readFileSync(0,'utf8'));
  const packages=new Map();for(const [name,p] of Object.entries(input.packages)){const bytes=readFileSync(join(root,p.file));if(hash(bytes)!==p.raw_sha256)throw Error('package drift');packages.set(name,JSON.parse(bytes));}
  function trace(scene,ray,reverse){
    const snapshot=hash(canonical(scene)),inst=new Map(scene.instances.map(a=>[a.id,a]));
    function local(i,p){const a=inst.get(i),s=q(a.scale),v=p.map((x,j)=>x.sub(q(a.translation[j])));return [0,1,2].map(k=>sum(v.map((x,j)=>x.mul(q(a.rotation[j][k])))).div(s));}
    function solve(expr,namespace){
      const leaves=[],gm=new Map();
      function plane(j,x){const k=j+':'+x; if(!gm.has(k))gm.set(k,{j,x,k});return gm.get(k);}
      function compile(e,sp=[],pol=1){
        if(typeof e==='string'){
          const a=inst.get(e),pkg=packages.get(a.package),cs=[...pkg.model.contributions];if(reverse)cs.reverse();
          return {op:'package',cs:cs.map(c=>{
            const ex=c.field,ns=new Map(ex.program.nodes.map(n=>[n.id,n]));let n=ns.get(ex.program.root),p=[],off=[z,z,z];
            const vec=id=>{const x=ns.get(id);return (x.op==='constant'?x.value:ex.parameters[id]).map(q);};
            while(n.op==='translate'||n.op==='material'){if(n.op==='translate'){const d=vec(n.offset);off=off.map((x,k)=>x.add(d[k]));}p.push('field');n=ns.get(n.field);}
            if(n.op!=='box')throw Error('B2b1 grammar');const half=vec(n.halfSize),faces=[];
            // Transform each actual local support face, including orientation under negative axes.
            for(let j=0;j<3;j++){const k=a.rotation[j].findIndex(v=>v!==0),sg=a.rotation[j][k],s=q(a.scale);
              for(const side of [-1,1]){const x=q(a.translation[j]).add(s.mul(q(sg)).mul(off[k].add(q(side).mul(half[k]))));faces.push({g:plane(j,x),side:side*sg});}}
            const l={id:[e,c.id,n.id,p,sp,pol],faces,owner:[e,c.id,c.material,c.priority]};leaves.push(l);return l;
          })};
        }
        const [op,l,r]=e;return {op,l:compile(l,[...sp,'left'],pol),r:compile(r,[...sp,'right'],op==='subtract'?-pol:pol)};
      }
      const g=compile(expr),planes=[...gm.values()].sort((a,b)=>a.j-b.j||a.x.cmp(b.x));
      const o=ray.o.map(q),d=ray.d.map(q),near=q(ray.near),far=q(ray.far);
      function at(t){
        const p=o.map((x,j)=>x.add(t.mul(d[j]))),raw=new Map(planes.map(g=>[g.k,p[g.j].cmp(g.x)])),zg=planes.filter(g=>raw.get(g.k)===0),sectors=[],winners=new Map();
        function evaluate(n,s){
          if(n.op==='package'){const owners=n.cs.filter(l=>l.faces.every(f=>s.get(f.g.k)*f.side<0)).map(l=>l.owner);return [owners.length>0,owners];}
          const [l,lc]=evaluate(n.l,s),[r,rc]=evaluate(n.r,s);const neg=n.op==='union'?l||r:n.op==='intersection'?l&&r:l&&!r;
          return [neg,neg?(n.op==='subtract'?lc:[...lc,...rc]):[]];
        }
        for(let mask=0;mask<2**zg.length;mask++){const bits=zg.map((_,i)=>mask&(1<<(zg.length-1-i))?1:-1),s=new Map(raw);zg.forEach((g,i)=>s.set(g.k,bits[i]));const [neg,owners]=evaluate(g,s),w=neg?owners.sort(rank)[0]:null;if(w)winners.set(canonical(w),w);sectors.push([bits,neg?-1:1,w]);}
        const signs=new Set(sectors.map(s=>s[1])),kind=signs.size===2?'BOUNDARY':signs.has(-1)?'INTERIOR':'EXTERIOR',sup=[];
        zg.forEach((g,i)=>{const bit=1<<(zg.length-1-i),sides=new Set();for(let k=0;k<sectors.length;k++){if(k&bit)continue;const l=sectors[k][1],r=sectors[k|bit][1];if(l!==r)sides.add(l===-1?1:-1);}if(sides.size)sup.push([[g.j,String(g.x)],[...sides].sort((a,b)=>a-b)]);});
        const ws=[];for(const l of leaves){if(l.faces.some(f=>raw.get(f.g.k)*f.side>0))continue;for(const f of l.faces)if(raw.get(f.g.k)===0)ws.push([...l.id,f.g.j,f.g.x,f.side]);}
        ws.sort(lex);const active=ws.filter(w=>sup.some(s=>s[0][0]===w[6]&&s[0][1]===String(w[7]))),wire=w=>[...w.slice(0,6),[w[6],String(w[7])],w[8]];
        const sig=kind==='BOUNDARY'?[snapshot,scene.mode,sup,active.map(wire)]:null,key=sig?[sig,p.map(String)]:null,owners=sig?[...winners.values()].sort(lex):[];
        const gp=namespace==='world'?p:local(namespace,p),addresses=sig?[0,1,2].map(lev=>[namespace,'1',lev,gp.map(x=>String(x.mul(q(2**lev)).floor()))]):[];
        return {t:String(t),point:p.map(String),kind,zeroGroups:zg.map(g=>[g.j,String(g.x)]),rank:zg.length,minor:1,sectors,support:sup,zeroWitnessSet:ws.map(wire),boundaryPrimitiveId:active.map(wire),coincident:sup.some(s=>active.filter(w=>w[6]===s[0][0]&&String(w[7])===s[0][1]).length>1),normal:sig&&sup.length===1&&sup[0][1].length===1?sup[0]:null,owners,ownerStatus:sig?(owners.length>1?'AMBIGUOUS_OWNER':'UNIQUE'):null,objectInstanceId:[...new Set(owners.map(w=>w[0]))].sort(),globalHitKey:key,addresses,boundaryFragmentId:addresses.map(a=>[key,a])};
      }
      const ts=new Map([[String(near),near],[String(far),far]]);for(const g of (reverse?[...planes].reverse():planes)){if(d[g.j].a===0n)continue;const t=g.x.sub(o[g.j]).div(d[g.j]);if(t.cmp(near)>=0&&t.cmp(far)<=0)ts.set(String(t),t);}
      const ordered=[...ts.values()].sort((a,b)=>a.cmp(b)),events=[],intervals=[];for(let i=0;i<ordered.length;i++){const a=ordered[i];if(a.cmp(z)>0)events.push(at(a));if(i+1<ordered.length){const b=ordered[i+1];intervals.push({lo:String(a),hi:String(b),sample:at(a.add(b).div(q(2)))});}}
      const hit=events.find(e=>e.kind==='BOUNDARY')??null,status=intervals.some(i=>i.sample.kind==='BOUNDARY')?'UNSUPPORTED_RAY_ON_SURFACE':hit?'HIT':'MISS';return {status,hit:status==='HIT'?hit:null,events,intervals};
    }
    if(scene.mode==='world')return solve(scene.expr,'world');
    const ids=[...inst.keys()].sort();if(reverse)ids.reverse();const parts=Object.fromEntries(ids.map(i=>[i,solve(i,i)])),hs=Object.values(parts).filter(r=>r.status==='HIT').map(r=>r.hit);
    hs.sort((a,b)=>q(a.t).cmp(q(b.t))||rank([...a.owners].sort(rank)[0],[...b.owners].sort(rank)[0]));const status=Object.values(parts).some(r=>r.status==='UNSUPPORTED_RAY_ON_SURFACE')?'UNSUPPORTED_RAY_ON_SURFACE':hs.length?'HIT':'MISS';return {status,hit:status==='HIT'?hs[0]:null,parts};
  }
  const results=input.rows.map(r=>({id:r.id,forward:trace(input.scenes[r.scene],r.ray,false),reverse:trace(input.scenes[r.scene],r.ray,true)}));
  process.stdout.write(JSON.stringify(results));
}
// END B2B1 CANDIDATE

if (process.argv[2]==="--b2b") await b2bMain();
else {
const jobs=JSON.parse(fs.readFileSync(0,"utf8")),root=process.argv[2],cache=new Map();
const results=jobs.map(j=>{if(!cache.has(j.file))cache.set(j.file,JSON.parse(fs.readFileSync(path.join(root,j.file),"utf8")));return {id:j.id,...trace(cache.get(j.file),j.ray)};});
process.stdout.write(JSON.stringify(results));
}
