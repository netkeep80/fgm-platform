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
