// Локальная проверка выбранных байтов. Вывод содержит только итог или код.
import { spawnSync } from "node:child_process";
import { closeSync,fstatSync,openSync,readSync } from "node:fs";

const limit=4*1024*1024;
const chunkSize=32768;
const [native,recipe]=process.argv.slice(2);
const command=(action,fields={})=>JSON.stringify({v:1,action,...fields});
function readBounded(path,budget) {
  const descriptor=openSync(path,"r");
  try {
    const stat=fstatSync(descriptor);
    if (!stat.isFile() || stat.size<1 || stat.size>budget) throw Error("E_STUDIO_SMOKE_SIZE");
    const bytes=Buffer.alloc(stat.size);
    let offset=0;
    while (offset<bytes.length) {
      const count=readSync(descriptor,bytes,offset,bytes.length-offset,null);
      if (!count) throw Error("E_STUDIO_SMOKE_IO");
      offset+=count;
    }
    if (readSync(descriptor,Buffer.alloc(1),0,1,null)!==0) throw Error("E_STUDIO_SMOKE_IO");
    return bytes;
  } finally { closeSync(descriptor); }
}
try {
  const {files,spec}=JSON.parse(readBounded(recipe,128*1024).toString("utf8"));
  if (!files || Object.keys(files).length>21 || spec?.algorithm!=="r06-cell/1")
    throw Error("E_STUDIO_SMOKE_RECIPE");
  let remaining=limit;
  const commands=[];
  for (const [file,path] of Object.entries(files)) {
    const bytes=readBounded(path,remaining);
    remaining-=bytes.length;
    for (let offset=0; offset<bytes.length; offset+=chunkSize)
      commands.push(command("append",{file,offset,hex:bytes.subarray(offset,offset+chunkSize).toString("hex")}));
  }
  commands.push(command("start",{spec}),command("step",{runId:1}),command("finalize",{runId:1}));
  const run=spawnSync(native,{input:commands.join("\n")+"\n",encoding:"utf8",timeout:60000,maxBuffer:8*1024*1024});
  if (run.status!==0 || run.stderr) throw Error("E_STUDIO_SMOKE_RUN");
  const rows=run.stdout.trimEnd().split(/\r?\n/).map(line=>JSON.parse(line));
  for (const row of rows)
    if (typeof row.error==="string") throw Error(row.error);
  const result=rows.at(-1)?.result;
  if (!result || rows.at(-1)?.state!=="COMPLETED") throw Error("E_STUDIO_SMOKE_RUN");
  console.log("STUDIO_S1_LOCAL_PASS");
} catch (error) {
  const code=/^E_[A-Z0-9_]{1,60}$/.test(error?.message) ? error.message : "E_STUDIO_SMOKE_RECIPE";
  console.error(code);
  process.exitCode=1;
}
