"""Prepare immutable B1 inputs, then run only against separately registered hashes.
Usage: see README. All output lives outside the repository. No B2/B3 PASS claims.
"""
import argparse, copy, hashlib, json, math, pathlib, subprocess, sys
from fractions import Fraction as Q
from oracle import sample

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
BASE="0dee9d0a5362d1ed17cd266208ec116fe5f11b0e"
SCOPE="f1380a2bd5ec801f85e5de75a3de540d1da6385ca1e4c7ed441f1ce9cf585f88"
VOL=b"r0b-volume-v1"
def sha(b): return hashlib.sha256(b).hexdigest()
def canon(x):
    # This restricted fixture corpus uses ASCII and small integer/quarter/half
    # literals only. Reject other floating spellings rather than claim full JCS.
    def normal(v):
        if isinstance(v,float):
            if not math.isfinite(v) or abs(v)>64 or (v*16)%1:
                raise ValueError("outside restricted canonical fixture domain")
            return int(v) if v.is_integer() else v
        if isinstance(v,list): return [normal(a) for a in v]
        if isinstance(v,dict): return {k:normal(a) for k,a in v.items()}
        return v
    return json.dumps(normal(x),sort_keys=True,separators=(",",":"),ensure_ascii=True,allow_nan=False).encode()
def digest(domain,v): return sha(canon([domain,v]))
def prog(nodes,root,parameters=None):
    return {"op":"program","program":{"version":"fgm-0","nodes":nodes,"root":root},"parameters":parameters or {}}
def const(id,value):
    return {"id":id,"op":"constant","type":"vec3" if isinstance(value,list) else "length","value":value}
def box(half,offset=None):
    nodes=[const("extent",half),{"id":"b","op":"box","halfSize":"extent"}]
    if offset is not None:
        nodes += [const("offset",offset),{"id":"m","op":"translate","field":"b","offset":"offset"}]
    return prog(nodes,nodes[-1]["id"])
def con(id,material,priority,field): return dict(id=id,material=material,priority=priority,field=field)
def package(cs,volumes=None):
    g={"algorithm":"r0b","version":"1.0.0","parameters":{},"resources":{}}
    return {"format":"fgm-package/1","interpreter":"fgm-0/1","generation":g,
            "model":{"contributions":sorted(cs,key=lambda c:c["id"]),"volumes":volumes or {},
                     "seed":digest("fgm:seed:1",{"generation":g,"purpose":"model"})}}
def pose(t=(0,0,0),s=1,r=((1,0,0),(0,1,0),(0,0,1))):
    return {"translation":list(t),"rotation":[list(a) for a in r],"scale":s}
def world(p,T):
    return [T["translation"][i]+T["scale"]*sum(T["rotation"][i][j]*p[j] for j in range(3)) for i in range(3)]
def write_new(path,data):
    path.write_bytes(data)
def source_hashes():
    files=[HERE/n for n in ("CMakeLists.txt","native-probe.cpp","oracle.py","run.py","README.md")]
    files += [ROOT/"core"/n for n in ("CMakeLists.txt","src/evaluator.cpp","include/fgm/evaluator.hpp","tests/fixtures/c04-panel.fgm.json","tests/fixtures/c04-panel-expected.json")]
    return {str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in files}

def prepare(out):
    out.mkdir(parents=True,exist_ok=False)
    packages={}; rows=[]
    def add_pkg(id,p,raw=None,valid=True):
        b=canon(p) if raw is None else raw
        name=id+".json"
        write_new(out/name,b)
        rec={"file":name,"raw_sha256":sha(b),"valid":valid}
        if valid:
            canonical=copy.deepcopy(p)
            canonical["model"]["contributions"].sort(key=lambda c:c["id"])
            rec.update(canonical_sha256=sha(canon(canonical)),
                       model_sha256=digest("fgm:model:1",{k:canonical[k] for k in ("format","interpreter","model")}),
                       package_sha256=digest("fgm:package:1",canonical),
                       seed=canonical["model"]["seed"])
        packages[id]=rec
    def add(id,fam,p,xyz,T=None,res="none",error=None,address=None):
        expected={"error":error} if error else sample(p,xyz,T)
        rows.append(dict(id=id,family=fam,package=id.split(":")[0],point=xyz,pose=T,resolver=res,
                         expected=expected,address=address))
    orig=(ROOT/"core/tests/fixtures/c04-panel.fgm.json").read_bytes()
    c04=json.loads(orig); add_pkg("c04",c04)
    assert packages["c04"]["model_sha256"]=="6e2bae9d32d3910006d2938390467aa495739c4d3019ff3f31e3ef19998ce44b"
    assert packages["c04"]["package_sha256"]=="12a4ef920306139abb49da12fa3b08f6a99466ed6a204104b2c90ddfe0f01ec8"
    c04points=[[0,0,0],[1,0,0],[1,1,0],[2,1,0],[3,0,0],[.5,0,0],[.25,.25,0],[-1,0,0],[1.25,0,0],[1,0,.5],[0,1,1],[0,1,-.5]]
    for i,p in enumerate(c04points): add(f"c04:{i}","F01",c04,p)
    # Parameters of both types, nested min/max/subtraction, translate, wrapper.
    nodes=[{"id":"h","op":"parameter","type":"vec3"},{"id":"a","op":"box","halfSize":"h"},
           {"id":"r","op":"parameter","type":"length"},{"id":"s","op":"sphere","radius":"r"},
           const("offset",[1,0,0]),{"id":"m","op":"translate","field":"s","offset":"offset"},
           {"id":"u","op":"union","left":"a","right":"m"},
           {"id":"i","op":"intersection","left":"u","right":"a"},
           {"id":"cut","op":"subtract","left":"i","right":"s"},
           {"id":"mat","op":"material","field":"cut","kind":"ignored"}]
    param=package([con("part","stone",3,prog(nodes,"mat",{"h":[2,2,2],"r":1}))])
    add_pkg("param",param)
    T=pose((4,-2,1),2,((0,-1,0),(1,0,0),(0,0,1)))
    for i,x in enumerate([-4,-3,-2,-1,-.5,0,.5,1,1.5,2,3,4]):
        p=[x,0,0]; add(f"param:{i}:local","F02",param,p)
        add(f"param:{i}:world","F02",param,world(p,T),T)
    # Reordered equal-priority contributions; independent winner not input order.
    pair=package([con("a","stone",7,box([1,1,1])),con("b","metal",7,box([1,1,1],[.5,0,0]))])
    add_pkg("tie",pair)
    reverse=copy.deepcopy(pair);reverse["model"]["contributions"].reverse()
    add_pkg("reverse",reverse)
    assert packages["tie"]["package_sha256"]==packages["reverse"]["package_sha256"]
    # Same canonical bytes; also explicitly exercise unordered valid serialized input.
    assert packages["tie"]["raw_sha256"]!=packages["reverse"]["raw_sha256"]
    for i,x in enumerate([-2,-1,-.5,0,.25,.5,.75,1,1.25,1.5,2,3]):
        p=[x,0,0]
        add(f"tie:{i}","F03",pair,p)
        add(f"reverse:{i}","F03",reverse,p)
        for j,U in enumerate([pose((-4,2,0),.5),pose((5,0,-2),4)]):
            add(f"tie:{i}:instance{j}","F03",pair,world(p,U),U)
    # Same negative dyadic grid address expressed at two levels: (-1,1/2,0).
    for level,index in [(1,[-2,1,0]),(2,[-4,2,0])]:
        xyz=[v/(2**level) for v in index]
        add(f"tie:address{level}","F03",pair,xyz,address={"level":level,"index":index})
    v=package([con("v","ink",0,prog([{"id":"v","op":"volume","source":"v"}],"v"))],
              {"v":{"format":"r0b_fixed","sha256":sha(VOL)}})
    add_pkg("volume",v); write_new(out/"volume.source",VOL)
    smooth=package([con("blend","clay",0,{"op":"smooth_union","left":box([1,1,1],[-.5,0,0]),
             "right":box([1,1,1],[.5,0,0]),"allowed":box([2,2,2]),"protected":box([.25,.25,.25],[1.5,0,0]),"width":.5})])
    add_pkg("smooth",smooth)
    for i,x in enumerate([-3,-2,-1.5,-1,-.5,0,.25,.5,1,1.5,2,3]):
        add(f"volume:{i}","F04",v,[x,.5,0],res="fixed")
        add(f"smooth:{i}","F04",smooth,[x,0,0])
    # Single-fault cases, codes from pinned C01/C02/C03/C04 and evaluator source.
    def bad(id,source,mut,code):
        obj=copy.deepcopy(source);mut(obj);add_pkg(id,obj,valid=False)
        add(id+":error","F05",obj,[0,0,0],error=code)
    f=lambda p:p["model"]["contributions"][0]["field"]
    bad("missing",param,lambda p:f(p)["parameters"].pop("r"),"E_PARAMETER")
    bad("extra",param,lambda p:f(p)["parameters"].update(extra=1),"E_PARAMETER")
    bad("wrongtype",param,lambda p:f(p)["parameters"].update(r=[1,1,1]),"E_TYPE")
    bad("reference",param,lambda p:f(p)["program"]["nodes"][1].update(halfSize="unknown"),"E_REFERENCE")
    bad("unreachable",param,lambda p:f(p)["program"]["nodes"].append({"id":"unused","op":"not_valid"}),"E_OPERATION")
    bad("duplicate",param,lambda p:f(p)["program"]["nodes"].append(copy.deepcopy(f(p)["program"]["nodes"][0])),"E_DUPLICATE")
    bad("radius",param,lambda p:f(p)["parameters"].update(r=0),"E_VALUE")
    bad("version",param,lambda p:p.update(interpreter="unknown"),"E_PACKAGE_VERSION")
    bad("field",param,lambda p:f(p).update(op="unknown"),"E_FIELD")
    add_pkg("badjson",None,b'{"format":"a","format":"b"}',False)
    add("badjson:error","F05",None,[0,0,0],error="E_JSON")
    for res,code in [("none","E_VOLUME"),("reject","E_VOLUME"),("throw","E_VOLUME"),("inf","E_NUMERIC")]:
        add("volume:"+res,"F05",v,[0,0,0],res=res,error=code)
    for i,U in enumerate([pose(s=0),pose(r=((-1,0,0),(0,1,0),(0,0,1))),pose(r=((1,1,0),(0,1,0),(0,0,1)))]):
        add(f"tie:invalidpose{i}","F05",pair,[0,0,0],U,error="E_SPACE_TRANSFORM")
    # Supplemental P2-01: all three CSG operations and translated branch are live.
    active_nodes=[{"id":"h","op":"parameter","type":"vec3"},{"id":"a","op":"box","halfSize":"h"},
                  {"id":"r","op":"parameter","type":"length"},{"id":"s","op":"sphere","radius":"r"},
                  const("mr",1),{"id":"ms","op":"sphere","radius":"mr"},const("offset",[1.5,0,0]),
                  {"id":"m","op":"translate","field":"ms","offset":"offset"},
                  {"id":"u","op":"union","left":"a","right":"m"},const("clip_extent",[2,1,1]),
                  {"id":"clip","op":"box","halfSize":"clip_extent"},
                  {"id":"i","op":"intersection","left":"u","right":"clip"},
                  {"id":"cut","op":"subtract","left":"i","right":"s"},
                  {"id":"mat","op":"material","field":"cut","kind":"ignored"}]
    active=package([con("part","stone",3,prog(active_nodes,"mat",{"h":[1,2,1],"r":.5}))])
    add_pkg("active",active)
    points=[[x,0,0] for x in [-3,-2,-1.5,-1,-.5,0,.5,.75,1,1.25,1.5,1.75,2,2.25,2.5,3]]
    points += [[.75,1,0],[.75,-1,0],[.75,0,1],[.75,0,-1]]
    for i,p in enumerate(points):
        add(f"active:{i}:local","F02",active,p)
        add(f"active:{i}:world","F02",active,world(p,T),T)
    # Directly observe mutated serialized expressions, not modified product code.
    witnesses=[]
    for name,node,key,replacement,index,expected,altered in [
            ("drop_union","i","left","a",10,"-1/2","1/2"),
            ("drop_intersection","cut","left","u",13,"1/4","-1/4"),
            ("drop_translation","u","right","ms",10,"-1/2","1/2"),
            ("drop_subtraction","mat","field","i",5,"1/2","-1")]:
        mutant=copy.deepcopy(active)
        ns=mutant["model"]["contributions"][0]["field"]["program"]["nodes"]
        next(n for n in ns if n["id"]==node)[key]=replacement
        add_pkg(name,mutant)
        add(name+":witness","F02",mutant,points[index])
        witnesses.append({"kind":name,"correct":f"active:{index}:local","altered":name+":witness",
                          "correct_value":expected,"altered_value":altered})
    TT=pose(T["translation"],T["scale"],list(zip(*T["rotation"])))
    add("active:transpose","F02",active,world(points[10],T),TT)
    witnesses.append({"kind":"transpose_rotation","correct":"active:10:world","altered":"active:transpose",
                      "correct_value":"-1/2","altered_value":"1/2"})
    # Supplemental P2-02: ordered validation and eager left-before-right runtime.
    for name,first,code in [("precedence_early",True,"E_OPERATION"),("precedence_late",False,"E_PARAMETER")]:
        obj=copy.deepcopy(param)
        fld=obj["model"]["contributions"][0]["field"]
        fld["parameters"].pop("r")
        ns=fld["program"]["nodes"]
        ns.insert(0 if first else len(ns),{"id":"unused","op":"not_valid"})
        add_pkg(name,obj,valid=False)
        add(name+":error","F05",obj,[0,0,0],error=code)
    # Same immutable source bytes, two explicit synthetic resolver interpretations.
    volumes={"throws":{"format":"r0b_fixed","sha256":sha(VOL)},
             "nonfinite":{"format":"r0b_nonfinite","sha256":sha(VOL)}}
    fault_nodes=[const("h",[1,1,1]),{"id":"a","op":"box","halfSize":"h"},
                 {"id":"t","op":"volume","source":"throws"},
                 {"id":"n","op":"volume","source":"nonfinite"}]
    for root,code in [("t","E_VOLUME"),("n","E_NUMERIC")]:
        name="dual_"+root
        obj=package([con("part","stone",3,prog(fault_nodes,root))],volumes)
        add_pkg(name,obj)
        add(name+":error","F05",obj,[0,0,0],res="dual",error=code)
    for op in ("union","intersection","subtract"):
        for suffix,left,right,point,code in [
                ("right_needed","a","t",[0,0,0] if op=="union" else [2,0,0],"E_VOLUME"),
                ("left_needed","t","a",[2,0,0] if op=="intersection" else [0,0,0],"E_VOLUME"),
                ("throw_first","t","n",[0,0,0],"E_VOLUME"),
                ("numeric_first","n","t",[0,0,0],"E_NUMERIC")]:
            name=op+"_"+suffix
            obj=package([con("part","stone",3,prog(fault_nodes+[{"id":"root","op":op,"left":left,"right":right}],"root"))],volumes)
            add_pkg(name,obj)
            add(name+":error","F05",obj,point,res="dual",error=code)
    # Assert manually derived distinguishing witnesses before measuring anything.
    by_id={r["id"]:r for r in rows}
    for w in witnesses:
        assert by_id[w["correct"]]["expected"]["value"]==w["correct_value"],w
        assert by_id[w["altered"]]["expected"]["value"]==w["altered_value"],w
        assert by_id[w["correct"]]["expected"]["sign"]!=by_id[w["altered"]]["expected"]["sign"],w
    assert by_id["active:10:local"]["expected"]==by_id["active:10:world"]["expected"]
    for family in ("F01","F02","F03","F04"):
        assert sum(r["family"]==family for r in rows)>=12
    assert all(r["package"] in packages for r in rows)
    manifest={"schema":"r0b-b1-predeclaration/1","base":BASE,"scope_sha256":SCOPE,
              "sources":source_hashes(),"original_c04_file_sha256":sha(orig),
              "volume_source_sha256":sha(VOL),"packages":packages,"rows":rows,
              "supplemental_witnesses":witnesses,"historical_manifest_sha256":"286f0fe1824bb4f5a5fcf67380843f77fb996da8a80488ee34634a95c3fa6e03",
              "point_tolerance":"1e-9","ray_status":"NOT_RUN","p3_caps":{"B2_occurrences_per_contribution":16,
               "B3_mandatory_boxes":5,"B3_native_import_cap_not_coverage":128}}
    data=json.dumps(manifest,sort_keys=True,indent=2).encode()
    write_new(out/"manifest.json",data)
    print(json.dumps({"manifest_sha256":sha(data),"rows":len(rows),"packages":len(packages),
                      "families":{f:sum(r["family"]==f for r in rows) for f in ("F01","F02","F03","F04","F05")}}))

def execute(out,binary,mhash,bhash,receipt):
    raw=(out/"manifest.json").read_bytes()
    if sha(raw)!=mhash or sha(binary.read_bytes())!=bhash: raise SystemExit("HASH_MISMATCH")
    m=json.loads(raw)
    if m["scope_sha256"]!=SCOPE or m["sources"]!=source_hashes(): raise SystemExit("SOURCE_DRIFT")
    if sha((out/"volume.source").read_bytes())!=m["volume_source_sha256"]: raise SystemExit("VOLUME_DRIFT")
    for pkg in m["packages"].values():
        if sha((out/pkg["file"]).read_bytes())!=pkg["raw_sha256"]: raise SystemExit("PACKAGE_DRIFT")
    # Receipt id is recorded, operator must independently verify it binds hashes before this command.
    results=[]
    for row in m["rows"]:
        args=[str(binary),str(out/m["packages"][row["package"]]["file"]),row["resolver"],
              "world" if row["pose"] else "local",*map(str,row["point"])]
        if row["pose"]:
            t=row["pose"];args+=list(map(str,t["translation"]+[a for r in t["rotation"] for a in r]+[t["scale"]]))
        proc=subprocess.run(args,capture_output=True,text=True,timeout=30)
        got=proc.stdout.strip().split("\t");e=row["expected"];passed=False
        if proc.returncode==0 and "error" in e:
            passed=got==["ERROR",e["error"]]
        elif proc.returncode==0 and len(got)==4 and got[0]=="OK":
            v=float(got[1]);passed=math.isfinite(v) and abs(Q(v)-Q(e["value"]))<=Q(1,10**9) and ((v>0)-(v<0))==e["sign"] and got[2:]==[e["material"],e["contributor"]]
        results.append(dict(id=row["id"],pass_=passed,returncode=proc.returncode,stdout=proc.stdout,stderr=proc.stderr))
    report={"schema":"r0b-b1-result/1","manifest_sha256":mhash,"binary_sha256":bhash,"receipt":receipt,
            "results":results,"pass":sum(r["pass_"] for r in results),"total":len(results)}
    target=out/"result.json"
    with target.open("xb") as f:f.write(json.dumps(report,sort_keys=True,indent=2).encode())
    print(json.dumps({k:report[k] for k in ("pass","total")}|{"result_sha256":sha(target.read_bytes())}))
    return 0 if report["pass"]==report["total"] else 1
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("action",choices=["prepare","execute"]);p.add_argument("--out",type=pathlib.Path,required=True)
    p.add_argument("--binary",type=pathlib.Path);p.add_argument("--manifest-sha");p.add_argument("--binary-sha");p.add_argument("--receipt")
    a=p.parse_args();o=a.out.resolve()
    if o==ROOT or ROOT in o.parents: p.error("output must be outside checkout")
    if a.action=="prepare": prepare(o)
    else:
        if not all([a.binary,a.manifest_sha,a.binary_sha,a.receipt]): p.error("execution requires binary, exact hashes, registered receipt")
        sys.exit(execute(o,a.binary.resolve(),a.manifest_sha,a.binary_sha,a.receipt))
