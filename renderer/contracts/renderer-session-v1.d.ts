/**
 * RendererSession v1 — типовой КАНДИДАТ контракта, НЕ реализация.
 * Не включён в сборку Studio 1.20. Все сведения о семантике FGM авторитетны
 * только при проверке через принятый fgmr/fgmc.
 */
export type Sha256Hex = string & {readonly __sha256Hex: "validated-64hex"};
export type VerifiedC04Identity = string & {readonly __c04Identity: "verified-core"};
export type WorldXYZ = Readonly<{x: number; y: number; z: number}>;

export interface CanonicalPackageRef {
  readonly format: "fgm-package/1";
  /** SHA-256 точных сериализованных байтов, НЕ утверждение C04 semantic identity. */
  readonly packageSha256: Sha256Hex;
  readonly byteLength: number;
  /** Доступно только если независимо удостоверено по контракту Core. */
  readonly verifiedC04Identity?: VerifiedC04Identity;
}

export interface SceneModel {
  readonly key: string;
  readonly package: CanonicalPackageRef;
}
export interface WorldPlacement {
  /** Положение в координатах FGM, отдельно от байтов модели. */
  readonly translation: WorldXYZ;
  /** Текущий узкий статический контракт — четверть-обороты в плоскости XY. */
  readonly quarterTurnsZ: 0 | 1 | 2 | 3;
  readonly units: "fgm-voxel";
}
export interface SceneInstance {
  readonly instanceId: string;
  readonly modelKey: string;
  readonly placement: WorldPlacement;
  readonly stateRevision: string;
}
export interface SceneSnapshotV1 {
  readonly schema: "fgmv-scene-snapshot/1";
  readonly revision: string;
  readonly models: readonly SceneModel[];
  readonly instances: readonly SceneInstance[];
}

export interface GeometryRecipeV1 {
  readonly schema: "fgmv-geometry-recipe/1";
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly parametersSha256: Sha256Hex;
  readonly deterministicSeed: string;
  /** Не меняет FGM/C05. 0 допустим, fractal LOD пока не реализован. */
  readonly detailDepth: number;
  /** Если визуальный профиль влияет на mesh, это отдельный ключ. */
  readonly geometryProfileSha256?: Sha256Hex;
}
export interface DerivedGeometryV1 {
  readonly schema: "fgmv-derived-geometry/1";
  readonly sourcePackageSha256: Sha256Hex;
  readonly recipe: GeometryRecipeV1;
  readonly meshFormat: "obj/1" | "fgmv-mesh/1";
  readonly meshSha256: Sha256Hex;
  /** Производные клеточные срезы одной модели, а не отдельные FGM-пакеты. */
  readonly cellBindings?: readonly WorldXYZ[];
}
export interface GeometryPayload {
  readonly geometry: DerivedGeometryV1;
  readonly bytes: Uint8Array;
}
export interface PackagePayload {
  readonly modelKey: string;
  readonly bytes: Uint8Array;
}
export interface SceneLoadRequest {
  readonly snapshot: SceneSnapshotV1;
  readonly packages: readonly PackagePayload[];
  readonly geometries: readonly GeometryPayload[];
}

export interface VisualProfileRefV1 {
  readonly schema: "fgmv-visual-profile/1";
  readonly profileSha256: Sha256Hex;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
}
export type CameraV1 =
  | Readonly<{kind: "r05-isometric"; quarterTurns: 0 | 1 | 2 | 3;
      zoom: number; focusWorld: WorldXYZ}>
  | Readonly<{kind: "orbit-3d"; yaw: number; pitch: number;
      distance: number; focusWorld: WorldXYZ}>;

export interface ViewStateV1 {
  readonly schema: "fgmv-view-state/1";
  readonly revision: string;
  readonly camera: CameraV1;
  readonly viewport: Readonly<{width: number; height: number; pixelRatio: number}>;
  readonly visualProfile?: VisualProfileRefV1;
  readonly selectedInstanceId?: string;
  readonly selectedCell?: WorldXYZ;
  readonly showCellGrid: boolean;
}

export type RendererBackendKind = "webgpu" | "canvas2d-diagnostic";
export interface RendererCapabilitiesV1 {
  readonly schema: "fgmv-renderer-capabilities/1";
  readonly backendKind: RendererBackendKind;
  readonly backendVersion: string;
  readonly supportedCameras: readonly CameraV1["kind"][];
  readonly supportsWholeObject: boolean;
  readonly supportsDeviceRecovery: boolean;
}
/** One terminal backend loss fact; not a frame receipt or source provenance. */
export interface RendererBackendEventV1 {
  readonly schema: "fgmv-renderer-backend-event/1";
  readonly state: "device-lost";
  readonly reason: "E_SESSION_DEVICE_LOST";
  readonly backendKind: "webgpu";
  readonly sessionEpoch: number;
  readonly sceneRevision: string | null;
  readonly viewRevision: string | null;
}
export interface RendererSessionRequest {
  readonly preferredBackend: RendererBackendKind;
  readonly fallbackPolicy: "reject" | "allow-diagnostic";
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
}

export interface SceneReceipt {
  readonly sceneRevision: string;
  readonly sessionEpoch: number;
}
export interface ViewReceipt {
  readonly viewRevision: string;
  readonly sessionEpoch: number;
}
export interface FrameContextV1 {
  readonly expectedSceneRevision: string;
  readonly expectedViewRevision: string;
  readonly sessionEpoch: number;
  readonly signal?: AbortSignal;
}
export type FrameOutcomeV1 =
  | Readonly<{status: "rendered"; sceneRevision: string; viewRevision: string;
      sessionEpoch: number; frameNumber: number}>
  | Readonly<{status: "aborted" | "stale" | "device-lost" | "unsupported";
      sceneRevision: string; viewRevision: string; sessionEpoch: number; reason: string}>
  | Readonly<{status: "failed"; sceneRevision: string; viewRevision: string; sessionEpoch: number;
      reason: "E_SESSION_GPU_FRAME" | "E_SESSION_GPU_READBACK"}>;

export interface RendererSessionV1 {
  readonly schema: "fgmv-renderer-session/1";
  readonly capabilities: RendererCapabilitiesV1;
  /** Terminal WebGPU device-loss notification; subscribe after loss replays it once.
   * The returned function is an idempotent unsubscribe; no GPUDevice is exposed. */
  subscribeBackendEvents(listener: (event: Readonly<RendererBackendEventV1>) => void): () => void;
  /**
   * Запрещает публикацию кадра до проверки package bytes, digest и
   * ссылочной целостности экземпляров. Входы должны быть скопированы
   * или защищены от мутации на время асинхронной работы.
   */
  loadScene(request: SceneLoadRequest, options?: {signal?: AbortSignal}): Promise<SceneReceipt>;
  setView(view: ViewStateV1): ViewReceipt;
  renderFrame(context: FrameContextV1): Promise<FrameOutcomeV1>;
  recoverDevice(): Promise<void>;
  dispose(): Promise<void>;
}
/** Фабрика — только типовой контракт; никакая реализация здесь не экспортируется. */
export type CreateRendererSessionV1 =
  (request: RendererSessionRequest) => Promise<RendererSessionV1>;
