// Типовые свидетельства: компилируется TypeScript, БЕЗ выполнения backend.
import type {
  CanonicalPackageRef, CreateRendererSessionV1, DerivedGeometryV1,
  FrameOutcomeV1, GeometryRecipeV1, RendererSessionV1, RendererBackendEventV1, SceneSnapshotV1,
  Sha256Hex, VerifiedC04Identity, ViewStateV1
} from "./renderer-session-v1";

declare const digest: Sha256Hex;
declare const c04: VerifiedC04Identity;
declare const factory: CreateRendererSessionV1;

const model: CanonicalPackageRef = {
  format:"fgm-package/1", packageSha256:digest, byteLength:64,
};
const independentlyVerifiedModel: CanonicalPackageRef = {
  ...model,verifiedC04Identity:c04
};
const snapshot: SceneSnapshotV1 = {
  schema:"fgmv-scene-snapshot/1",revision:"scene-a",
  models:[{key:"structure",package:independentlyVerifiedModel}],
  instances:[{
    instanceId:"instance-0",modelKey:"structure",stateRevision:"static-0",
    placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:0,units:"fgm-voxel"}
  }]
};
const recipe: GeometryRecipeV1 = {
  schema:"fgmv-geometry-recipe/1",algorithmId:"surface-global",
  algorithmVersion:"1",parametersSha256:digest,deterministicSeed:"0",
  detailDepth:0
};
const geometry: DerivedGeometryV1 = {
  schema:"fgmv-derived-geometry/1",sourcePackageSha256:digest,recipe,
  meshFormat:"obj/1",meshSha256:digest,cellBindings:[{x:0,y:0,z:0}]
};
const view: ViewStateV1 = {
  schema:"fgmv-view-state/1",revision:"view-a",
  camera:{kind:"r05-isometric",quarterTurns:0,zoom:1,focusWorld:{x:0,y:0,z:0}},
  viewport:{width:840,height:630,pixelRatio:1},showCellGrid:true
};
const terminal:RendererBackendEventV1 = {
  schema:"fgmv-renderer-backend-event/1",state:"device-lost",
  reason:"E_SESSION_DEVICE_LOST",backendKind:"webgpu",
  sessionEpoch:1,sceneRevision:"s",viewRevision:"v"
};
// @ts-expect-error A backend loss cannot assert successful rendering.
const badBackendFrame:RendererBackendEventV1={...terminal,frameNumber:1};
// @ts-expect-error No device vendor object may appear in typed events.
const badBackendDevice:RendererBackendEventV1={...terminal,gpuDevice:{}};
// @ts-expect-error Only WebGPU can report GPU device loss.
const badBackendKind:RendererBackendEventV1={...terminal,backendKind:"canvas2d-diagnostic"};
async function consumer(session:RendererSessionV1) {
  const stop=session.subscribeBackendEvents(event=>{
    const state:"device-lost"=event.state;
    const revision:string|null=event.sceneRevision;
    void state;void revision;
  });
  stop();stop();
  const loaded=await session.loadScene({
    snapshot,packages:[{modelKey:"structure",bytes:new Uint8Array(64)}],
    geometries:[{geometry,bytes:new Uint8Array(32)}]
  });
  const receipt=session.setView(view);
  const result=await session.renderFrame({
    expectedSceneRevision:loaded.sceneRevision,
    expectedViewRevision:receipt.viewRevision,
    sessionEpoch:receipt.sessionEpoch
  });
  if(result.status==="rendered"){
    const number:number=result.frameNumber;
    void number;
  }
  await session.dispose();
  return result;
}
async function factoryUse(canvas:HTMLCanvasElement){
  const session=await factory({canvas,preferredBackend:"webgpu",fallbackPolicy:"allow-diagnostic"});
  return consumer(session);
}
// Отрицательные проверяемые запреты TypeScript-API.
// @ts-expect-error Камера не принадлежит CanonicalPackageRef.
const badModel:CanonicalPackageRef={...model,camera:view.camera};
// @ts-expect-error Семантический C04 ID нельзя подменить SHA сериализованных байтов.
const badC04:VerifiedC04Identity=digest;
// @ts-expect-error Неверный четверть-оборот на том же выражении запрещён.
const badPlacement:SceneSnapshotV1={...snapshot,instances:[{...snapshot.instances[0],placement:{translation:{x:0,y:0,z:0},quarterTurnsZ:5,units:"fgm-voxel"}}]};
// @ts-expect-error Отменённый кадр не может содержать признак успешно отрисованного.
const badFrame:FrameOutcomeV1={status:"aborted",sceneRevision:"a",viewRevision:"b",sessionEpoch:2,reason:"abort",frameNumber:1};
type Check<T extends true> = T;
type _NoCameraInPackage = Check<"camera" extends keyof CanonicalPackageRef ? false : true>;
type _NoC05InView = Check<"c05" extends keyof ViewStateV1 ? false : true>;
type _NoGameRulesInSession = Check<"damage" extends keyof RendererSessionV1 ? false : true>;
void badModel;void badC04;void badPlacement;void badFrame;void factoryUse;

void badBackendFrame;void badBackendDevice;void badBackendKind;
