import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright';
import {ASSETS,MANIFEST} from './studio-pages.live.mjs';
import {localBrowserContext} from './local-browser.mjs';
import {compareBoxes} from './whole-view-oracle.mjs';
const root=resolve(process.argv[2]??'build/pages-studio');
const native=resolve(process.argv[3]??'../build/gpu/regenerator');
const temp=await mkdtemp(join(tmpdir(),'r07-fitted-browser-')),fixture=join(temp,'input');
const python=process.env.PYTHON??'python3';
const generated=spawnSync(python,[resolve('../regenerator/tests/test_r07_fitted_surface.py'),
  join(native,'fgmr-studio-native'),join(native,'fgmr-r07-whole-surface'),'--fixtures',fixture],
  {encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});
assert.equal(generated.status,0,generated.stderr+generated.stdout);
const expected=JSON.parse(await readFile(join(fixture,'expected.json'),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const files=new Map(await Promise.all([...ASSETS,MANIFEST].map(async n=>['/'+n,await readFile(join(root,n))])));
const server=createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/favicon.ico'){res.writeHead(204).end();return}
  const key=name==='/'?'/index.html':name,bytes=files.get(key);
  if(req.method!=='GET'||!bytes){res.writeHead(404).end();return}
  res.writeHead(200,{'Content-Type':({'.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.html':'text/html'})[extname(key)],'Cache-Control':'no-store'}).end(bytes);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.FGM_CHROMIUM,
  args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const network=await localBrowserContext(browser),page=await network.context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const run=async()=>{await page.locator('#whole-run').click();await page.waitForFunction(()=>
  ['COMPLETED','ERROR'].includes(document.querySelector('#whole-status').dataset.state),null,{timeout:90000});};
const receipt=async()=>JSON.parse(await page.locator('#whole-view-receipt').textContent());
const ready=()=>page.waitForFunction(()=>document.querySelector('#whole-status').dataset.state==='READY',null,{timeout:60000});
const importFit=async bytes=>{
  await page.locator('#whole-fit').setInputFiles({name:'fit-preview.json',mimeType:'application/json',buffer:bytes});
  await ready();await page.locator('#whole-fit-expected').fill(sha(bytes));
};
try{
  await page.addInitScript(()=>{
    const original=GPUBuffer.prototype.mapAsync;
    GPUBuffer.prototype.mapAsync=async function(...args){
      await original.apply(this,args);
      if(window.__holdFrame){window.__holdFrame=false;window.__frameHeld=true;await new Promise(r=>window.__releaseFrame=r);}
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#whole-files').setInputFiles(['receipt.json','loft-0.json','loft-1.json'].map(n=>join(fixture,n)));
  await ready();
  const sums=await Promise.all(['receipt.json','loft-0.json','loft-1.json'].map(async n=>sha(await readFile(join(fixture,n)))));
  await page.locator('#whole-expected').fill(JSON.stringify({receipt:sums[0],lofts:sums.slice(1)}));
  await run();assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  const baseline=await receipt();assert.equal(baseline.model_sha256,expected.baseline_sha256);
  const fitted=await readFile(join(fixture,'fit-preview.json'));
  await importFit(fitted);await run();
  assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED.*native R07/);
  const result=await receipt();
  assert.equal(result.model_sha256,expected.model_sha256);assert.equal(result.mesh_sha256,expected.mesh_sha256);
  assert.notEqual(result.mesh_sha256,baseline.mesh_sha256);assert.notEqual(result.model_sha256,baseline.model_sha256);
  assert.equal(result.fit.input_sha256,sha(fitted));assert.equal(result.fit.baseline_mesh_sha256,expected.baseline_mesh_sha256);
  assert.deepEqual(result.fit.before,expected.before);assert.deepEqual(result.fit.after,expected.after);
  assert.equal(result.c05.checked_centers,12288);assert.equal(result.fit.strict_iou_improvement,true);
  assert.equal(result.stage_a,'NOT_ACCEPTED');assert.equal(result.private_acceptance,'PENDING');
  assert.equal(result.fit.source_attestation,'NOT_INDEPENDENTLY_VERIFIED');
  assert.equal(await page.locator('#whole-fit-observations canvas').count(),6);
  const metrics=JSON.parse(await page.locator('#whole-metrics').textContent());
  assert.deepEqual(metrics.before,expected.before);assert.deepEqual(metrics.after,expected.after);
  assert.deepEqual(Object.keys(metrics).filter(k=>['OBSERVED','INFERRED','UNKNOWN','UNRESOLVED'].includes(k)),['OBSERVED','INFERRED','UNKNOWN','UNRESOLVED']);
  const frames=await page.locator('#whole-views canvas').evaluateAll(cs=>cs.map(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)));
  const stats=[];let oldMeshErrors=0,filledHoleErrors=0;
  for(let i=0;i<4;i++){
    const v=result.views[i];
    assert.equal(v.model_sha256,expected.model_sha256);assert.equal(v.mesh_sha256,expected.mesh_sha256);
    assert.deepEqual(v.view.camera,{kind:'orbit-3d',yaw:.35+i*Math.PI/2,pitch:.6,distance:1,focusWorld:{x:0,y:0,z:0}});
    assert.equal(v.rgba_sha256,sha(Buffer.from(frames[i])));
    const checked=compareBoxes(frames[i],expected.boxes,v.view.camera);
    assert.equal(checked.bad,0,JSON.stringify({i,...checked}));assert.ok(checked.checked>13000&&checked.foreground>500);
    stats.push(checked);
    oldMeshErrors+=compareBoxes(frames[i],expected.baseline_boxes,v.view.camera).bad;
    filledHoleErrors+=compareBoxes(frames[i],[...expected.boxes,[[14.49,6.49,5.51],[17.51,9.51,10.49]]],v.view.camera).bad;
    assert.ok(compareBoxes(frames[i],expected.boxes,{...v.view.camera,yaw:v.view.camera.yaw+.27}).bad>100,'wrong camera escaped');
  }
  assert.ok(oldMeshErrors>100&&filledHoleErrors>100,JSON.stringify({oldMeshErrors,filledHoleErrors}));
  assert.equal(new Set(result.views.map(v=>v.rgba_sha256)).size,4);
  // The downloaded mesh bytes are the same native/WASM-derived geometry shown by the renderer.
  for(const [name,digest] of [['model.fgm.json',expected.model_sha256],['preview.obj',expected.mesh_sha256]]){
    const pending=page.waitForEvent('download');await page.locator('#whole-downloads').getByRole('button',{name,exact:true}).click();
    const download=await pending;assert.equal(sha(await readFile(await download.path())),digest);
  }
  await mkdir('build',{recursive:true});await page.locator('#view').screenshot({path:'build/r07-fitted-surface.png'});
  // Wrong independent digest cannot reach the worker result; old frames are removed.
  await page.locator('#whole-fit-expected').fill('0'.repeat(64));await run();
  assert.match(await page.locator('#whole-status').textContent(),/^ERROR.*E_WHOLE_FIT_DIGEST/);
  assert.equal(await page.locator('#whole-views canvas').count(),0);
  const bad=JSON.parse(fitted);bad.membership_sha256='0'.repeat(64);
  await importFit(Buffer.from(JSON.stringify(bad)));await run();
  assert.match(await page.locator('#whole-status').textContent(),/^ERROR.*E_FIT_MEMBERSHIP/);
  assert.equal(await page.locator('#whole-view-receipt').textContent(),'');
  // Cancel a real fitted GPU readback, replace inputs, then release the old response.
  await importFit(fitted);await page.evaluate(()=>window.__holdFrame=true);
  await page.locator('#whole-run').click();await page.waitForFunction(()=>window.__frameHeld,null,{timeout:90000});
  await page.locator('#whole-cancel').click();await page.evaluate(()=>window.__releaseFrame());
  await page.waitForTimeout(100);
  assert.match(await page.locator('#whole-status').textContent(),/^CANCELLED/);
  assert.equal(await page.locator('#whole-views canvas').count(),0);
  assert.equal(await page.locator('#whole-downloads button').count(),0);
  await run();assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  assert.deepEqual(await receipt(),result);
  assert.deepEqual(errors,[]);network.assertLocal();
  console.log('R07_FITTED_SURFACE_WASM_WEBGPU_PASS',JSON.stringify({stats,oldMeshErrors,filledHoleErrors,
    c05:12288,before:expected.before.micro,after:expected.after.micro,shaBinding:'native_WASM_download_PARITY',
    cancellation:'STALE_DISCARDED',stageA:'NOT_ACCEPTED',privateAcceptance:'PENDING'}));
}finally{await browser.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
