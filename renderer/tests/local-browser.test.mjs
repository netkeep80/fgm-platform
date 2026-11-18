import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {localBrowserContext} from './local-browser.mjs';
test('real Chromium denies requests to all three retired repository origins',async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.FGM_CHROMIUM,args:['--no-sandbox']});
  try{
    const network=await localBrowserContext(browser),page=await network.context.newPage();
    for(const name of ['fgm-core','fgm-regenerator','fgm-renderer']){
      const url='https://github.com/netkeep80/'+name;
      await assert.rejects(page.goto(url),/ERR_BLOCKED_BY_CLIENT/);
      assert.ok(network.denied.includes(url));
    }
    assert.equal(network.denied.length,3);
    assert.throws(network.assertLocal,/unexpected external browser request/);
    console.log('OLD_REPO_BROWSER_DENY_PASS: three real Chromium requests blocked before network');
  }finally{await browser.close();}
});
