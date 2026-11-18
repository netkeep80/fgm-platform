// Shared real-browser network boundary: local synthetic assets only.
import assert from 'node:assert/strict';
export async function localBrowserContext(browser){
  const context=await browser.newContext(),denied=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(['blob:','data:'].includes(url.protocol)||
      url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return route.continue();
    denied.push(url.href);return route.abort('blockedbyclient');
  });
  return {context,denied,assertLocal:()=>assert.deepEqual(denied,[],'unexpected external browser request')};
}
