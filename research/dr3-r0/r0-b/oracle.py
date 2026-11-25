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
