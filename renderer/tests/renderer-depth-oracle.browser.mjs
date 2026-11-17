/** S3-S2F: independent CPU ray/triangle reference versus actual RendererSession WebGPU.
 * Entirely original synthetic OBJ fixtures; not a second FGM/LOFT interpreter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const W=256,H=256;
const BG=[16,27,43],NEAR=[102,140,156],FAR=[81,116,133];
const PREDICATE_EPS=1e-8, EDGE_MARGIN=0.045;
const triangle=(a,b,c)=>[a,b,c];
function rect(x0,y0,x1,y1,z){
  const a=[x0,y0,z], b=[x1,y0,z], c=[x1,y1,z], d=[x0,y1,z];
  return [triangle(a,b,c),triangle(a,c,d)];
}
const far=()=>rect(-1,-1,1,1,-1);
const ring=()=>[
  ...rect(-1,-1,-.35,1,1),...rect(.35,-1,1,1,1),
  ...rect(-.35,-1,.35,-.35,1),...rect(-.35,.35,.35,1,1)
];
const shaped=[
  {name:'hole-far-last',faces:[...ring(),...far()],turns:0,translation:[0,0],focus:[0,0]},
  {name:'hole-near-last',faces:[...far(),...ring()],turns:0,translation:[0,0],focus:[0,0]},
  {name:'sloping-crossing',faces:[...far(),
    triangle([-.85,-.75,.15],[.85,-.75,1.25],[0,.85,1.15])],turns:0,translation:[0,0],focus:[0,0]},
  {name:'concave-rotated-translated',faces:[...far(),...rect(-1,-1,-.25,1,1),
    ...rect(-.25,-1,1,-.25,1)],turns:1,translation:[3,-2],focus:[3,-2]}
];
function rot([x,y],turns){
  if(turns===1)return [-y,x];if(turns===2)return [-x,-y];
  if(turns===3)return [y,-x];return [x,y];
}
/** Independent orthographic ray depth intersection in WORLD XY; nearest = largest world Z.
 * No reliance on the production GPU pipeline, shader, z normalization, or painter sort.
 */
function rayTriangle(x,y,t){
  const [a,b,c]=t; const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1];
  const den=ux*vy-uy*vx;
  if(Math.abs(den)<PREDICATE_EPS)return null;
  const px=x-a[0],py=y-a[1];
  const v=(px*vy-py*vx)/den, w=(ux*py-uy*px)/den,u=1-v-w;
  if(Math.min(u,v,w)<-PREDICATE_EPS)return null;
  return {z:u*a[2]+v*b[2]+w*c[2], margin:Math.min(u,v,w),
    color:(a[2]+b[2]+c[2])>0?NEAR:FAR};
}
function oracleAt(fixture,px,py,depthMode='nearest',mutatedFaces=null){
  // Calibrated fixed top-down camera: yaw=0, pitch=pi/2, distance=.5,
  // outer reference square [-1,1]^2 => screen scale 0.4*min(W,H).
  // World-ray coordinates are computed independently from this camera contract.
  const worldX=(px+.5-W/2)/(.4*W)+fixture.focus[0];
  const worldY=(py+.5-H/2)/(.4*H)+fixture.focus[1];
  let best=null,edge=false;
  for(const tri of mutatedFaces??fixture.faces){
    const transformed=tri.map(([x,y,z])=>{
      const [rx,ry]=rot([x,y],fixture.turns);
      return [rx+fixture.translation[0],ry+fixture.translation[1],z];
    });
    const hit=rayTriangle(worldX,worldY,transformed);
    if(!hit)continue;
    if(hit.margin<EDGE_MARGIN)edge=true;
    if(!best || (depthMode==='nearest'?hit.z>best.z:depthMode==='farthest'?hit.z<best.z:true))
      best=hit;
  }
  return {color:best?.color??BG,edge};
}
function samples(){
  const points=[];
  for(let y=18;y<H-18;y+=7)for(let x=18;x<W-18;x+=7)points.push([x,y]);
  return points;
}
const pointList=samples();
function objSource(faces){
  const vertices=[],indices=[];
  for(const tri of faces){const start=vertices.length+1;vertices.push(...tri);indices.push([start,start+1,start+2]);}
  return vertices.map(v=>'v '+v.join(' ')).join('\n')+'\n'+indices.map(i=>'f '+i.join(' ')).join('\n')+'\n';
}
function misses(fixture,pixels,mode='nearest',mutatedFaces=null){
  let compared=0,bad=0;
  for(let i=0;i<pointList.length;i++){
    const [x,y]=pointList[i], ref=oracleAt(fixture,x,y,mode,mutatedFaces);
    if(ref.edge)continue;
    const actual=pixels[i];compared++;
    if(actual.length<4||actual[3]!==255||actual.slice(0,3).some((v,j)=>Math.abs(v-ref.color[j])>1))bad++;
  }
  return {compared,bad};
}
const runtime=readFileSync('build/renderer-session-runtime/runtime/renderer-session-v1.js');
const files=new Map([['/',Buffer.from('<!doctype html><html><body><canvas id="frame" width="256" height="256"></canvas></body></html>')],['/runtime.js',runtime]]);
const server=createServer((req,res)=>{
  const body=files.get(req.url??'');
  if(req.method!=='GET'||!body){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':req.url==='/runtime.js'?'text/javascript':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.FGM_CHROMIUM?undefined:'chromium',
    executablePath:process.env.FGM_CHROMIUM,args:['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  await test('S3-S2F: WebGPU depth/holes against independent CPU ray oracle', {timeout:90000},async()=>{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const stats=[];
    for(const fixture of shaped){
      const pixels=await page.evaluate(async ({obj,pointList,fixture})=>{
        const {createRendererSessionV1}=await import('/runtime.js');
        const text=new TextEncoder();
        const source=text.encode(JSON.stringify({format:'fgm-package/1',origin:'original-synthetic-test',name:fixture.name}));
        const mesh=text.encode(obj);
        const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
          .map(x=>x.toString(16).padStart(2,'0')).join('');
        const sourceSha=await sha(source),meshSha=await sha(mesh),ZERO='0'.repeat(64);
        const canvas=document.querySelector('#frame');
        const session=await createRendererSessionV1({canvas,preferredBackend:'webgpu',fallbackPolicy:'reject'});
        if(session.capabilities.backendKind!=='webgpu')throw Error('E_ORACLE_GPU_UNAVAILABLE');
        const request={snapshot:{schema:'fgmv-scene-snapshot/1',revision:fixture.name,
          models:[{key:'original-synthetic',package:{format:'fgm-package/1',packageSha256:sourceSha,byteLength:source.byteLength}}],
          instances:[{instanceId:'test',modelKey:'original-synthetic',stateRevision:'static',
            placement:{translation:{x:fixture.translation[0],y:fixture.translation[1],z:0},
              quarterTurnsZ:fixture.turns,units:'fgm-voxel'}}]},
          packages:[{modelKey:'original-synthetic',bytes:source}],geometries:[{geometry:{
            schema:'fgmv-derived-geometry/1',sourcePackageSha256:sourceSha,meshSha256:meshSha,meshFormat:'obj/1',
            recipe:{schema:'fgmv-geometry-recipe/1',algorithmId:'test-independent-oracle',algorithmVersion:'1',
              parametersSha256:ZERO,deterministicSeed:'fixed',detailDepth:0}},bytes:mesh}]};
        const scene=await session.loadScene(request);
        const view=session.setView({schema:'fgmv-view-state/1',revision:'top-down-oracle',
          camera:{kind:'orbit-3d',yaw:0,pitch:Math.PI/2,distance:.5,
            focusWorld:{x:fixture.focus[0],y:fixture.focus[1],z:0}},
          viewport:{width:256,height:256,pixelRatio:1},showCellGrid:false});
        const outcome=await session.renderFrame({expectedSceneRevision:scene.sceneRevision,
          expectedViewRevision:view.viewRevision,sessionEpoch:view.sessionEpoch});
        if(outcome.status!=='rendered')throw Error('E_ORACLE_RENDER:'+JSON.stringify(outcome));
        const context=canvas.getContext('2d'),read=context.getImageData(0,0,256,256);
        const result=pointList.map(([x,y])=>Array.from(read.data.slice((y*256+x)*4,(y*256+x)*4+4)));
        await session.dispose();return result;
      },{obj:objSource(fixture.faces),pointList,fixture});
      const actual=misses(fixture,pixels);
      assert.ok(actual.compared>=500,fixture.name+' insufficient stable coverage '+JSON.stringify(actual));
      assert.equal(actual.bad,0,fixture.name+' GPU vs independent CPU ray oracle mismatch');
      stats.push({case:fixture.name,...actual});
      if(fixture.name==='hole-far-last'){
        // Deliberately broken reference modes MUST distinguish incorrect depth / fake hole fill.
        const reverse=misses(fixture,pixels,'farthest');
        assert.ok(reverse.bad>=150,'inverted depth mutation escaped oracle');
        const filled=[...fixture.faces,...rect(-.35,-.35,.35,.35,1)];
        const hole=misses(fixture,pixels,'nearest',filled);
        assert.ok(hole.bad>=30,'filled-hole mutation escaped oracle');
        const painter=misses(fixture,pixels,'last');
        assert.ok(painter.bad>=150,'painter-order mutation escaped oracle');
      }
    }
    assert.deepEqual(errors,[],'uncaught browser errors');
    console.log('RENDERER_S3_S2F_INDEPENDENT_DEPTH_ORACLE_PASS',JSON.stringify({stats:stats,
      mutants:['inverted-depth','filled-hole','painter-overwrite']}));
    await page.close();
  });
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}