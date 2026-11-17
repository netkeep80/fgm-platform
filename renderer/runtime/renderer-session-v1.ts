/**
 * RendererSessionV1: общая загрузка проверенной производной геометрии.
 * Ядро Regenerator и авторитетные C04/C05/LOFT этим модулем не исполняются.
 * WebGPU использует буфер глубины, Canvas2D доступен как явный fallback.
 */
import type {
  CreateRendererSessionV1, RendererSessionV1, RendererSessionRequest,
  RendererCapabilitiesV1, SceneLoadRequest, SceneSnapshotV1,
  ViewStateV1, FrameContextV1, FrameOutcomeV1, SceneReceipt, ViewReceipt,
  DerivedGeometryV1, Sha256Hex, WorldXYZ
} from "../contracts/renderer-session-v1";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_.:-]{1,128}$/;
const MAX_SOURCE = 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024;
const MAX_VERTICES = 20000;
const MAX_FACES = 20000;
const DIMENSION = 4096;
const CAPABILITIES: RendererCapabilitiesV1 = Object.freeze({
  schema: "fgmv-renderer-capabilities/1",
  backendKind: "canvas2d-diagnostic",
  backendVersion: "s3-s2b/1",
  supportedCameras: Object.freeze(["orbit-3d"] as const),
  supportsWholeObject: true,
  supportsDeviceRecovery: false
});

type P3 = readonly [number, number, number];
type Mesh = { readonly vertices: readonly P3[]; readonly faces: readonly (readonly number[])[] };
type Loaded = {readonly snapshot: SceneSnapshotV1; readonly mesh: Mesh;
  readonly geometry: DerivedGeometryV1; readonly cacheKey: string};

function fail(code: string): never { throw Error(code); }
function record(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function id(x: unknown): x is string { return typeof x === "string" && ID.test(x); }
function finite(x: unknown): x is number { return typeof x === "number" && Number.isFinite(x); }
function hash(x: unknown): x is Sha256Hex { return typeof x === "string" && HASH.test(x); }
function xyz(p: unknown): p is WorldXYZ { return record(p) && finite(p.x) && finite(p.y) && finite(p.z)
  && Math.abs(p.x) <= 1048576 && Math.abs(p.y) <= 1048576 && Math.abs(p.z) <= 1048576; }
function own<T>(x: T): T { return JSON.parse(JSON.stringify(x)) as T; }

/** Однозначный ключ содержит все параметры построения и digest самих байтов mesh. */
export function geometryCacheKey(geometry: DerivedGeometryV1): string {
  const r = geometry?.recipe;
  if (geometry?.schema !== "fgmv-derived-geometry/1" || !hash(geometry.sourcePackageSha256)
      || !hash(geometry.meshSha256) || geometry.meshFormat !== "obj/1"
      || r?.schema !== "fgmv-geometry-recipe/1" || !id(r.algorithmId)
      || !id(r.algorithmVersion) || !hash(r.parametersSha256)
      || typeof r.deterministicSeed !== "string" || r.deterministicSeed.length > 128
      || !Number.isInteger(r.detailDepth) || r.detailDepth < 0 || r.detailDepth > 16
      || (r.geometryProfileSha256 !== undefined && !hash(r.geometryProfileSha256))) fail("E_SESSION_GEOMETRY");
  return JSON.stringify([geometry.sourcePackageSha256, geometry.meshSha256, geometry.meshFormat,
    r.algorithmId, r.algorithmVersion, r.parametersSha256, r.deterministicSeed,
    r.detailDepth, r.geometryProfileSha256 ?? null]);
}
/**
 * Presentation caches are NOT mesh caches. Instance placement and the binding of
 * cell overlays contribute to scene identity but not to the reusable mesh hash.
 * S3-S2B defines identities only: there is no persistent cache implementation.
 */
export function sceneCacheKey(geometry: DerivedGeometryV1, scene: SceneSnapshotV1): string {
  if (scene?.schema !== "fgmv-scene-snapshot/1" || !id(scene.revision) ||
      !Array.isArray(scene.models) || !Array.isArray(scene.instances) ||
      scene.models.length !== 1 || scene.instances.length !== 1) fail("E_SESSION_SCENE_CACHE");
  const model=scene.models[0], instance=scene.instances[0];
  if (!id(model?.key) || !hash(model.package?.packageSha256) ||
      model.package.packageSha256 !== geometry.sourcePackageSha256 ||
      !id(instance?.instanceId) || !id(instance.stateRevision) ||
      instance.modelKey !== model.key || instance.placement?.units !== "fgm-voxel" ||
      !xyz(instance.placement.translation) || ![0,1,2,3].includes(instance.placement.quarterTurnsZ))
    fail("E_SESSION_SCENE_CACHE");
  const placement=instance.placement;
  const cells=geometry.cellBindings?.map(p=>{
    if(!xyz(p) || !Number.isInteger(p.x)||!Number.isInteger(p.y)||!Number.isInteger(p.z))
      fail("E_SESSION_SCENE_CACHE");
    return [p.x,p.y,p.z];
  }) ?? null;
  return JSON.stringify(["fgmv-scene-cache/1",geometryCacheKey(geometry),cells,
    scene.revision,model.key,instance.instanceId,instance.modelKey,instance.stateRevision,
    [placement.translation.x,placement.translation.y,placement.translation.z],placement.quarterTurnsZ]);
}
/** The view key is not a C04 or collision identity. */
export function presentationCacheKey(geometry: DerivedGeometryV1, scene: SceneSnapshotV1,
  view: ViewStateV1):string {
  if(view?.schema!=="fgmv-view-state/1" || !id(view.revision))fail("E_SESSION_VIEW_CACHE");
  return JSON.stringify(["fgmv-presentation-cache/1",sceneCacheKey(geometry,scene),
    view.revision,view.camera,view.viewport,view.visualProfile ?? null,
    view.selectedInstanceId ?? null,view.selectedCell ?? null,view.showCellGrid]);
}
function safeBytes(input: unknown): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength < 1 || input.byteLength > MAX_SOURCE)
    return fail("E_SESSION_LIMIT");
  if (typeof SharedArrayBuffer !== "undefined" && input.buffer instanceof SharedArrayBuffer)
    return fail("E_SESSION_SHARED_MEMORY");
  // Копирование до первого await; метод вызывается из прототипа, а не из недоверенного input.
  try { return Uint8Array.prototype.slice.call(input) as Uint8Array; }
  catch { return fail("E_SESSION_BYTES"); }
}
async function digest(bytes: Uint8Array): Promise<string> {
  const data = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(data)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function packageMetadata(request: SceneLoadRequest): void {
  const snap = request?.snapshot;
  if (snap?.schema !== "fgmv-scene-snapshot/1" || !id(snap.revision)
      || !Array.isArray(snap.models) || snap.models.length !== 1
      || !Array.isArray(snap.instances) || snap.instances.length !== 1
      || !Array.isArray(request.packages) || request.packages.length !== 1
      || !Array.isArray(request.geometries) || request.geometries.length !== 1)
    fail("E_SESSION_SCOPE"); // S3-S2A — один цельный объект, один экземпляр.
  const model = snap.models[0], instance = snap.instances[0], payload = request.packages[0];
  if (!id(model?.key) || model.package?.format !== "fgm-package/1"
      || !hash(model.package.packageSha256) || !Number.isSafeInteger(model.package.byteLength)
      || model.package.byteLength < 1 || model.package.byteLength > MAX_SOURCE
      || model.package.verifiedC04Identity !== undefined) fail("E_SESSION_PACKAGE");
  // Проверка C04-инварианта недоступна здесь. Даже branded строка не подтверждает Core.
  if (payload?.modelKey !== model.key || !id(instance?.instanceId)
      || !id(instance?.stateRevision) || instance.modelKey !== model.key
      || instance.placement?.units !== "fgm-voxel" || !xyz(instance.placement.translation)
      || ![0,1,2,3].includes(instance.placement.quarterTurnsZ)) fail("E_SESSION_BINDING");
  const geometry = request.geometries[0]?.geometry;
  geometryCacheKey(geometry);
  if (geometry.sourcePackageSha256 !== model.package.packageSha256) fail("E_SESSION_BINDING");
  if (geometry.cellBindings !== undefined && (!Array.isArray(geometry.cellBindings)
      || geometry.cellBindings.length < 2 || geometry.cellBindings.length > 8
      || geometry.cellBindings.some((p: WorldXYZ) => !xyz(p) || !Number.isInteger(p.x)
        || !Number.isInteger(p.y) || !Number.isInteger(p.z)))) fail("E_SESSION_CELLS");
}
function parseObj(bytes: Uint8Array): Mesh {
  let source: string;
  try { source = new TextDecoder("utf-8", {fatal:true}).decode(bytes); }
  catch { return fail("E_SESSION_OBJ"); }
  const vertices: P3[] = [], faces: number[][] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("v ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts.length !== 3) fail("E_SESSION_OBJ");
      const p = parts.map(Number);
      if (p.some(v => !finite(v) || Math.abs(v) > 1048576)) fail("E_SESSION_OBJ");
      vertices.push([p[0],p[1],p[2]]);
    } else if (line.startsWith("f ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      if (parts.length < 3 || parts.length > 4) fail("E_SESSION_OBJ");
      const indices = parts.map(v => Number(v.split("/")[0]) - 1);
      if (indices.some(i => !Number.isInteger(i) || i < 0 || i >= vertices.length)) fail("E_SESSION_OBJ");
      faces.push(indices);
    }
    if (vertices.length > MAX_VERTICES || faces.length > MAX_FACES) fail("E_SESSION_OBJ_LIMIT");
  }
  if (!vertices.length || !faces.length) fail("E_SESSION_OBJ");
  return {vertices, faces};
}
function validView(view: ViewStateV1, loaded: Loaded): ViewStateV1 {
  if (view?.schema !== "fgmv-view-state/1" || !id(view.revision)
      || view.camera?.kind !== "orbit-3d"
      || !finite(view.camera.yaw) || !finite(view.camera.pitch)
      || !finite(view.camera.distance) || view.camera.distance <= 0
      || !xyz(view.camera.focusWorld) || !record(view.viewport)
      || !Number.isSafeInteger(view.viewport.width) || !Number.isSafeInteger(view.viewport.height)
      || view.viewport.width < 1 || view.viewport.height < 1
      || view.viewport.width > DIMENSION || view.viewport.height > DIMENSION
      || !finite(view.viewport.pixelRatio) || view.viewport.pixelRatio < 0.5
      || view.viewport.pixelRatio > 4 || typeof view.showCellGrid !== "boolean") fail("E_SESSION_VIEW");
  if (view.selectedInstanceId !== undefined && view.selectedInstanceId !== loaded.snapshot.instances[0].instanceId)
    fail("E_SESSION_SELECTION");
  if (view.selectedCell !== undefined && (!xyz(view.selectedCell) ||
      !loaded.geometry.cellBindings?.some(p => p.x===view.selectedCell?.x
        && p.y===view.selectedCell?.y && p.z===view.selectedCell?.z))) fail("E_SESSION_SELECTION");
  if (view.visualProfile !== undefined) {
    const p = view.visualProfile;
    if (p.schema !== "fgmv-visual-profile/1" || !hash(p.profileSha256)
        || !id(p.algorithmId) || !id(p.algorithmVersion)) fail("E_SESSION_PROFILE");
  }
  // Данный срез отказывается от geometry-affecting профиля без отдельно совпавшего mesh.
  if (loaded.geometry.recipe.geometryProfileSha256 !== undefined
      && loaded.geometry.recipe.geometryProfileSha256 !== view.visualProfile?.profileSha256)
    fail("E_SESSION_PROFILE_GEOMETRY");
  return own(view);
}
function rotated(x: number, y: number, turns: number): readonly [number,number] {
  switch(turns) {
    case 1: return [-y,x]; case 2: return [-x,-y]; case 3: return [y,-x]; default: return [x,y];
  }
}
function frameProjection(w: number,h: number,loaded: Loaded,view: ViewStateV1) {
  if (view.camera.kind !== "orbit-3d") fail("E_SESSION_CAMERA_UNSUPPORTED");
  const {yaw,pitch,distance,focusWorld} = view.camera;
  const instance = loaded.snapshot.instances[0];
  const tx=instance.placement.translation, q=instance.placement.quarterTurnsZ;
  const sin=Math.sin(yaw),cos=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch);
  const project = (v: readonly number[]):P3 => {
    const [rx,ry] = rotated(v[0],v[1],q);
    const x=rx+tx.x-focusWorld.x,y=ry+tx.y-focusWorld.y,z=v[2]+tx.z-focusWorld.z;
    const dx=x*cos-y*sin,dy=x*sin+y*cos;
    return [dx,dy*sp-z*cp,dy*cp+z*sp];
  };
  const transformed=loaded.mesh.vertices.map(project);
  const xx=transformed.map(p=>p[0]), yy=transformed.map(p=>p[1]);
  const minx=Math.min(...xx),maxx=Math.max(...xx),miny=Math.min(...yy),maxy=Math.max(...yy);
  const scale=Math.min(w/(maxx-minx+2),h/(maxy-miny+2))*.80/(Math.max(.1,distance));
  const cx=(minx+maxx)/2,cy=(miny+maxy)/2;
  const screen=(p:P3):readonly [number,number]=>[w/2+(p[0]-cx)*scale,h/2+(p[1]-cy)*scale];
  return {transformed,project,screen};
}
function cellCorners(cell:WorldXYZ):readonly P3[] {
  const [x,y,z]=[cell.x*16,cell.y*16,cell.z*24];
  return [[x,y,z],[x+16,y,z],[x+16,y+16,z],[x,y+16,z]];
}
function selected(cell:WorldXYZ,view:ViewStateV1):boolean {
  return view.selectedCell?.x===cell.x && view.selectedCell.y===cell.y && view.selectedCell.z===cell.z;
}
function renderDiagnostic(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,h: number, loaded: Loaded, view: ViewStateV1): void {
  const {transformed,project,screen}=frameProjection(w,h,loaded,view);
  ctx.fillStyle="#101b2b";ctx.fillRect(0,0,w,h);
  const order=loaded.mesh.faces.map(f=>({f,depth:f.reduce((v,i)=>v+transformed[i][2],0)/f.length}));
  order.sort((a,b)=>a.depth-b.depth);
  for(const {f,depth} of order){
    ctx.beginPath(); f.forEach((i,j)=>{const [x,y]=screen(transformed[i]);if(j)ctx.lineTo(x,y);else ctx.moveTo(x,y)});
    ctx.closePath();ctx.fillStyle=depth>0?"#668c9c":"#517485";ctx.fill();
    ctx.lineWidth=.7;ctx.strokeStyle="#91b7c1";ctx.stroke();
  }
  if (view.showCellGrid) for(const cell of loaded.geometry.cellBindings ?? []){
    ctx.beginPath();cellCorners(cell).forEach((p,i)=>{const [x,y]=screen(project(p));if(i)ctx.lineTo(x,y);
      else ctx.moveTo(x,y)});
    ctx.closePath();ctx.strokeStyle=selected(cell,view) ? "#ffca62":"#a4b9c7";
    ctx.lineWidth=1;ctx.stroke();
  }
}
const gpuShader=`
struct Vertex {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
}
@vertex fn vertex(@location(0) position: vec3f, @location(1) color: vec3f) -> Vertex {
  return Vertex(vec4f(position, 1.0), color);
}
@fragment fn fragment(input: Vertex) -> @location(0) vec4f {
  return vec4f(input.color, 1.0);
}`;

function gpuVertices(w:number,h:number,loaded:Loaded,view:ViewStateV1) {
  const {transformed,project,screen}=frameProjection(w,h,loaded,view);
  const depths=transformed.map(p=>p[2]);
  const minDepth=Math.min(...depths),maxDepth=Math.max(...depths);
  const vertices:number[]=[];
  const put=(p:P3,color:P3,depth:number)=>{
    const [x,y]=screen(p);
    vertices.push(2*x/w-1,1-2*y/h,depth,color[0]/255,color[1]/255,color[2]/255);
  };
  const putMesh=(i:number,color:P3)=>put(transformed[i],color,
    (maxDepth-transformed[i][2]+1)/(maxDepth-minDepth+2));
  for (const face of loaded.mesh.faces) {
    const color:P3=face.reduce((sum,i)=>sum+transformed[i][2],0)>0 ? [102,140,156] : [81,116,133];
    for (let i=1;i+1<face.length;i++) {
      putMesh(face[0],color);putMesh(face[i],color);putMesh(face[i+1],color);
    }
  }
  const triangleVertices=vertices.length/6;
  if (view.showCellGrid) for (const cell of loaded.geometry.cellBindings ?? []) {
    const points=cellCorners(cell).map(project);
    const color:P3=selected(cell,view) ? [255,202,98] : [164,185,199];
    for (let i=0;i<points.length;i++) {
      put(points[i],color,.5);put(points[(i+1)%points.length],color,.5);
    }
  }
  return {data:new Float32Array(vertices),triangleVertices};
}

type GpuFrameFailure = Extract<FrameOutcomeV1,{status:"failed"}>["reason"];
type GpuFrame =
  | {pixels:Uint8ClampedArray<ArrayBuffer>}
  | {reason:GpuFrameFailure};

async function createWebGpu(canvas:RendererSessionRequest["canvas"]) {
  const api=globalThis.navigator?.gpu;
  if (!api) return null;
  let device:GPUDevice|undefined;
  try {
    const adapter=await api.requestAdapter();
    if (!adapter) return null;
    device=await adapter.requestDevice();
    const gpu=device,format="rgba8unorm";
    const shader=gpu.createShaderModule({code:gpuShader});
    const pipeline=(topology:GPUPrimitiveTopology,depthWriteEnabled:boolean)=>
      gpu.createRenderPipelineAsync({
        layout:"auto",
        vertex:{module:shader,entryPoint:"vertex",buffers:[{arrayStride:24,attributes:[
          {shaderLocation:0,offset:0,format:"float32x3"},
          {shaderLocation:1,offset:12,format:"float32x3"}
        ]}]},
        fragment:{module:shader,entryPoint:"fragment",targets:[{format}]},
        primitive:{topology},
        depthStencil:{format:"depth24plus",depthWriteEnabled,depthCompare:depthWriteEnabled?"less-equal":"always"}
      });
    const [triangles,lines]=await Promise.all([pipeline("triangle-list",true),pipeline("line-list",false)]);
    const output=canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!output) {gpu.destroy();return null;}
    let lost=false,disposed=false;
    const markLost=()=>{
      if (lost) return;
      lost=true;
      if (!disposed) output.clearRect(0,0,canvas.width,canvas.height);
    };
    void gpu.lost.then(markLost);
    return {
      get lost(){return lost}, output,
      async render(w:number,h:number,scene:Loaded,view:ViewStateV1):Promise<GpuFrame> {
        const bytesPerRow=Math.ceil(w*4/256)*256;
        const resources:(GPUBuffer|GPUTexture)[]=[];
        const retain=<T extends GPUBuffer|GPUTexture>(resource:T):T=>{
          resources.push(resource);
          return resource;
        };
        const scopes=["internal","out-of-memory","validation"] as const;
        let reason:GpuFrameFailure="E_SESSION_GPU_FRAME";
        let read:GPUBuffer|undefined;
        let reading:Promise<boolean>|undefined;
        let result:GpuFrame|undefined;
        let cleanupFailed=false;
        try {
          for(const scope of scopes)gpu.pushErrorScope(scope);
          try {
            const {data,triangleVertices}=gpuVertices(w,h,scene,view);
            const buffer=retain(gpu.createBuffer({size:data.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}));
            const depth=retain(gpu.createTexture({size:[w,h],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}));
            const color=retain(gpu.createTexture({size:[w,h],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}));
            read=retain(gpu.createBuffer({size:bytesPerRow*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
            gpu.queue.writeBuffer(buffer,0,data);
            const encoder=gpu.createCommandEncoder();
            const pass=encoder.beginRenderPass({colorAttachments:[{
              view:color.createView(),clearValue:[16/255,27/255,43/255,1],
              loadOp:"clear",storeOp:"store"
            }],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"discard"}});
            pass.setVertexBuffer(0,buffer);
            pass.setPipeline(triangles);pass.draw(triangleVertices);
            const lineVertices=data.length/6-triangleVertices;
            if (lineVertices) {pass.setPipeline(lines);pass.draw(lineVertices,1,triangleVertices);}
            pass.end();
            encoder.copyTextureToBuffer({texture:color},{buffer:read,bytesPerRow},{width:w,height:h});
            gpu.queue.submit([encoder.finish()]);
            reason="E_SESSION_GPU_READBACK";
            reading=read.mapAsync(GPUMapMode.READ).then(()=>true,()=>false);
          } catch {
            // Синхронный отказ оставляет reading пустым. Области ошибок всё равно закрываются.
          }
          const errors=await Promise.all(scopes.map(()=>gpu.popErrorScope().then(error=>error!==null,()=>true)));
          const mapped=await reading;
          if(errors.some(Boolean))result={reason:"E_SESSION_GPU_FRAME"};
          else if(!mapped||!read)result={reason};
          else {
            const bytes=new Uint8Array(read.getMappedRange());
            const pixels=new Uint8ClampedArray(w*h*4);
            for(let y=0;y<h;y++)pixels.set(bytes.subarray(y*bytesPerRow,y*bytesPerRow+w*4),y*w*4);
            result={pixels};
          }
        } catch {
          result={reason};
        } finally {
          // Изолируем отказ destroy(): попытка очистки всех ресурсов обязательна.
          for(const resource of resources.reverse()){
            try{resource.destroy();}
            catch{cleanupFailed=true;}
          }
        }
        // Вне finally: ошибка cleanup не может заменить типизированный результат
        // отклонением Promise или выдать ошибочный успех публикации кадра.
        if(cleanupFailed&&(!result||"pixels" in result))return {reason:"E_SESSION_GPU_FRAME"};
        return result??{reason};
      },
      dispose(){disposed=true;gpu.destroy();}
    };
  } catch {
    device?.destroy();
    return null;
  }
}
function scratchCanvas(canvas: HTMLCanvasElement | OffscreenCanvas,w:number,h:number): HTMLCanvasElement | OffscreenCanvas {
  if(typeof OffscreenCanvas!=="undefined")return new OffscreenCanvas(w,h);
  if(typeof document!=="undefined") { const c=document.createElement("canvas");c.width=w;c.height=h;return c; }
  return fail("E_SESSION_CANVAS");
}

export const createRendererSessionV1: CreateRendererSessionV1 = async (request: RendererSessionRequest):Promise<RendererSessionV1> => {
  if(!request?.canvas || typeof request.canvas.getContext!=="function")fail("E_SESSION_CANVAS");
  if(request.preferredBackend !== "canvas2d-diagnostic" && request.preferredBackend !== "webgpu")
    fail("E_SESSION_BACKEND_UNSUPPORTED");
  if(request.fallbackPolicy !== "reject" && request.fallbackPolicy !== "allow-diagnostic")
    fail("E_SESSION_FALLBACK_POLICY");
  const gpu=request.preferredBackend==="webgpu" ? await createWebGpu(request.canvas) : null;
  if(request.preferredBackend==="webgpu" && !gpu && request.fallbackPolicy==="reject")
    fail("E_SESSION_BACKEND_UNSUPPORTED");
  const output=gpu?.output ?? request.canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if(!gpu && !output)fail("E_SESSION_CANVAS");
  let closed=false,epoch=0,frames=0,gpuSubmission=0,loaded:Loaded|null=null,view:ViewStateV1|null=null;
  let readingGpu=false,wakeQueuedGpu:(()=>void)|null=null;
  function wakeGpuWaiter():void {
    const wake=wakeQueuedGpu;
    wakeQueuedGpu=null;
    wake?.();
  }
  function waitForGpu(signal?:AbortSignal):Promise<void> {
    wakeGpuWaiter();
    return new Promise(resolve=>{
      const wake=()=>{signal?.removeEventListener("abort",cancel);resolve();};
      const cancel=()=>{if(wakeQueuedGpu===wake)wakeQueuedGpu=null;wake();};
      wakeQueuedGpu=wake;
      signal?.addEventListener("abort",cancel,{once:true});
    });
  }
  const ensureOpen=()=>{if(closed)fail("E_SESSION_DISPOSED")};
  // Fail-closed visual policy: a former frame is never presented as the new scene/view.
  const clearPublished=()=>output?.clearRect(0,0,request.canvas.width,request.canvas.height);
  const current = (ctx: FrameContextV1) => !!loaded && !!view && ctx.sessionEpoch===epoch
    && ctx.expectedSceneRevision===loaded.snapshot.revision && ctx.expectedViewRevision===view.revision;
  const session:RendererSessionV1={
    schema:"fgmv-renderer-session/1",capabilities:gpu ? Object.freeze({
      ...CAPABILITIES, backendKind:"webgpu",backendVersion:"s3-s2e/1"
    }) : CAPABILITIES,
    async loadScene(input,options) {
      ensureOpen();const generation=++epoch;loaded=null;view=null;clearPublished();wakeGpuWaiter();
      if(options?.signal?.aborted)fail("E_SESSION_ABORTED");
      packageMetadata(input);
      const packageBytes=safeBytes(input.packages[0].bytes);
      const geometryBytes=safeBytes(input.geometries[0].bytes);
      if(packageBytes.length!==input.snapshot.models[0].package.byteLength
         || packageBytes.length+geometryBytes.length>MAX_TOTAL)fail("E_SESSION_LIMIT");
      const snapshot=own(input.snapshot),geometry=own(input.geometries[0].geometry);
      const [packageHash,meshHash]=await Promise.all([digest(packageBytes),digest(geometryBytes)]);
      if(closed)fail("E_SESSION_DISPOSED");
      if(options?.signal?.aborted)fail("E_SESSION_ABORTED");
      if(generation!==epoch)fail("E_SESSION_STALE");
      if(packageHash!==snapshot.models[0].package.packageSha256 || meshHash!==geometry.meshSha256)
        fail("E_SESSION_DIGEST");
      let parsed:unknown;
      try{parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(packageBytes))}
      catch{return fail("E_SESSION_PACKAGE")}
      if(!record(parsed)||parsed.format!=="fgm-package/1")fail("E_SESSION_PACKAGE");
      const mesh=parseObj(geometryBytes);
      if(options?.signal?.aborted)fail("E_SESSION_ABORTED");
      if(closed)fail("E_SESSION_DISPOSED");
      if(generation!==epoch)fail("E_SESSION_STALE");
      loaded={snapshot,geometry,mesh,cacheKey:geometryCacheKey(geometry)};
      return {sceneRevision:snapshot.revision,sessionEpoch:generation};
    },
    setView(value):ViewReceipt {
      ensureOpen();if(!loaded)fail("E_SESSION_NO_SCENE");
      epoch++;view=null;clearPublished();wakeGpuWaiter();const next=validView(value,loaded);view=next;
      return {viewRevision:next.revision,sessionEpoch:epoch};
    },
    async renderFrame(context):Promise<FrameOutcomeV1>{
      ensureOpen();
      const sceneRevision=context.expectedSceneRevision,viewRevision=context.expectedViewRevision;
      const answer=(status:"stale"|"aborted"|"unsupported"|"device-lost",reason:string):FrameOutcomeV1=>
        ({status,reason,sceneRevision,viewRevision,sessionEpoch:context.sessionEpoch});
      if(context.signal?.aborted)return answer("aborted","E_SESSION_ABORTED");
      if(!current(context))return answer("stale","E_SESSION_STALE");
      const scene=loaded!,v=view!,generation=epoch;
      // Асинхронная граница до публикации; изменения состояния делают кадр stale.
      await Promise.resolve();
      if(closed||generation!==epoch||!current(context))return answer("stale","E_SESSION_STALE");
      if(context.signal?.aborted)return answer("aborted","E_SESSION_ABORTED");
      const w=v.viewport.width,h=v.viewport.height;
      if(gpu) {
        const submission=++gpuSubmission;
        if(readingGpu)await waitForGpu(context.signal);
        if(context.signal?.aborted)return answer("aborted","E_SESSION_ABORTED");
        if(closed||generation!==epoch||submission!==gpuSubmission||!current(context))
          return answer("stale","E_SESSION_STALE");
        if(gpu.lost)return answer("device-lost","E_SESSION_DEVICE_LOST");
        readingGpu=true;
        let frame;
        try {frame=await gpu.render(w,h,scene,v);}
        finally {readingGpu=false;wakeGpuWaiter();}
        if(closed||generation!==epoch||submission!==gpuSubmission||!current(context))
          return answer("stale","E_SESSION_STALE");
        if(context.signal?.aborted)return answer("aborted","E_SESSION_ABORTED");
        if(gpu.lost)return answer("device-lost","E_SESSION_DEVICE_LOST");
        if("reason" in frame) {
          clearPublished();
          return {status:"failed",reason:frame.reason,sceneRevision,viewRevision,sessionEpoch:generation};
        }
        request.canvas.width=w;request.canvas.height=h;
        output!.putImageData(new ImageData(frame.pixels,w,h),0,0);
        return {status:"rendered",sceneRevision,viewRevision,sessionEpoch:generation,frameNumber:++frames};
      }
      const temp=scratchCanvas(request.canvas,w,h);
      const tempContext=temp.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if(!tempContext)fail("E_SESSION_CANVAS");
      renderDiagnostic(tempContext,w,h,scene,v);
      if(closed||generation!==epoch||!current(context))return answer("stale","E_SESSION_STALE");
      if(context.signal?.aborted)return answer("aborted","E_SESSION_ABORTED");
      request.canvas.width=w;request.canvas.height=h;
      output!.drawImage(temp as CanvasImageSource,0,0);
      return {status:"rendered",sceneRevision,viewRevision,sessionEpoch:generation,frameNumber:++frames};
    },
    async recoverDevice(){ensureOpen();fail("E_SESSION_BACKEND_UNSUPPORTED")},
    async dispose(){if(closed)return;closed=true;++epoch;loaded=null;view=null;
      clearPublished();wakeGpuWaiter();gpu?.dispose()}
  };
  return session;
};
