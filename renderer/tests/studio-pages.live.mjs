import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { writeStudioUfoCatalogFixture } from "./studio-ufo-catalog.fixture.mjs";
import { localBrowserContext } from "./local-browser.mjs";

export const ASSETS = Object.freeze(["index.html", "studio-app.mjs", "whole-ui.mjs", "renderer-session.mjs", "r05-view.mjs",
  "synthetic.mjs", "ufo-catalog.mjs", "engine/worker.mjs", "engine/fgmr-studio.mjs", "engine/fgmr-studio.wasm"]);
export const MANIFEST = "studio-manifest.json";
export const PLATFORM = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const sortedKeys = value => Object.keys(value).sort();
const ensure = (ok, code) => assert.ok(ok, "E_STUDIO_LIVE_" + code);

export function siteURL(value = "https://netkeep80.github.io/fgm-platform/") {
  const site = new URL(value);
  ensure(!site.username && !site.password && !site.search && !site.hash && site.pathname.endsWith("/"), "URL");
  ensure(site.href === "https://netkeep80.github.io/fgm-platform/" ||
    site.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(site.hostname), "URL");
  return site;
}

export async function verifyPublishedAssets({site, hashes, revision, version, repo = PLATFORM, cacheKey = "review"}) {
  site = siteURL(site);
  ensure(typeof revision === "string" && /^[a-f0-9]{40}$/.test(revision), "REVISION");
  ensure(typeof version === "string" && /^[1-9][0-9]*\.(0|[1-9][0-9]*)$/.test(version), "VERSION");
  ensure(/^[a-zA-Z0-9_-]{1,64}$/.test(cacheKey), "CACHE_KEY");
  ensure(hashes && typeof hashes === "object" && !Array.isArray(hashes), "EXPECTED_HASHES");
  assert.deepEqual(sortedKeys(hashes), [...ASSETS, MANIFEST].sort(), "E_STUDIO_LIVE_ALLOWLIST");
  ensure(Object.values(hashes).every(x => typeof x === "string" && /^[a-f0-9]{64}$/.test(x)), "EXPECTED_HASHES");
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  ensure(git("rev-parse", "--verify", revision + "^{commit}") === revision, "REVISION");
  const tree = git("rev-parse", revision + "^{tree}");
  const engine = JSON.parse(git("show", revision + ":renderer/studio/engine-lock.json"));
  const files = new Map(); let total = 0;
  for (const name of [...ASSETS, MANIFEST]) {
    const url = new URL(name, site); url.searchParams.set("release", cacheKey);
    const response = await fetch(url, {redirect: "manual", signal: AbortSignal.timeout(15000)});
    ensure(response.status === 200, "HTTP:" + name);
    const chunks = [];
    for await (const chunk of response.body) {
      total += chunk.byteLength;
      ensure(total <= 16 * 1024 * 1024, "SIZE");
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    ensure(bytes.length > 0 && sha256(bytes) === hashes[name], "DIGEST:" + name);
    files.set(name, bytes);
  }
  const manifest = JSON.parse(files.get(MANIFEST));
  assert.deepEqual(sortedKeys(manifest), ["schema", "platform", "engine", "assets", "version"].sort(), "E_STUDIO_LIVE_MANIFEST");
  ensure(manifest.schema === "fgmp-studio-pages/1", "MANIFEST");
  assert.deepEqual(manifest.platform, {revision, tree}, "E_STUDIO_LIVE_SOURCE_TREE");
  assert.deepEqual(manifest.engine, engine, "E_STUDIO_LIVE_ENGINE");
  ensure(manifest.version === version, "VERSION");
  assert.deepEqual(manifest.assets, Object.fromEntries(ASSETS.map(name => [name, hashes[name]])), "E_STUDIO_LIVE_ASSET_DIGEST");
  ensure(files.get("engine/fgmr-studio.wasm").subarray(0, 8).equals(Buffer.from("0061736d01000000", "hex")), "WASM");
  const title = `Platform ${revision} / TREE ${tree}`;
  ensure(files.get("index.html").includes(Buffer.from(`<code id="studio-version" title="${title}">Версия ${version}</code>`)), "VERSION_BADGE");
  console.log("PLATFORM_HTTP_ASSETS_PASS: exact Git revision/TREE, version and all independently expected hashes");
  return {site, hashes, revision, tree, version, title, cacheKey};
}

export async function smokeStudio(verified) {
  const {site, version: expectedVersion, title, cacheKey} = verified;
  const browser = await chromium.launch({headless: true, args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  try {
    const network = await localBrowserContext(browser, site, verified.hashes);
    const page = await network.context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const entry = new URL(site);
    entry.searchParams.set("release", cacheKey);
    const response = await page.goto(entry.href);
    assert.equal(response.status(), 200);
    assert.match(await page.title(), /Reconstruction Studio/);
    const version = page.locator("#studio-version");
    assert.equal(await version.isVisible(), true);
    assert.equal(await version.textContent(), "Версия " + expectedVersion);
    assert.equal(await version.getAttribute("title"), title);
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
    assert.equal(await page.locator("#whole-views canvas").count(),4);
    const views=JSON.parse(await page.locator("#whole-view-receipt").textContent());
    assert.equal(views.model_sha256,whole.model_sha256);
    assert.equal(views.backend,"webgpu");
    assert.equal(views.stage_a,"NOT_ACCEPTED");
    console.log("PLATFORM_HTTP_WHOLE_OBJECT_UI_PASS");
    assert.equal(await page.locator("a[href$='/camera.html']").count(), 0);
    const obsolete = await page.request.get(new URL("camera.html?release=" + cacheKey, site).href,
      {maxRedirects: 0});
    assert.equal(obsolete.status(), 404);
    assert.deepEqual(pageErrors, []);
    network.assertLocal();
    await mkdir("build", {recursive: true});
    await page.screenshot({path: "build/studio-http-smoke.png", fullPage: true});
    // The same test supports review HTTP and future deployed HTTPS; neither implies author acceptance.
    console.log("PLATFORM_STUDIO_HTTP_WASM_SMOKE_PASS");
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verified = await verifyPublishedAssets({site: process.env.PAGES_URL,
    hashes: JSON.parse(process.env.PAGES_HASHES), revision: process.env.PAGES_REVISION || process.env.GITHUB_SHA,
    version: process.env.PAGES_VERSION, cacheKey: process.env.GITHUB_RUN_ID || "review"});
  await smokeStudio(verified);
}
