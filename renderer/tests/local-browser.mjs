// Shared real-browser network boundary: local fixtures or one exact Studio site.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export async function localBrowserContext(browser,site=null,hashes=null){
  const context=await browser.newContext(),denied=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    const allowed=site?url.origin===site.origin&&url.pathname.startsWith(site.pathname):
      url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if(['blob:','data:'].includes(url.protocol))return route.continue();
    if(request.method()==='GET'&&allowed){
      if(!hashes)return route.continue();
      const name=url.pathname.slice(site.pathname.length)||'index.html';
      if(Object.hasOwn(hashes,name)){
        try{
          const response=await route.fetch({maxRedirects:0,timeout:15000}),bytes=await response.body();
          if(response.status()===200&&createHash('sha256').update(bytes).digest('hex')===hashes[name])
            return route.fulfill({response,body:bytes});
        }catch{}
      }
    }
    denied.push(url.href);return route.abort('blockedbyclient');
  });
  return {context,denied,assertLocal:()=>assert.deepEqual(denied,[],'unexpected external browser request')};
}
