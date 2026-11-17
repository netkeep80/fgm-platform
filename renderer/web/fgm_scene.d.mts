interface SceneModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _fgm_scene_size(): number;
  _fgm_sample_scene(input: number, length: number, output: number): number;
  _fgm_camera_reset(): void;
  _fgm_camera_turn(steps: number): number;
  _fgm_camera_zoom(factor: number, x: number, y: number): number;
  _fgm_camera_project(x: number, y: number, z: number, output: number): number;
  _fgm_camera_pick(x: number, y: number, output: number): number;
}
export default function createScene(): Promise<SceneModule>;
