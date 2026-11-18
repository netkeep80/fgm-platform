import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,readFile,writeFile} from "node:fs/promises";

const directory = "build/v03-map";
const binary = process.argv[2] || directory + "/verify";
const compiled = ["src/v03-camera.cpp","src/v03-map-camera.cpp","tests/v03-map-camera.test.cpp"];
const sources = [...compiled,"src/v03-camera.hpp","src/v03-map-camera.hpp","scripts/test-v03-map.mjs"];
await mkdir(directory,{recursive:true});
if(!process.argv[2]) execFileSync("g++",["-std=c++20","-O2","-Wall","-Wextra","-Werror","-pedantic",
  ...compiled,"-o",binary],{stdio:"inherit"});
const run = () => execFileSync(binary,[],{stdio:["ignore","pipe","inherit"]});
const first = run();
assert.deepEqual(run(),first,"два запуска карты должны совпадать побайтово");
const result = JSON.parse(first);
assert.deepEqual(result,{
  schema:"fgmv-v03-map-camera/1",ok:true,inverse_samples:294912,r05_samples:73728,
  orientations:4,edge_reframes:32,negative_tests:10,fractional_seams:285,precision_samples:456,
  origin_goldens:[[16,20],[63,35.5],[32,59],[-15,43.5]],
});

const hash = data => createHash("sha256").update(data).digest("hex");
const inputs = Object.fromEntries(await Promise.all(sources.map(async name => [
  name,hash(await readFile(name)),
])));
await writeFile(directory + "/report.json",JSON.stringify({
  ...result,reproducible:true,output_sha256:hash(first),input_sha256:inputs,
},null,2)+"\n");
console.log("V03_MAP_CAMERA_PASS: 294912 inverse samples, 73728 R05 samples, 773 boundary cases");
