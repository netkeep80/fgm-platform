"""B1 independent mathematical oracle for admitted exact rational point fixtures.
Not a production validator or ray oracle. Non-square sphere samples fail closed.
Invalid inputs use predeclared single-fault expected codes, not this interpreter.
"""
from fractions import Fraction as Q
from math import isqrt

def rational(x):
    if isinstance(x, bool):
        raise ValueError("boolean is not numeric")
    return Q(x)

def vector(xs):
    return tuple(map(rational, xs))

def sqrt_exact(x):
    n, d = isqrt(x.numerator), isqrt(x.denominator)
    if n*n != x.numerator or d*d != x.denominator:
        raise ValueError("UNRESOLVED_NUMERIC: non-square sphere probe")
    return Q(n,d)

def field(expr, p):
    if expr["op"] == "smooth_union":
        a,b = (field(expr[k],p) for k in ("left","right"))
        width = rational(expr["width"])
        strength = min(width,-field(expr["allowed"],p),
                       field(expr["protected"],p) if "protected" in expr else width)
        gap=abs(a-b)
        return min(a,b) if strength<=0 or gap>=strength else min(a,b)-strength/4*(1-gap/strength)**2
    assert expr["op"] == "program"
    nodes = {n["id"]:n for n in expr["program"]["nodes"]}
    def val(k):
        n=nodes[k]
        v=n["value"] if n["op"]=="constant" else expr["parameters"][k]
        return vector(v) if n["type"]=="vec3" else rational(v)
    def ev(k, x):
        n=nodes[k]; op=n["op"]
        if op=="box":
            return max(abs(a)-b for a,b in zip(x,val(n["halfSize"])))
        if op=="sphere":
            return sqrt_exact(sum(a*a for a in x))-val(n["radius"])
        if op=="translate":
            return ev(n["field"],tuple(a-b for a,b in zip(x,val(n["offset"]))))
        if op=="material":
            return ev(n["field"],x)
        if op=="volume":
            return x[0]/2+x[1]/4-1
        a,b=ev(n["left"],x),ev(n["right"],x)
        return {"union":min(a,b),"intersection":max(a,b),"subtract":max(a,-b)}[op]
    return ev(expr["program"]["root"],p)

def sample(pkg, p, pose=None):
    p=vector(p)
    if pose:
        shift=tuple((a-b)/rational(pose["scale"]) for a,b in zip(p,vector(pose["translation"])))
        p=tuple(sum(rational(pose["rotation"][i][j])*shift[i] for i in range(3)) for j in range(3))
    values=[(field(c["field"],p),c) for c in pkg["model"]["contributions"]]
    value=min(v for v,_ in values)
    winners=[c for v,c in values if v<0]
    winner=min(winners,key=lambda c:(-c["priority"],c["id"])) if winners else None
    return {"value":str(value),"sign":(value>0)-(value<0),
            "material":winner["material"] if winner else "-",
            "contributor":winner["id"] if winner else "-"}


# B2a O-H: global spatial arrangement; independent actual open-cell samples.
def b2_oracle(pkg, ray):
    from itertools import product
    from fractions import Fraction as Q
    cs=pkg["model"]["contributions"]
    assert len(cs)==1
    c=cs[0]; expr=c["field"]
    assert expr["op"]=="program"
    nodes={n["id"]:n for n in expr["program"]["nodes"]}
    leaves=[]
    def val(k):
        n=nodes[k]
        return tuple(map(Q,n["value"] if n["op"]=="constant" else expr["parameters"][k]))
    def expand(k, offset, path, polarity):
        n=nodes[k]; op=n["op"]
        if op=="box":
            h=val(n["halfSize"]); assert all(v>0 for v in h)
            lo=tuple(a-b for a,b in zip(offset,h)); hi=tuple(a+b for a,b in zip(offset,h))
            i=len(leaves); leaves.append((k,path,polarity,lo,hi)); return ("box",i)
        if op=="translate":
            return expand(n["field"],tuple(a+b for a,b in zip(offset,val(n["offset"]))),path+["field"],polarity)
        if op=="material": return expand(n["field"],offset,path+["field"],polarity)
        assert op in ("union","intersection","subtract")
        return (op,expand(n["left"],offset,path+["left"],polarity),
                expand(n["right"],offset,path+["right"],-polarity if op=="subtract" else polarity))
    graph=expand(expr["program"]["root"],(Q(0),)*3,[],1)
    assert len(leaves)<=16
    planes=sorted({(a,b[a]) for _,_,_,lo,hi in leaves for b in (lo,hi) for a in range(3)})
    def field_at(g,p):
        op=g[0]
        if op=="box":
            _,_,_,lo,hi=leaves[g[1]]
            return max(max(lo[a]-p[a],p[a]-hi[a]) for a in range(3))
        l,r=field_at(g[1],p),field_at(g[2],p)
        return min(l,r) if op=="union" else max(l,-r if op=="subtract" else r)
    def key(g): return [g[0],str(g[1])]
    o=tuple(map(Q,ray["o"])); d=tuple(map(Q,ray["d"]))
    near,far=map(Q,(ray["near"],ray["far"])); assert any(d) and 0<=near<far<=256
    def at(t):
        p=tuple(a+t*b for a,b in zip(o,d))
        z=[g for g in planes if p[g[0]]==g[1]]
        sectors=[]
        for bits in product((-1,1),repeat=len(z)):
            q=list(p)
            for (a,c0),side in zip(z,bits):
                # Actual adjacent arrangement cell midpoint, not a symbolic sign evaluator.
                ds=[abs(c1-c0) for a1,c1 in planes if a1==a and (c1-c0)*side>0]
                q[a]+=side*(min(ds)/2 if ds else Q(1))
            v=field_at(graph,q); assert v!=0
            sectors.append([list(bits),-1 if v<0 else 1])
        signs={s[1] for s in sectors}
        kind="BOUNDARY" if len(signs)==2 else "INTERIOR" if -1 in signs else "EXTERIOR"
        support=[]
        table={tuple(b):v for b,v in sectors}
        for i,g in enumerate(z):
            sides=set()
            for b,v in sectors:
                if b[i]!=-1: continue
                other=list(b);other[i]=1
                v2=table[tuple(other)]
                if v!=v2: sides.add(1 if v==-1 else -1)
            if sides: support.append([key(g),sorted(sides)])
        witnesses=[]
        for k,path,polarity,lo,hi in leaves:
            if all(lo[a]<=p[a]<=hi[a] for a in range(3)):
                for a in range(3):
                    for side,c0 in ((-1,lo[a]),(1,hi[a])):
                        if p[a]==c0: witnesses.append(["i",c["id"],k,path,[],polarity,[a,str(c0)],side])
        active=[w for w in witnesses if any(w[6]==s[0] for s in support)]
        return {"t":str(t),"point":list(map(str,p)),"kind":kind,"zeroGroups":list(map(key,z)),
                "sectors":sectors,"support":support,"zeroWitnessSet":witnesses,"boundaryPrimitiveId":active,
                "normal":support[0] if kind=="BOUNDARY" and len(support)==1 and len(support[0][1])==1 else None,
                "material":c["material"] if kind=="BOUNDARY" else None,
                "contributor":c["id"] if kind=="BOUNDARY" else None}
    ts=sorted({near,far}|{(b-o[a])/d[a] for a,b in planes if d[a] and near<=(b-o[a])/d[a]<=far})
    events=[at(t) for t in ts if t>0]
    intervals=[{"lo":str(a),"hi":str(b),"sample":at((a+b)/2)} for a,b in zip(ts,ts[1:])]
    hit=next((e for e in events if e["kind"]=="BOUNDARY"),None)
    status="UNSUPPORTED_RAY_ON_SURFACE" if any(v["sample"]["kind"]=="BOUNDARY" for v in intervals) else "HIT" if hit else "MISS"
    return {"status":status,"hit":hit if status=="HIT" else None,"events":events,"intervals":intervals}

# B2b.1: exact world box arrangement, independent scalar-field interpreter.
def b2b_oracle(scene, packages, ray):
    from fractions import Fraction as F
    from itertools import product
    import hashlib, json
    def canonical(x):
        return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    snapshot=hashlib.sha256(canonical(scene)).hexdigest()
    inst={i['id']:i for i in scene['instances']}
    def local(i,p):
        a=inst[i]; t=list(map(F,a['translation'])); s=F(a['scale']); R=a['rotation']
        return tuple(sum(R[j][k]*(p[j]-t[j]) for j in range(3))/s for k in range(3))
    def leaf(i,sp,pol):
        a=inst[i]; pkg=packages[a['package']]; rows=[]
        for c in pkg['model']['contributions']:
            expr=c['field']; assert expr['op']=='program'
            ns={n['id']:n for n in expr['program']['nodes']}; path=[]; offset=[F(0)]*3
            k=expr['program']['root']
            while ns[k]['op'] in ('translate','material'):
                n=ns[k]
                if n['op']=='translate':
                    v=ns[n['offset']]; offset=[x+F(y) for x,y in zip(offset,v['value'] if v['op']=='constant' else expr['parameters'][v['id']])]
                k=n['field'];path.append('field')
            n=ns[k]; assert n['op']=='box'
            v=ns[n['halfSize']]; half=list(map(F,v['value'] if v['op']=='constant' else expr['parameters'][v['id']]))
            assert all(x>0 for x in half)
            R=a['rotation']; s=F(a['scale']);t=list(map(F,a['translation']))
            center=[t[j]+s*sum(R[j][l]*offset[l] for l in range(3)) for j in range(3)]
            h=[s*sum(abs(R[j][l])*half[l] for l in range(3)) for j in range(3)]
            rows.append((i,c['id'],k,tuple(path),tuple(sp),pol,tuple(x-y for x,y in zip(center,h)),tuple(x+y for x,y in zip(center,h)),c['material'],c['priority']))
        return rows
    def solve(expr, namespace):
        leaves=[]
        def expand(e,sp=(),pol=1):
            if isinstance(e,str):
                ix=list(range(len(leaves),len(leaves)+len(packages[inst[e]['package']]['model']['contributions'])))
                leaves.extend(leaf(e,sp,pol));return ('package',ix)
            op,l,r=e
            return (op,expand(l,sp+('left',),pol),expand(r,sp+('right',),-pol if op=='subtract' else pol))
        graph=expand(expr)
        planes=sorted({(j,b[j]) for l in leaves for b in (l[6],l[7]) for j in range(3)})
        def evaluate(g,p):
            if g[0]=='package':
                vals=[]
                for k in g[1]:
                    l=leaves[k];v=max(max(l[6][j]-p[j],p[j]-l[7][j]) for j in range(3))
                    vals.append((v,l))
                return min(v for v,l in vals),{(l[0],l[1],l[8],l[9]) for v,l in vals if v<0}
            op=g[0];lv,lc=evaluate(g[1],p);rv,rc=evaluate(g[2],p)
            value=min(lv,rv) if op=='union' else max(lv,-rv if op=='subtract' else rv)
            return value,(lc if op=='subtract' else lc|rc) if value<0 else set()
        o=tuple(map(F,ray['o']));d=tuple(map(F,ray['d']));near,far=map(F,(ray['near'],ray['far']))
        def at(t):
            p=tuple(a+t*b for a,b in zip(o,d));zg=[(j,x) for j,x in planes if p[j]==x]
            sectors=[]; winners=set()
            for bits in product((-1,1),repeat=len(zg)):
                v=list(p)
                for (j,x),side in zip(zg,bits):
                    ds=[abs(y-x) for k,y in planes if k==j and (y-x)*side>0]
                    v[j]+=side*(min(ds)/2 if ds else F(1))
                f,owners=evaluate(graph,v);assert f!=0
                w=min(owners,key=lambda x:(-x[3],x[0],x[1])) if f<0 else None
                if w is not None:winners.add(w)
                sectors.append([list(bits),-1 if f<0 else 1,list(w) if w is not None else None])
            signs={s[1] for s in sectors};kind='BOUNDARY' if len(signs)==2 else 'INTERIOR' if -1 in signs else 'EXTERIOR'
            table={tuple(b):v for b,v,_ in sectors};sup=[]
            for i,g in enumerate(zg):
                sides=set()
                for b,v,_ in sectors:
                    if b[i]!=-1:continue
                    other=list(b);other[i]=1;v2=table[tuple(other)]
                    if v!=v2:sides.add(1 if v==-1 else -1)
                if sides:sup.append([[g[0],str(g[1])],sorted(sides)])
            ws=[]
            for i,c,k,pp,sp,pol,lo,hi,_,_ in leaves:
                if all(lo[j]<=p[j]<=hi[j] for j in range(3)):
                    for j in range(3):
                        for side,x in ((-1,lo[j]),(1,hi[j])):
                            if p[j]==x:ws.append((i,c,k,pp,sp,pol,j,x,side))
            ws.sort(); active=[w for w in ws if [w[6],str(w[7])] in [s[0] for s in sup]]
            def wire(w):return [*w[:3],list(w[3]),list(w[4]),w[5],[w[6],str(w[7])],w[8]]
            sig=[snapshot,scene['mode'],sup,[wire(w) for w in active]] if kind=='BOUNDARY' else None
            hitkey=[sig,list(map(str,p))] if sig is not None else None
            owner_rows=sorted(winners) if sig is not None else []
            gp=p if namespace=='world' else local(namespace,p)
            addresses=[[namespace,'1',lev,[str(x*(2**lev)//1) for x in gp]] for lev in range(3)] if sig is not None else []
            return {'t':str(t),'point':list(map(str,p)),'kind':kind,'zeroGroups':[[j,str(x)] for j,x in zg],
                    'rank':len(zg),'minor':1,'sectors':sectors,'support':sup,'zeroWitnessSet':[wire(w) for w in ws],
                    'boundaryPrimitiveId':[wire(w) for w in active],
                    'coincident':any(sum(w[6]==s[0][0] and str(w[7])==s[0][1] for w in active)>1 for s in sup),
                    'normal':sup[0] if sig is not None and len(sup)==1 and len(sup[0][1])==1 else None,
                    'owners':[list(w) for w in owner_rows], 'ownerStatus':('AMBIGUOUS_OWNER' if len(owner_rows)>1 else 'UNIQUE') if sig is not None else None,
                    'objectInstanceId':sorted({w[0] for w in owner_rows}), 'globalHitKey':hitkey,
                    'addresses':addresses,'boundaryFragmentId':[[hitkey,a] for a in addresses]}
        ts=sorted({near,far}|{(x-o[j])/d[j] for j,x in planes if d[j] and near<=(x-o[j])/d[j]<=far})
        events=[at(t) for t in ts if t>0]; intervals=[{'lo':str(a),'hi':str(b),'sample':at((a+b)/2)} for a,b in zip(ts,ts[1:])]
        hit=next((e for e in events if e['kind']=='BOUNDARY'),None)
        status='UNSUPPORTED_RAY_ON_SURFACE' if any(i['sample']['kind']=='BOUNDARY' for i in intervals) else 'HIT' if hit else 'MISS'
        return {'status':status,'hit':hit if status=='HIT' else None,'events':events,'intervals':intervals}
    if scene['mode']=='world':return solve(scene['expr'],'world')
    parts={i:solve(i,i) for i in sorted(inst)}
    hs=[r['hit'] for r in parts.values() if r['status']=='HIT']
    def order(h):
        w=min(h['owners'],key=lambda x:(-x[3],x[0],x[1]));return (F(h['t']),-w[3],w[0],w[1])
    status='UNSUPPORTED_RAY_ON_SURFACE' if any(r['status']=='UNSUPPORTED_RAY_ON_SURFACE' for r in parts.values()) else 'HIT' if hs else 'MISS'
    return {'status':status,'hit':min(hs,key=order) if status=='HIT' else None,'parts':parts}
# END B2B1 ORACLE
