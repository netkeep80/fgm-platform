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
const jobs=JSON.parse(fs.readFileSync(0,"utf8")),root=process.argv[2],cache=new Map();
const results=jobs.map(j=>{if(!cache.has(j.file))cache.set(j.file,JSON.parse(fs.readFileSync(path.join(root,j.file),"utf8")));return {id:j.id,...trace(cache.get(j.file),j.ray)};});
process.stdout.write(JSON.stringify(results));
