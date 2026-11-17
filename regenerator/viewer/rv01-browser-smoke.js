/* RV01: детерминированный headless-тест на собственных R06/R07 файлах.
   Загружается только локально в отдельной тестовой HTML-странице. */
(async () => {
  const fixtures=window.__rv01Fixtures;
  const status=document.getElementById("status");
  const select=document.getElementById("object");
  const mode=document.getElementById("mode");
  const canvas=document.getElementById("viewport");
  const gl=canvas.getContext("webgl2");
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const original=Object.fromEntries(Object.entries(fixtures).map(([k,v])=>[
    k,Uint8Array.from(atob(v),c=>c.charCodeAt(0))]));
  const encode=o=>encoder.encode(JSON.stringify(o));
  const json=b=>JSON.parse(decoder.decode(b));
  const digest=async b=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",b))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let phase=0;
  const slice=prefix=>Object.fromEntries(Object.entries(original)
    .filter(([path])=>path.startsWith(prefix)));
  const key=(o,name)=>Object.keys(o).find(k=>k.endsWith("/"+name));
  const get=(o,name)=>json(o[key(o,name)]);
  const put=(o,name,value)=>({...o,[key(o,name)]:value});
  async function load(dict,shouldPass,code){
    document.body.dataset.rv01Stage="load-"+(++phase);
    const input=document.getElementById("individual");
    const n=select.options.length,chosen=select.selectedOptions[0]?.textContent;
    const files=Object.entries(dict).map(([path,content])=>{
      const file=new File([content],path.split("/").pop(),{type:"application/octet-stream"});
      Object.defineProperty(file,"webkitRelativePath",{configurable:true,value:path});
      return file;
    });
    Object.defineProperty(input,"files",{configurable:true,value:files});
    status.textContent="TEST_PENDING";
    const completed=new Promise(resolve=>{
      const observer=new MutationObserver(()=>{
        if(status.textContent!=="TEST_PENDING"){
          observer.disconnect();resolve();
        }
      });
      observer.observe(status,{childList:true,subtree:true,characterData:true});
    });
    input.dispatchEvent(new Event("change"));
    const state=await Promise.race([completed.then(()=>"COMPLETE"),sleep(60000).then(()=>"TIMEOUT")]);
    if(state==="TIMEOUT")throw Error("RV01_LOAD_TIMEOUT_PHASE_"+phase+"_"+status.textContent+"_"+(window.__rv01LoadStage||"none"));
    const ok=status.textContent.includes("Локально загружено");
    if(ok!==shouldPass)throw Error("Ожидался "+shouldPass+", получено "+status.textContent);
    if(!shouldPass){
      if(!status.textContent.includes(code))throw Error("Неверный отказ "+code+": "+status.textContent);
      if(select.options.length!==n||select.selectedOptions[0]?.textContent!==chosen)
        throw Error("Ошибка частично заменила активную сессию");
    }
  }
  const screenshot=()=>{
    const buf=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let pixels=0,hash=2166136261;
    for(let i=0;i<buf.length;i+=4){
      if(buf[i]>65&&buf[i+1]>65&&buf[i+2]>65)pixels++;
      hash=Math.imul(hash^buf[i],16777619)>>>0;
      hash=Math.imul(hash^buf[i+1],16777619)>>>0;
    }
    return {pixels,hash};
  };
  const choose=i=>{select.value=String(i);select.dispatchEvent(new Event("change"));};
  const view=name=>document.querySelector('[data-view="'+name+'"]').click();
  const change=name=>{mode.value=name;mode.dispatchEvent(new Event("change"));};
  try {
    if(!gl)throw Error("Нет WebGL2");
    const grid=document.getElementById("grid");
    grid.checked=false;grid.dispatchEvent(new Event("change"));
    for(const kind of ["slab","arch","boulder","empty"]){
      document.body.dataset.rv01Stage="positive-r06-"+kind;
      await load(slice("fixtures/"+kind+"/"),true);
      if(select.options.length!==1||!select.options[0].textContent.endsWith(kind))
        throw Error("Неверный R06 объект "+kind);
      change("reconstructed");
      if(kind==="empty"){
        if(!document.getElementById("info").textContent.includes("empty"))
          throw Error("Пустая геометрия не принята");
      } else if(screenshot().pixels<20){
        throw Error("R06 не отрисован: "+kind);
      }
      if(kind==="boulder"){
        const hashes=[];
        for(const dir of ["left","right","rear","top"]){
          view(dir);hashes.push(screenshot().hash);
        }
        if(new Set(hashes).size<2)throw Error("Ракурсы boulder не различаются");
        document.getElementById("reset").click();
        const before=screenshot().hash;
        canvas.setPointerCapture=()=>{};
        canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:140,clientY:140,button:0,pointerId:1}));
        canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:210,clientY:175,button:0,pointerId:1}));
        canvas.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:210,clientY:175,button:0,pointerId:1}));
        if(before===screenshot().hash)throw Error("Mouse rotation без эффекта");
        const rot=screenshot().hash;
        canvas.dispatchEvent(new WheelEvent("wheel",{bubbles:true,cancelable:true,deltaY:-350}));
        if(rot===screenshot().hash)throw Error("Wheel zoom без эффекта");
        const zoom=screenshot().hash;
        canvas.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:150,clientY:150,button:2,pointerId:2}));
        canvas.dispatchEvent(new PointerEvent("pointermove",{bubbles:true,clientX:220,clientY:175,button:2,pointerId:2}));
        canvas.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,clientX:220,clientY:175,button:2,pointerId:2}));
        if(zoom===screenshot().hash)throw Error("Mouse pan без эффекта");
      }
    }
    document.body.dataset.rv01Stage="positive-r07";
    await load(slice("fixtures/r07/"),true);
    if(select.options.length!==1||!select.options[0].textContent.includes("R07"))
      throw Error("R07 не загружен");
    if(mode.options.length!==4||[...mode.options].some(x=>["original","free"].includes(x.value)))
      throw Error("Декоративные режимы ещё активны");
    change("baseline");const baseline=screenshot().hash;
    change("reconstructed");const reconstructed=screenshot().hash;
    if(baseline===reconstructed)throw Error("Нет различия baseline/reconstructed");
    change("difference");
    if(screenshot().pixels<20)throw Error("Режим Difference пуст");

    const slab=slice("fixtures/slab/");
    let obj=put(slab,"preview.obj",encoder.encode(
      "o terrain\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n"));
    let proof=get(obj,"viewer-proof.json");
    proof.mesh_sha256=await digest(obj[key(obj,"preview.obj")]);
    obj=put(obj,"viewer-proof.json",encode(proof));
    await load(obj,false,"E_RV01_R06_MESH_MISMATCH");

    let broken=put(slab,"model.fgm.json",encode({
      format:"fgm-package/1",generation:{algorithm:"r06_loft_boxes"}}));
    let report=get(broken,"report.json"),receipt=get(broken,"viewer-proof.json");
    receipt.model_sha256=await digest(broken[key(broken,"model.fgm.json")]);
    report.package_bytes_sha256=receipt.model_sha256;
    broken=put(broken,"report.json",encode(report));
    receipt.report_sha256=await digest(broken[key(broken,"report.json")]);
    broken=put(broken,"viewer-proof.json",encode(receipt));
    await load(broken,false,"E_RV01_FGM_ENVELOPE");

    const invalidLoft=get(slab,"loft.json");
    invalidLoft.schema="invalid";
    broken=put(slab,"loft.json",encode(invalidLoft));
    report=get(broken,"report.json");receipt=get(broken,"viewer-proof.json");
    receipt.source_loft_sha256=await digest(broken[key(broken,"loft.json")]);
    report.input_sha256.loft_json=receipt.source_loft_sha256;
    broken=put(broken,"report.json",encode(report));
    receipt.report_sha256=await digest(broken[key(broken,"report.json")]);
    broken=put(broken,"viewer-proof.json",encode(receipt));
    await load(broken,false,"E_RV01_LOFT_LAYOUT");

    const r07=slice("fixtures/r07/");
    let manifest=get(r07,"viewer-session.json");
    const pgm=r07[key(r07,"front.pgm")].slice();
    const pos="P5\n96 32\n255\n".length;
    pgm[pos]=pgm[pos]===255?0:255;
    broken=put(r07,"front.pgm",pgm);
    manifest.observation_sha256["front.pgm"]=await digest(pgm);
    broken=put(broken,"viewer-session.json",encode(manifest));
    await load(broken,false,"E_RV01_R07_PACKAGE_MISMATCH");

    // P1-04: SHA манифеста пересчитан, FGM, OBJ, report и эталон
    // не меняются. Второй и третий участки PGM должны отклоняться.
    for(const [name,offset] of [["baseline",32],["reconstructed",64]]){
      document.body.dataset.rv01Stage="negative-r07-front-"+name;
      manifest=get(r07,"viewer-session.json");
      const forged=r07[key(r07,"front.pgm")].slice();
      forged[pos+offset]=forged[pos+offset]===255?0:255;
      broken=put(r07,"front.pgm",forged);
      manifest.observation_sha256["front.pgm"]=await digest(forged);
      broken=put(broken,"viewer-session.json",encode(manifest));
      await load(broken,false,"E_RV01_R07_FRONT_SILHOUETTE");
    }

    manifest=get(r07,"viewer-session.json");
    const pack=get(r07,"baseline.fgm.json");
    pack.generation.parameters.opening_steps=[-2,8,8];
    broken=put(r07,"baseline.fgm.json",encode(pack));
    manifest.models.find(x=>x.role==="baseline").sha256=
      await digest(broken[key(broken,"baseline.fgm.json")]);
    broken=put(broken,"viewer-session.json",encode(manifest));
    await load(broken,false,"E_RV01_R07_PACKAGE_MISMATCH");

    manifest=get(r07,"viewer-session.json");
    const lines=decoder.decode(r07[key(r07,"baseline.obj")]).split("\n");
    const v=lines.findIndex(x=>x.startsWith("v "));
    const xyz=lines[v].split(" ");
    xyz[1]=String(Number(xyz[1])+.125);lines[v]=xyz.join(" ");
    broken=put(r07,"baseline.obj",encoder.encode(lines.join("\n")));
    manifest.models.find(x=>x.role==="baseline").mesh_sha256=
      await digest(broken[key(broken,"baseline.obj")]);
    broken=put(broken,"viewer-session.json",encode(manifest));
    await load(broken,false,"E_RV01_R07_MESH_MISMATCH");

    document.body.dataset.rv01Smoke="PASS";
  } catch(error) {document.body.dataset.rv01Smoke="FAIL "+error.message;}
})();