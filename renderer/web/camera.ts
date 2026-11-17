import createScene from "./fgm_scene.mjs";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const controls = document.querySelector<HTMLFieldSetElement>("fieldset")!;
const status = document.querySelector<HTMLElement>("[role=status]")!;
const selection = document.querySelector<HTMLElement>("#selection")!;
const noSelection = selection.textContent;

type Point = readonly [number, number, number];
type Color = readonly [number, number, number];
type Vertex = { point: Point; color: Color };

function makeScene() {
  const vertices: Vertex[] = [];
  function quad(a: Point, b: Point, c: Point, d: Point, color: Color) {
    for (const point of [a,b,c,a,c,d]) vertices.push({ point, color });
  }
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      const x = column*16 - 0.35;
      const y = row*16 - 0.35;
      const edge = 15.7;
      const ground: Color = (row+column)%2 === 0 ? [57,91,95] : [50,81,89];
      quad([x,y,0],[x+edge,y,0],[x+edge,y+edge,0],[x,y+edge,0],ground);
    }
  }
  function block(x0: number, y0: number, x1: number, y1: number, h: number, color: Color) {
    const a: Point = [x0,y0,h], b: Point = [x1,y0,h], c: Point = [x1,y1,h], d: Point = [x0,y1,h];
    const e: Point = [x0,y0,0], f: Point = [x1,y0,0], g: Point = [x1,y1,0], j: Point = [x0,y1,0];
    const side = (shade: number): Color => [color[0]*shade,color[1]*shade,color[2]*shade];
    quad(a,b,c,d,color);
    quad(a,b,f,e,side(0.68));
    quad(b,c,g,f,side(0.83));
    quad(c,d,j,g,side(0.74));
    quad(d,a,e,j,side(0.59));
  }
  block(3.5,3.5,11.5,11.5,12,[229,181,98]);
  block(35.5,19.5,51.5,29.5,22,[102,193,176]);
  block(19.5,35.5,29.5,43.5,7,[165,134,206]);
  block(49.5,5.5,61.5,11.5,5,[113,158,218]);
  return vertices;
}

function show(message: string, state: string) {
  status.textContent = message;
  status.dataset.state = state;
  controls.disabled = state !== "ready";
}

function fail(error: unknown) {
  show(error instanceof Error ? error.message : String(error), "error");
}

function screen(event: MouseEvent): [number, number] {
  const rect = canvas.getBoundingClientRect();
  return [(event.clientX-rect.left)*canvas.width/rect.width,
          (event.clientY-rect.top)*canvas.height/rect.height];
}

async function start() {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU-адаптер недоступен");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Холст недоступен");
  const source = await fetch(new URL("camera.wgsl", import.meta.url));
  if (!source.ok) throw new Error("Не удалось загрузить шейдер карты");
  const [device, module, shader] = await Promise.all([
    adapter.requestDevice(), createScene(), source.text()
  ]);
  device.addEventListener("uncapturederror", event => fail(event.error.message));
  void device.lost.then(info => {
    show(info.message || "WebGPU-устройство потеряно. Перезагрузите страницу.", "error");
  });
  const format: GPUTextureFormat = "rgba8unorm";
  const depthFormat: GPUTextureFormat = "depth32float";
  const shaderModule = device.createShaderModule({ code: shader });
  const pipeline = await device.createRenderPipelineAsync({
    layout: "auto",
    vertex: {
      module: shaderModule,
      entryPoint: "vertex_main",
      buffers: [{
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
        ],
      }],
    },
    fragment: { module: shaderModule, entryPoint: "fragment_main", targets: [{ format }] },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: "less" },
  });
  const vertices = makeScene();
  const data = new Float32Array(vertices.length*6);
  const vertexBuffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const size = [canvas.width, canvas.height];
  const color = device.createTexture({
    size, format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const colorView = color.createView();
  const depth = device.createTexture({
    size, format: depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT,
  }).createView();
  // The 640-pixel RGBA rows are already aligned to WebGPU's 256-byte requirement.
  const bytesPerRow = canvas.width*4;
  const readback = device.createBuffer({
    size: bytesPerRow*canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const output = module._malloc(4*8);
  if (!output) throw new Error("Недостаточно памяти для камеры");
  const result = () => new Float64Array(module.HEAPU8.buffer, output, 4);
  let frame = 0;
  let drawing = false;
  let dirty = false;

  async function render() {
    for (let index = 0; index < vertices.length; index++) {
      const { point, color } = vertices[index];
      if (module._fgm_camera_project(...point, output) !== 0) throw new Error("Ошибка проекции карты");
      const [x,y,z] = result();
      data.set([2*x/canvas.width-1, 1-2*y/canvas.height, z,
                color[0]/255, color[1]/255, color[2]/255], index*6);
    }
    device.queue.writeBuffer(vertexBuffer, 0, data);
    const command = device.createCommandEncoder();
    const pass = command.beginRenderPass({
      colorAttachments: [{
        view: colorView, loadOp: "clear", storeOp: "store",
        clearValue: { r: 15/255, g: 22/255, b: 34/255, a: 1 },
      }],
      depthStencilAttachment: { view: depth, depthLoadOp: "clear", depthClearValue: 1, depthStoreOp: "discard" },
    });
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(vertices.length);
    pass.end();
    command.copyTextureToBuffer({ texture: color }, { buffer: readback, bytesPerRow }, size);
    device.queue.submit([command.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    try {
      const pixels = new Uint8ClampedArray(readback.getMappedRange().slice(0));
      context!.putImageData(new ImageData(pixels, canvas.width, canvas.height),0,0);
    } finally {
      readback.unmap();
    }
    canvas.dataset.frame = String(++frame);
  }

  async function redraw() {
    if (drawing) return;
    drawing = true;
    try {
      while (dirty && !controls.disabled) {
        dirty = false;
        await render();
      }
    } catch (error) {
      fail(error);
    } finally {
      drawing = false;
    }
  }

  function change(action: () => number) {
    if (controls.disabled) return;
    try {
      if (action() !== 0) throw new Error("Ошибка управления камерой");
      dirty = true;
      void redraw();
    } catch (error) { fail(error); }
  }
  for (const [id,steps] of [["turn-left",-1],["turn-right",1]] as const) {
    document.getElementById(id)!.onclick = () => change(() => module._fgm_camera_turn(steps));
  }
  for (const [id,factor] of [["zoom-out",1/1.2],["zoom-in",1.2]] as const) {
    document.getElementById(id)!.onclick =
      () => change(() => module._fgm_camera_zoom(factor,canvas.width/2,canvas.height/2));
  }
  document.getElementById("reset-camera")!.onclick = () => change(() => {
    module._fgm_camera_reset();
    selection.textContent = noSelection;
    return 0;
  });
  canvas.addEventListener("wheel", event => {
    if (controls.disabled || event.deltaY === 0) return;
    event.preventDefault();
    const [x,y] = screen(event);
    change(() => module._fgm_camera_zoom(event.deltaY < 0 ? 1.2 : 1/1.2,x,y));
  }, { passive: false });
  canvas.addEventListener("click", event => {
    if (controls.disabled) return;
    const [x,y] = screen(event);
    const hit = module._fgm_camera_pick(x,y,output);
    if (hit < 0) {
      fail(new Error("Ошибка выбора клетки"));
    } else if (hit === 0) {
      selection.textContent = noSelection;
    } else {
      const [worldX,worldY,tileX,tileY] = result();
      selection.textContent = `Клетка ${tileX}, ${tileY} · X ${worldX.toFixed(2)} · Y ${worldY.toFixed(2)}`;
    }
  });
  await render();
  show("Кадр готов", "ready");
}

if (navigator.gpu) {
  void start().catch(fail);
} else {
  show("WebGPU недоступен в этом браузере или контексте", "unsupported");
}
