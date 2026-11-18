import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";

await mkdir("build/v03",{recursive:true});
const binary=process.argv[2]||"build/v03/v03-verify";
if(!process.argv[2]) execFileSync("g++",[
  "-std=c++20","-O2","-Wall","-Wextra","-Werror","-pedantic",
  "src/v03-camera.cpp","tests/v03-camera.test.cpp","-o","build/v03/v03-verify",
],{stdio:"inherit"});
const run=()=>execFileSync(binary,[],{
  encoding:"utf8",stdio:["ignore","pipe","inherit"],
});
const a=run(),b=run();
assert.equal(a,b,"два запуска камеры на одной платформе должны совпадать побайтово");
const result=JSON.parse(a);
assert.equal(result.schema,"fgmv-v03-camera/1");
assert.equal(result.ok,true);
assert.equal(result.r05_samples,24576);
assert.equal(result.inverse_checks,24576);
assert.equal(result.four_turn_orbits,6144);
assert.equal(result.negative_tests,10);
const hash=data=>createHash("sha256").update(data).digest("hex");
const sources=["src/v03-camera.hpp","src/v03-camera.cpp","tests/v03-camera.test.cpp"];
const inputs=Object.fromEntries(await Promise.all(sources.map(async name=>[
  name,hash(await readFile(name)),
])));
const report={...result,reproducible:true,output_sha256:hash(a),input_sha256:inputs};
await writeFile("build/v03/report.json",JSON.stringify(report,null,2)+"\n");
console.log("V03_CAMERA_PASS: R05 24576 full-tile samples, four exact rotations, 24576 inverse checks, 10 negative cases");
