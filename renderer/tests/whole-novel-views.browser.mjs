import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright';
import {ASSETS,MANIFEST} from './studio-pages.live.mjs';
import {localBrowserContext} from './local-browser.mjs';
import {compare} from './whole-view-oracle.mjs';
const root=resolve(process.argv[2]??'build/pages-studio');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=new Map(await Promise.all([...ASSETS,MANIFEST].map(async n=>['/'+n,await readFile(join(root,n))])));
const server=createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(name==='/favicon.ico'){res.writeHead(204).end();return}
  const bytes=files.get(name==='/'?'/index.html':name);
  if(req.method!=='GET'||!bytes){res.writeHead(404).end();return}
  res.writeHead(200,{'Content-Type':({'.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.html':'text/html'})[extname(name==='/'?'/index.html':name)],'Cache-Control':'no-store'}).end(bytes);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.FGM_CHROMIUM,
  args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const network=await localBrowserContext(browser),page=await network.context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const voxels=[];
// An asymmetric 4-cell ring with a through-hole and vertical occluder; no original data.
for(let x=14;x<=17;x++)for(let y=14;y<=17;y++){
  if(x>=15&&x<=16&&y>=15&&y<=16)continue;
  voxels.push([x,y,3]);
}
for(let z=4;z<=8;z++)voxels.push([14,14,z]);
voxels.push([17,15,4],[17,15,5],[17,16,4]);
// Object-local geometry crosses the origin and cell seams; the world anchor is independent.
for(const v of voxels){v[0]-=16;v[1]-=16;v[2]-=3}
const parts=['floor','west_wall','north_wall','object'],groups=new Map();
for(const v of voxels){const tile=[Math.floor((v[0]+16)/16),Math.floor((v[1]+16)/16),0],key=tile.join(',');
  if(!groups.has(key))groups.set(key,{tile,points:[]});groups.get(key).points.push(v);}
const receipt={schema:'fgm-regenerator/verified-membership-input-v1',status:'verified_explicit_membership',
  instance:'целый объект 🛰',prototype:'synthetic',provenance:{kind:'synthetic-test'},anchor_xyz:[1,1,0],cell_bindings:[]};
const lofts=[...groups.values()].sort((a,b)=>a.tile[0]-b.tile[0]||a.tile[1]-b.tile[1]).map(({tile,points},i)=>{
  receipt.cell_bindings.push({xyz:tile,local_xyz:[tile[0]-1,tile[1]-1,0],part:'object',dataset:'SYNTH',record:1,map_record:i});
  const rows=parts.map(()=>Array.from({length:24},()=>Array(16).fill(0)));
  for(const [x,y,z] of points)rows[3][z][(y+16)%16]|=1<<(15-(x+16)%16);
  return Buffer.from(JSON.stringify({schema:'fgm-regenerator/loft-terrain-v1',voxel_dimensions_xyz:[16,16,24],terrain_only:true,
    tile:{xyz:tile,record_index:i},part_rows:rows,sources:parts.map(part=>part==='object'
      ?{part,present:true,source_index:2,dataset_label:'SYNTH',local_index:1,loft_ids:Array(12).fill(0)}
      :{part,present:false,source_index:0})}));
});
const input=()=>[Buffer.from(JSON.stringify(receipt)),...lofts];
const upload=async()=>{
  const bytes=input();
  await page.locator('#whole-files').setInputFiles(bytes.map((buffer,i)=>({name:i?'loft-'+(i-1)+'.json':'receipt.json',mimeType:'application/json',buffer})));
  await page.waitForFunction(()=>document.querySelector('#whole-status').dataset.state==='READY'&&
    !document.querySelector('#whole-run').disabled,null,{timeout:60000});
  await page.locator('#whole-expected').fill(JSON.stringify({receipt:sha(bytes[0]),lofts:bytes.slice(1).map(sha)}));
};
const run=async()=>{await page.locator('#whole-run').click();await page.waitForFunction(()=>['COMPLETED','ERROR'].includes(document.querySelector('#whole-status').dataset.state),null,{timeout:90000});};
try{
  await page.addInitScript(()=>{
    const original=GPUBuffer.prototype.mapAsync;
    window.__gateView=false;window.__viewGated=false;
    GPUBuffer.prototype.mapAsync=async function(...args){
      await original.apply(this,args);
      if(window.__gateView){window.__gateView=false;window.__viewGated=true;
        await new Promise(r=>window.__releaseView=r);}
    };
    const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
    const createDevice=GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice=async function(...args){
      const device=await createDevice.apply(this,args);window.__lastDevice=device;return device;
    };
    window.__gateCreate=false;window.__createGated=false;window.__staleDisposed=false;
    navigator.gpu.requestAdapter=async function(...args){
      const adapter=await requestAdapter(...args);
      if(window.__gateCreate){
        window.__gateCreate=false;window.__createGated=true;
        const requestDevice=adapter.requestDevice.bind(adapter);
        adapter.requestDevice=async function(...deviceArgs){
          const device=await requestDevice(...deviceArgs),destroy=device.destroy.bind(device);
          device.destroy=()=>{destroy();window.__staleDisposed=true};
          return device;
        };
        await new Promise(r=>window.__releaseCreate=r);
      }
      return adapter;
    };
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await upload();await run();
  assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  const result=JSON.parse(await page.locator('#whole-view-receipt').textContent());
  assert.equal(result.schema,'fgmv-whole-novel-views/1');
  assert.equal(result.backend,'webgpu');assert.equal(result.stage_a,'NOT_ACCEPTED');
  assert.equal(result.private_acceptance,'PENDING');assert.equal(result.c05.checked_centers,24576);
  assert.equal(result.membership.sha256,sha(input()[0]));
  assert.equal(result.membership.status,'CONDITIONAL_ON_B1_WITNESS');
  assert.equal(result.membership.instance,'целый объект 🛰');
  assert.deepEqual(Object.keys(result.evidence),['OBSERVED','INFERRED','UNKNOWN','UNRESOLVED']);
  assert.equal(result.views.length,4);
  const frames=await page.locator('#whole-views canvas').evaluateAll(canvases=>canvases.map(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)));
  assert.equal(frames.length,4);
  const stats=[];let invertedDepthErrors=0;
  for(let i=0;i<4;i++){
    const v=result.views[i];assert.equal(v.model_sha256,result.model_sha256);assert.equal(v.mesh_sha256,result.mesh_sha256);
    assert.deepEqual(v.view.camera,{kind:'orbit-3d',yaw:.35+i*Math.PI/2,pitch:.6,distance:1,focusWorld:{x:0,y:0,z:0}});
    assert.equal(sha(Buffer.from(frames[i])),v.rgba_sha256);
    const checked=compare(frames[i],voxels,v.view.camera);
    assert.equal(checked.bad,0,JSON.stringify({i,...checked}));
    assert.ok(checked.checked>10000&&checked.foreground>300&&checked.background>300,JSON.stringify(checked));
    stats.push(checked);
    invertedDepthErrors+=compare(frames[i],voxels,v.view.camera,420,315,"farthest").bad;
    assert.ok(compare(frames[i],voxels,{...v.view.camera,yaw:v.view.camera.yaw+.27}).bad>100,'wrong camera escaped oracle');
  }
  assert.ok(invertedDepthErrors>100,"inverted depth escaped oracle");
  assert.equal(new Set(result.views.map(v=>v.rgba_sha256)).size,4,'asymmetric object must have four different views');
  // Independently fill the real through-hole: the resulting wrong geometry MUST differ.
  const filled=[...voxels];for(let x=-1;x<=0;x++)for(let y=-1;y<=0;y++)filled.push([x,y,0]);
  assert.ok(compare(frames[0],filled,result.views[0].view.camera).bad>20,'filled hole escaped oracle');
  console.log('WHOLE_NOVEL_VIEWS_CPU_COMPARISON_PASS',JSON.stringify({stats,invertedDepthErrors}));
  await page.locator('#whole-panel details summary').click();
  const expectedDownload=page.waitForEvent('download');await page.locator('#whole-view-downloads button').click();
  const downloaded=await expectedDownload;assert.equal(downloaded.suggestedFilename(),'novel-views.json');
  assert.deepEqual(JSON.parse(await readFile(await downloaded.path(),'utf8')),result);
  await mkdir('build',{recursive:true});await page.locator('#view').screenshot({path:'build/whole-novel-views.png'});
  // Re-run deterministically: geometry and camera identity stay fixed; same local GPU gives same pixels.
  await run();assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  assert.deepEqual(JSON.parse(await page.locator('#whole-view-receipt').textContent()),result);
  // A re-hashed semantic membership mismatch must be rejected by the actual C++ builder.
  receipt.cell_bindings[0].record=2;await upload();await run();
  assert.match(await page.locator('#whole-status').textContent(),/^ERROR.*E_STUDIO_BUILD$/);
  assert.equal(await page.locator('#whole-views canvas').count(),0);
  assert.equal(await page.locator('#whole-view-receipt').textContent(),'');
  receipt.cell_bindings[0].record=1;await upload();
  // Cancel AFTER real GPU mapAsync has executed; release its delayed completion after reset.
  await page.evaluate(()=>window.__gateView=true);await page.locator('#whole-run').click();
  await page.waitForFunction(()=>window.__viewGated,null,{timeout:60000});
  await page.locator('#whole-cancel').click();await page.evaluate(()=>window.__releaseView());
  await page.waitForTimeout(200);
  assert.match(await page.locator('#whole-status').textContent(),/^CANCELLED/);
  assert.equal(await page.locator('#whole-views canvas').count(),0);
  assert.equal(await page.locator('#whole-view-downloads button').count(),0);
  assert.equal(await page.locator('#whole-view-receipt').textContent(),'');
  await run();assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  assert.equal(await page.locator('#whole-views canvas').count(),4);
  // A canceled factory may finish AFTER a replacement run has published its preview.
  await page.evaluate(()=>window.__gateCreate=true);await page.locator('#whole-run').click();
  await page.waitForFunction(()=>window.__createGated,null,{timeout:60000});
  await page.locator('#whole-cancel').click();await run();
  assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  await page.waitForFunction(()=>{
    const c=document.querySelector('#whole-preview');
    return c.width===840&&c.height===630&&c.getContext('2d').getImageData(0,0,1,1).data[3]===255;
  },null,{timeout:60000});
  const previewPixels=()=>page.locator('#whole-preview').evaluate(c=>
    Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
  const currentPreview=sha(Buffer.from(await previewPixels()));
  const currentReceipt=await page.locator('#whole-view-receipt').textContent();
  await page.evaluate(()=>window.__replacementDevice=window.__lastDevice);
  await page.evaluate(()=>window.__releaseCreate());
  await page.waitForFunction(()=>window.__staleDisposed,null,{timeout:60000});
  assert.equal(sha(Buffer.from(await previewPixels())),currentPreview,'canceled factory cleared the new preview');
  assert.equal(await page.locator('#whole-view-receipt').textContent(),currentReceipt);
  assert.equal(await page.locator('#whole-views canvas').count(),4);
  // Current asynchronous device loss must still clear the actual displayed preview.
  await page.evaluate(async()=>{window.__replacementDevice.destroy();await window.__replacementDevice.lost});
  assert.ok((await previewPixels()).every((n,i)=>i%4!==3||n===0),'lost current device retained visible pixels');
  // A device-less client keeps its validated FGM/OBJ/C05 and gets no asserted view proof.
  await page.evaluate(()=>navigator.gpu.requestAdapter=async()=>null);
  await run();assert.match(await page.locator('#whole-status').textContent(),/^COMPLETED/);
  assert.match(await page.locator('#whole-view-status').textContent(),/WebGPU недоступен/);
  assert.equal(await page.locator('#whole-downloads button').count(),5);
  assert.equal(await page.locator('#whole-views canvas').count(),0);
  assert.equal(await page.locator('#whole-view-receipt').textContent(),'');
  assert.deepEqual(errors,[]);network.assertLocal();
  console.log('WHOLE_NOVEL_VIEWS_CPU_ORACLE_PASS',JSON.stringify({stats,invertedDepthErrors,cells:4,c05:24576,wrongCameras:4,filledHole:'REJECTED',membership:'REJECTED',gpuCancel:'STALE_DISCARDED',pendingFactoryCancel:'NEW_PREVIEW_PRESERVED',currentDeviceLoss:'DISPLAY_CLEARED',unicodeIdentity:'PRESERVED',stageA:'NOT_ACCEPTED'}));
}finally{await browser.close();await new Promise(r=>server.close(r));}
