import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import {ASSETS, MANIFEST, PLATFORM, siteURL, verifyPublishedAssets, smokeStudio, assertObsoleteCameraResponse, selectLegacyFullDoor} from './studio-pages.live.mjs';
import {localBrowserContext} from './local-browser.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hashesOf = files => Object.fromEntries([...files].map(([name, bytes]) => [name, digest(bytes)]));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.name=Studio HTTP Test',
  '-c', 'user.email=studio@example.invalid', '-c', 'commit.gpgsign=false', ...args],
  {encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}).trim();

async function serve(files, special = {}) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (!path.startsWith('/fgm-platform/')) { res.writeHead(404).end(); return; }
    const name = path.slice('/fgm-platform/'.length) || 'index.html';
    if (name === special.redirect) { res.writeHead(302, {Location:'/elsewhere/'}).end(); return; }
    const bytes = files.get(name);
    if (!bytes || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const type = name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.wasm') ?
      'application/wasm' : name.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
    const payload=special.gzip?gzipSync(bytes):bytes;
    res.writeHead(200, {'Content-Type':type, 'Cache-Control':'no-store', 'Content-Length':payload.length,
      ...(special.gzip?{'Content-Encoding':'gzip'}:{})}).end(payload);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {site:'http://127.0.0.1:' + server.address().port + '/fgm-platform/',
    close:() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();})};
}

test('HTTP admission binds actual responses to independently expected hashes and Git TREE', async t => {
  const repo = await mkdtemp(join(tmpdir(), 'fgmp-http-'));
  try {
    git(repo, 'init', '--quiet', '--initial-branch=main');
    await mkdir(join(repo, 'renderer/studio'), {recursive:true});
    const engine = JSON.parse(await readFile(join(PLATFORM, 'renderer/studio/engine-lock.json')));
    await writeFile(join(repo, 'renderer/studio/engine-lock.json'), JSON.stringify(engine));
    git(repo, 'add', '-A'); git(repo, 'commit', '--quiet', '-m', 'Synthetic Platform source');
    const revision = git(repo, 'rev-parse', 'HEAD'), tree = git(repo, 'rev-parse', 'HEAD^{tree}');
    const version = '1.0';
    const makeFiles = () => {
      const files = new Map(ASSETS.map(name => [name, Buffer.from('synthetic')]));
      files.set('index.html', Buffer.from('<code id="studio-version" title="Platform ' + revision +
        ' / TREE ' + tree + '">Версия ' + version + '</code>'));
      files.set('engine/fgmr-studio.wasm', Buffer.from('0061736d01000000', 'hex'));
      files.set(MANIFEST, Buffer.from(JSON.stringify({schema:'fgmp-studio-pages/1',
        platform:{revision, tree}, engine, version, assets:hashesOf(files)})));
      return files;
    };
    const changeManifest = (files, fn) => {
      const m = JSON.parse(files.get(MANIFEST)); fn(m);
      files.set(MANIFEST, Buffer.from(JSON.stringify(m)));
    };
    const check = async (mutate, error, options = {}) => {
      const files = makeFiles(), original = hashesOf(files);
      mutate(files);
      const server = await serve(files, options);
      try {
        const promise = verifyPublishedAssets({site:server.site, repo, revision, version,
          hashes:options.original ? original : hashesOf(files)});
        if (error) await assert.rejects(promise, new RegExp(error));
        else assert.equal((await promise).tree, tree);
      } finally {await server.close();}
    };
    await t.test('correct actual HTTP package passes', () => check(() => {}));
    await t.test('gzip wire bytes decode to the same expected artifact hashes', () => check(() => {}, null, {gzip:true}));
    await t.test('well-formed wrong TREE and rewritten manifest are rejected', () => check(files => {
      changeManifest(files, m => {m.platform.tree = 'e'.repeat(40);});
    }, 'SOURCE_TREE'));
    await t.test('legacy schema is rejected', () => check(files => {
      changeManifest(files, m => {m.schema = 'fgmv-studio-pages/3';});
    }, 'MANIFEST'));
    await t.test('missing asset is rejected', () => check(files => {
      files.delete('whole-ui.mjs');
    }, 'ALLOWLIST'));
    await t.test('changed and rehashed asset fails the independent release hashes', () => check(files => {
      files.set('studio-app.mjs', Buffer.from('rehashed replacement'));
      changeManifest(files, m => {m.assets['studio-app.mjs'] = digest(files.get('studio-app.mjs'));});
    }, 'DIGEST', {original:true}));
    await t.test('false manifest asset digest is rejected', () => check(files => {
      changeManifest(files, m => {m.assets['studio-app.mjs'] = '0'.repeat(64);});
    }, 'ASSET_DIGEST'));
    await t.test('well-formed wrong version is rejected', () => check(files => {
      changeManifest(files, m => {m.version = '1.999';});
    }, 'VERSION'));
    await t.test('rehashed wrong version badge is rejected', () => check(files => {
      files.set('index.html', Buffer.from('<code>wrong badge</code>'));
      changeManifest(files, m => {m.assets['index.html'] = digest(files.get('index.html'));});
    }, 'VERSION_BADGE'));
    await t.test('wrong engine contract is rejected', () => check(files => {
      changeManifest(files, m => {m.engine.workerProtocol = 2;});
    }, 'ENGINE'));
    await t.test('invalid but rehashed WASM is rejected', () => check(files => {
      files.set('engine/fgmr-studio.wasm', Buffer.from('wrong'));
      changeManifest(files, m => {m.assets['engine/fgmr-studio.wasm'] = digest(files.get('engine/fgmr-studio.wasm'));});
    }, 'WASM'));
    await t.test('HTTP redirect is rejected without following it', () => check(() => {}, 'HTTP', {redirect:'index.html'}));
    await t.test('missing manifest response is rejected', async () => {
      const files = makeFiles(), hashes = hashesOf(files); files.delete(MANIFEST);
      const server = await serve(files);
      try {await assert.rejects(verifyPublishedAssets({site:server.site, hashes, revision, version, repo}), /HTTP/);}
      finally {await server.close();}
    });
    await t.test('unexpected path in trusted hash map is rejected', async () => {
      const files = makeFiles(), server = await serve(files);
      try {await assert.rejects(verifyPublishedAssets({site:server.site, hashes:{...hashesOf(files), '../private.bin':'0'.repeat(64)},
        revision, version, repo}), /ALLOWLIST/);}
      finally {await server.close();}
    });
    await t.test('non-site, malformed and unrelated origin URLs are rejected', () => {
      for (const url of ['https://unrelated.example.invalid/', 'https://github.com/other-owner/other-repository/',
        'https://example.invalid/', 'https://netkeep80.github.io/fgm-platform/?redirect=1',
        'http://127.0.0.1/fgm-platform', 'http://user@127.0.0.1/fgm-platform/']) {
        assert.throws(() => siteURL(url), /URL/);
      }
    });
  } finally {await rm(repo, {recursive:true, force:true});}
});

test('missing historical camera.html is fail-closed except exact Pages 503 CDN response', () => {
  const published='https://netkeep80.github.io/fgm-platform/';
  const local='http://127.0.0.1:9911/fgm-platform/';
  assert.doesNotThrow(()=>assertObsoleteCameraResponse(404,published));
  assert.doesNotThrow(()=>assertObsoleteCameraResponse(404,local));
  assert.doesNotThrow(()=>assertObsoleteCameraResponse(503,published));
  for(const code of [200,201,301,302,401,403,500,502,504]){
    assert.throws(()=>assertObsoleteCameraResponse(code,published),/E_STUDIO_LIVE_OBSOLETE_CAMERA_STATUS/);
    assert.throws(()=>assertObsoleteCameraResponse(code,local),/E_STUDIO_LIVE_OBSOLETE_CAMERA_STATUS/);
  }
  assert.throws(()=>assertObsoleteCameraResponse(503,local),/E_STUDIO_LIVE_OBSOLETE_CAMERA_STATUS/);
  assert.throws(()=>assertObsoleteCameraResponse(503,'https://other.github.io/fgm-platform/'),/E_STUDIO_LIVE_URL/);
});

// The existing Chromium job also exercises the selector used by signed 1.17 fallback.
if (process.env.STUDIO_REVIEW_SITE) test('legacy fallback selects the full door from two native options', {timeout:30000}, async () => {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  try {
    const network = await localBrowserContext(browser), page = await network.context.newPage();
    await page.setContent('<!doctype html><html lang="ru"><select id="catalog-element">' +
      '<option value="right-half" selected>Дверь (BARN № 0) · правая половина кадра</option>' +
      '<option value="full-door">Дверь (BARN № 0)</option></select></html>');
    const elements = page.locator('#catalog-element');
    assert.equal(await elements.inputValue(), 'right-half');
    const ambiguous = elements.getByRole('option', {name:/Дверь/});
    assert.equal(await ambiguous.count(), 2);
    await assert.rejects(ambiguous.getAttribute('value'), /strict mode violation/);
    await selectLegacyFullDoor(elements);
    assert.equal(await elements.inputValue(), 'full-door');
    assert.equal(await elements.evaluate(select => select.selectedOptions[0].label), 'Дверь (BARN № 0)');
    network.assertLocal();
    console.log('PLATFORM_FALLBACK_LEGACY_DOOR_SELECTOR_PASS');
  } finally {await browser.close();}
});

// Native jobs run the real HTTP negatives. The existing WASM job supplies its actual prepared package.
if (process.env.STUDIO_REVIEW_SITE) test('prepared Platform package executes the same HTTP/WASM smoke used for release', {timeout:120000}, async () => {
  const directory = resolve(process.env.STUDIO_REVIEW_SITE);
  const files = new Map(await Promise.all([...ASSETS, MANIFEST].map(async name => [name, await readFile(join(directory, name))])));
  const manifest = JSON.parse(files.get(MANIFEST)), hashes = hashesOf(files), server = await serve(files, {gzip:true});
  try {
    const revision = git(PLATFORM, 'rev-parse', 'HEAD');
    const verified = await verifyPublishedAssets({site:server.site, hashes, revision, version:manifest.version});
    await smokeStudio(verified);
    // A response changed after the independent HTTP scan must not execute in the browser.
    const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
    try {
      const network = await localBrowserContext(browser, verified.site, hashes), page = await network.context.newPage();
      files.set('studio-app.mjs', Buffer.from('globalThis.replaced = true;'));
      const tampered = new URL('studio-app.mjs', server.site).href;
      await assert.rejects(page.goto(tampered), /ERR_BLOCKED_BY_CLIENT/);
      assert.deepEqual(network.denied, [tampered]);
      console.log('PLATFORM_BROWSER_CHANGED_AFTER_HTTP_SCAN_REJECTED');
      // Deliberately request an unrelated HTTPS origin in real Chromium; no old FGM repo is needed.
      const foreign = 'https://unrelated.example.invalid/';
      await assert.rejects(page.goto(foreign), /ERR_BLOCKED_BY_CLIENT/);
      assert.deepEqual(network.denied, [tampered, foreign]);
      console.log('PLATFORM_BROWSER_CROSS_ORIGIN_DENY_PASS');
    } finally {await browser.close();}
    console.log('PLATFORM_REVIEW_HTTP_WASM_SMOKE_PASS');
  } finally {await server.close();}
});
