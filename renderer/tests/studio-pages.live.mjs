import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeStudioUfoCatalogFixture } from "./studio-ufo-catalog.fixture.mjs";

const site = new URL("https://netkeep80.github.io/fgm-renderer/");
const mode = process.env.PAGES_MODE;
assert.ok(["studio", "rollback-v03"].includes(mode));
const hashes = JSON.parse(process.env.PAGES_HASHES);
assert.ok(hashes["index.html"]);
const renderer = process.env.GITHUB_SHA;
const expectedVersion = process.env.PAGES_VERSION;
if (mode === "studio") {
  assert.match(renderer, /^[a-f0-9]{40}$/);
  assert.match(expectedVersion, /^[1-9][0-9]*\.(0|[1-9][0-9]*)$/);
  assert.match(hashes["ufo-catalog.mjs"], /^[a-f0-9]{64}$/);
  assert.match(hashes["studio-manifest.json"], /^[a-f0-9]{64}$/);
}
const cacheKey = process.env.GITHUB_RUN_ID;
assert.match(cacheKey, /^\d+$/);

const browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
try {
  const page = await browser.newPage();
  const requests = [], pageErrors = [];
  page.on("request", request => requests.push([request.method(), new URL(request.url())]));
  page.on("pageerror", error => pageErrors.push(error.message));
  for (const [name,expected] of Object.entries(hashes)) {
    const url = new URL(name, site);
    url.searchParams.set("release", cacheKey);
    const response = await page.request.get(url.href, {maxRedirects: 0, timeout: 15000});
    assert.equal(response.status(), 200, name);
    const bytes = await response.body();
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, name);
    if (mode === "studio" && name === "studio-manifest.json") {
      const manifest = JSON.parse(bytes);
      assert.equal(manifest.schema, "fgmv-studio-pages/3");
      assert.equal(manifest.renderer, renderer);
      assert.equal(manifest.version, expectedVersion);
    }
  }
  const entry = new URL(mode === "studio" ? site.href : "camera.html", site);
  entry.searchParams.set("release", cacheKey);
  const response = await page.goto(entry.href);
  assert.equal(response.status(), 200);
  if (mode === "studio") {
    assert.match(await page.title(), /Reconstruction Studio/);
    const version = page.locator("#studio-version");
    assert.equal(await version.isVisible(), true);
    assert.equal(await version.textContent(), "Версия " + expectedVersion);
    assert.equal(await version.getAttribute("title"), renderer);
    const reconstruct = async () => {
      await page.locator("#run").click();
      await page.waitForFunction(() =>
        ["COMPLETED", "ERROR"].includes(document.querySelector("#status").dataset.state));
      assert.match(await page.locator("#status").textContent(), /^COMPLETED/);
      const result = JSON.parse(await page.locator("#metrics").textContent());
      assert.equal(result.voxels_checked, 6144);
      assert.equal(await page.locator("#downloads button").count(), 4);
      return result;
    };
    await page.locator("#demo").click();
    const demo = await reconstruct();
    assert.deepEqual(demo.silhouette, {common: 1, observed_only: 1, predicted_only: 13});

    const root = await mkdtemp(join(tmpdir(), "studio-pages-ufo-"));
    try {
      await writeStudioUfoCatalogFixture(root);
      await page.locator("#directory").setInputFiles(root);
      const maps = page.locator("#catalog-map");
      await maps.selectOption("CULTA00");
      assert.equal(await maps.locator("option[value=INTICON]").count(), 0);
      const elements = page.locator("#catalog-element");
      const door = elements.getByRole("option", {name: /Дверь/});
      await door.waitFor({state: "attached"});
      await elements.selectOption(await door.getAttribute("value"));
      const result = await reconstruct();
      assert.equal(result.source.dataset_label, "BARN");
      assert.equal(result.source.local_index, 0);
      assert.equal(result.occupied, 18);
    } finally {
      await rm(root, {recursive: true, force: true});
    }

    await page.locator("#whole-demo").click();
    await page.waitForFunction(()=>!document.querySelector("#whole-run").disabled,null,{timeout:20000});
    await page.locator("#whole-run").click();
    await page.waitForFunction(()=>["COMPLETED","ERROR"].includes(document.querySelector("#whole-status").dataset.state),null,{timeout:60000});
    assert.match(await page.locator("#whole-status").textContent(),/^COMPLETED/);
    const whole=JSON.parse(await page.locator("#whole-metrics").textContent());
    assert.equal(whole.cells,4);
    assert.equal(whole.checked_centers,24576);
    assert.equal(await page.locator("#whole-downloads button").count(),5);
    console.log("DEPLOYED_WHOLE_OBJECT_UI");
    assert.equal(await page.locator("a[href$='/camera.html']").count(), 0);
    const obsolete = await page.request.get(new URL("camera.html?release=" + cacheKey, site).href,
      {maxRedirects: 0});
    assert.equal(obsolete.status(), 404);
    assert.deepEqual(pageErrors, []);
    assert.ok(requests.every(([method,url]) => method === "GET" && url.origin === site.origin &&
      (url.pathname.startsWith(site.pathname) || url.pathname === "/favicon.ico")));
    await mkdir("build", {recursive: true});
    await page.screenshot({path: "build/published-studio.png", fullPage: true});
  }
  console.log(mode === "studio" ? "DEPLOYED_STUDIO" : "ROLLBACK_RESTORED");
} finally {
  await browser.close();
}
