// RV01: управление локальным headless Chromium по CDP в обычном времени.
// Не использовать ускоренный virtual-time для асинхронного File API.
import {spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import {setTimeout as sleep} from "node:timers/promises";

const [browser, fileURL, profile, mode = "rv01"] = process.argv.slice(2);
const studio = mode === "studio";
if (!browser || !profile || !(studio ? /^http:\/\/127\.0\.0\.1:\d+\/$/.test(fileURL ?? "")
                                    : mode === "rv01" && fileURL?.startsWith("file://"))) {
  process.stderr.write("RV01_CDP_ARGS\n"); process.exit(2);
}
const args=[
  "--headless=new","--no-sandbox","--disable-dev-shm-usage",
  "--no-first-run","--no-default-browser-check","--disable-background-networking",
  "--disable-gpu-sandbox","--use-gl=angle","--use-angle=swiftshader",
  "--enable-webgl","--enable-unsafe-swiftshader",
  "--remote-debugging-port=0","--remote-allow-origins=*",
  "--user-data-dir="+profile,"about:blank"
];
const child=spawn(browser,args,{stdio:["ignore","ignore","pipe"]});
let stderr="";
child.stderr.on("data",chunk=>{stderr=(stderr+String(chunk)).slice(-1800);});
let ws=null;
const pending=new Map();
let id=0;
function call(method,params={}){
  return new Promise((resolve,reject)=>{
    const num=++id;
    const timer=setTimeout(()=>{pending.delete(num);reject(Error("CDP_TIMEOUT "+method));},12000);
    pending.set(num,{resolve:r=>{clearTimeout(timer);resolve(r);},
                      reject:e=>{clearTimeout(timer);reject(e);}});
    ws.send(JSON.stringify({id:num,method,params}));
  });
}
try{
  let port=null;
  for(let n=0;n<150;n++){
    try{
      const raw=await readFile(profile+"/DevToolsActivePort","utf8");
      port=Number(raw.split(/\r?\n/)[0]);
      if(Number.isInteger(port)&&port>0)break;
    }catch{}
    if(child.exitCode!==null)throw Error("Chromium завершился раньше запуска CDP");
    await sleep(120);
  }
  if(!port)throw Error("RV01_CDP_PORT_TIMEOUT");
  const response=await fetch("http://127.0.0.1:"+port+"/json");
  if(!response.ok)throw Error("RV01_CDP_HTTP_"+response.status);
  const targets=await response.json();
  const page=targets.find(t=>t.type==="page"&&t.webSocketDebuggerUrl);
  if(!page)throw Error("RV01_CDP_PAGE_MISSING");
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    ws.addEventListener("open",resolve,{once:true});
    ws.addEventListener("error",reject,{once:true});
  });
  ws.addEventListener("message",event=>{
    let msg;
    try{msg=JSON.parse(String(event.data));}catch{return;}
    if(!msg.id||!pending.has(msg.id))return;
    const p=pending.get(msg.id);pending.delete(msg.id);
    if(msg.error)p.reject(Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  });
  await call("Page.enable");
  await call("Runtime.enable");
  const navigation=await call("Page.navigate",{url:fileURL});
  if(navigation.errorText)throw Error("RV01_NAVIGATE: "+navigation.errorText);
  const expression=studio ? '({done:document.body?.dataset.studioSmoke||""})'
    : '({done:document.body?.dataset.rv01Smoke||"",stage:document.body?.dataset.rv01Stage||"",loader:window.__rv01LoadStage||""})';
  const start=Date.now();
  let state=null;
  while(Date.now()-start<105000){
    const response=await call("Runtime.evaluate",{expression,returnByValue:true});
    if(response.result?.value){
      state=response.result.value;
      if(state.done)break;
    }
    await sleep(200);
  }
  if(state?.done==="PASS"){
    process.stdout.write((studio?"STUDIO_S1_BROWSER_PASS: ":"RV01_BROWSER_PASS: ")+JSON.stringify(state)+"\n");
  }else{
    process.stderr.write("RV01_BROWSER_FAIL: "+JSON.stringify(state)+"\n");
    process.exitCode=2;
  }
}catch(error){
  process.stderr.write("RV01_CDP_ERROR: "+String(error?.message||error)+"\n"+stderr.slice(-900)+"\n");
  process.exitCode=2;
}finally{
  for(const p of pending.values())p.reject(Error("CDP shutdown"));
  pending.clear();
  if(ws)ws.close();
  child.kill("SIGKILL");
}
