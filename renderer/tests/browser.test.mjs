import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { test } from "node:test";
import { chromium } from "playwright";

const contentTypes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/main.js", ["main.js", "text/javascript"]],
  ["/fgm_scene.mjs", ["fgm_scene.mjs", "text/javascript"]],
  ["/fgm_scene.wasm", ["fgm_scene.wasm", "application/wasm"]],
  ["/sphere.fgm.json", ["sphere.fgm.json", "application/json"]],
  ["/scene.wgsl", ["scene.wgsl", "text/plain"]],
  ["/camera.html", ["camera.html", "text/html; charset=utf-8"]],
  ["/camera.js", ["camera.js", "text/javascript"]],
  ["/camera.wgsl", ["camera.wgsl", "text/plain"]],
]);
const web = new URL("../build/web/", import.meta.url);

async function runBrowser(action) {
  const server = createServer(async (request, response) => {
    const asset = contentTypes.get(request.url);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await readFile(new URL(asset[0], web));
      response.writeHead(200, { "Content-Type": asset[1] }).end(bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const browser = await chromium.launch({
      executablePath: process.env.FGM_CHROMIUM,
      channel: process.env.FGM_CHROMIUM ? undefined : "chromium",
      args: ["--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    });
    try {
      await action(browser, `http://127.0.0.1:${server.address().port}/`);
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const pixels = page => page.locator("canvas").evaluate(canvas =>
  [...canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data]);

async function ready(page, frame) {
  await page.waitForFunction(expected => {
    const state = document.querySelector("[role=status]").dataset.state;
    return ["error", "unsupported"].includes(state) ||
      (state === "ready" && document.querySelector("canvas").dataset.frame === expected);
  }, String(frame), { timeout: 25000 });
  const status = page.getByRole("status");
  assert.equal(await status.getAttribute("data-state"), "ready", await status.innerText());
}

test("кадр WASM и WebGPU совпадает с нативным, устройство восстанавливается", { timeout: 70000 }, async () => {
  const native = await readFile(process.env.FGM_NATIVE_FRAME ?? "build/native/sphere.ppm");
  const header = Buffer.from("P6\n128 128\n255\n");
  assert.deepEqual(native.subarray(0, header.length), header);
  const rgb = native.subarray(header.length);
  assert.equal(rgb.length, 128 * 128 * 3);
  await runBrowser(async (browser, url) => {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    await ready(page, 1);
    const first = await pixels(page);
    assert.deepEqual(first.slice(0, 4), [15, 22, 34, 255]);
    assert.notDeepEqual(first.slice(4 * (64 * 128 + 64), 4 * (64 * 128 + 64) + 4), first.slice(0, 4));
    const browserRgb = Buffer.alloc(rgb.length);
    for (let i = 0; i < first.length; i += 4) {
      assert.equal(first[i + 3], 255);
      browserRgb.set(first.slice(i, i + 3), i / 4 * 3);
    }
    assert.deepEqual(browserRgb, rgb);
    await page.getByRole("button").click();
    await ready(page, 2);
    assert.deepEqual(await pixels(page), first);
    assert.deepEqual(errors, []);
    if (process.env.FGM_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.FGM_BROWSER_SCREENSHOT });
  });
});

test("страница объясняет отсутствие WebGPU", { timeout: 35000 }, async () => {
  await runBrowser(async (browser, url) => {
    const page = await browser.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, "gpu", { value: undefined }));
    await page.goto(url);
    const status = page.getByRole("status");
    assert.equal(await status.getAttribute("data-state"), "unsupported");
    assert.match(await status.innerText(), /WebGPU недоступен/);
    await page.goto(new URL("camera.html", url).href);
    assert.equal(await status.getAttribute("data-state"), "unsupported");
    assert.match(await status.innerText(), /WebGPU недоступен/);
  });
});

test("устройство восстанавливается при потере до первого кадра", { timeout: 35000 }, async () => {
  await runBrowser(async (browser, url) => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      if (!navigator.gpu) return;
      const createPipeline = GPUDevice.prototype.createComputePipelineAsync;
      let first = true;
      GPUDevice.prototype.createComputePipelineAsync = function (...args) {
        if (first) {
          first = false;
          this.destroy();
          return Promise.reject(new Error("Устройство потеряно до первого кадра"));
        }
        return createPipeline.apply(this, args);
      };
    });
    await page.goto(url);
    await page.locator("canvas[data-frame='1']").waitFor({ timeout: 25000 });
    await ready(page, 1);
  });
});

test("камера карты поворачивает WebGPU-кадр и сохраняет мировую точку при зуме", { timeout: 70000 }, async () => {
  await runBrowser(async (browser, url) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const response = await page.goto(new URL("camera.html", url).href);
    assert.equal(response.status(), 200, "страница камеры входит в браузерный пакет");
    await ready(page, 1);
    const canvas = page.locator("canvas");
    const bounds = await canvas.boundingBox();
    assert.deepEqual([bounds.width, bounds.height], [640, 400]);
    const first = await canvas.screenshot();
    const orbit = [[284,130],[500,202],[356,310],[140,238]];
    for (let turn = 0; turn < orbit.length; ++turn) {
      const [x, y] = orbit[turn];
      await page.mouse.click(bounds.x + x, bounds.y + y);
      assert.equal(await page.locator("#selection").textContent(), "Клетка 0, 0 · X 7.50 · Y 7.50");
      const image = await canvas.screenshot();
      const gold = await canvas.evaluate((element, { x, y }) =>
        [...element.getContext("2d").getImageData(x, y, 1, 1).data], { x, y: y-54 });
      assert.deepEqual(gold, [229,181,98,255]);
      if (turn > 0) assert.notDeepEqual(image, first);
      await page.getByRole("button", { name: "Повернуть вправо" }).click();
      await ready(page, turn+2);
    }
    assert.deepEqual(await canvas.screenshot(), first);
    const [x, y] = orbit[0];
    await page.mouse.move(bounds.x + x, bounds.y + y);
    await page.mouse.wheel(0, -100);
    await ready(page, 6);
    await page.mouse.click(bounds.x + x, bounds.y + y);
    assert.equal(await page.locator("#selection").textContent(), "Клетка 0, 0 · X 7.50 · Y 7.50");
    assert.notDeepEqual(await canvas.screenshot(), first);
    await page.getByRole("button", { name: "Сбросить камеру" }).click();
    await ready(page, 7);
    assert.deepEqual(await canvas.screenshot(), first);
    await page.mouse.click(bounds.x+10, bounds.y+10);
    assert.equal(await page.locator("#selection").textContent(), "Клетка не выбрана");
    await page.setViewportSize({ width: 480, height: 750 });
    const resized = await canvas.boundingBox();
    await page.mouse.click(resized.x+x*resized.width/640, resized.y+y*resized.height/400);
    assert.match(await page.locator("#selection").textContent(), /^Клетка 0, 0 /);
    assert.deepEqual(errors, []);
    if (process.env.FGM_CAMERA_SCREENSHOT) {
      await page.setViewportSize({ width: 900, height: 750 });
      await page.screenshot({ path: process.env.FGM_CAMERA_SCREENSHOT });
    }
  });
});
