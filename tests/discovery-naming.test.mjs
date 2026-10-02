// Group B — discovery naming normalization.
// Canonical names: offers.list, requirements.check, credits.options.
// Phantom or misnamed entries (offer.list, requirement.check, credit.options,
// service.list, machine_capability.quote) must not appear in capability lists,
// tool registrations, or user-facing descriptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';

const serverSource=fs.readFileSync(new URL('../server-runtime.mjs',import.meta.url),'utf8');
const marketplaceToolsSource=fs.readFileSync(new URL('../lib/marketplace-tools.mjs',import.meta.url),'utf8');

test('publicCapabilityList uses canonical tool names only',()=>{
  const normalized=serverSource.replace(/["']/g,'"');
  for(const canonical of ['["offers.list"','["requirements.check"','["credits.options"']){
    assert.ok(normalized.includes(canonical),`missing canonical name ${canonical}`);
  }
  for(const phantom of ['["offer.list"','["requirement.check"','["credit.options"','["service.list"']){
    assert.ok(!normalized.includes(phantom),`phantom name still present: ${phantom}`);
  }
});

test('marketplace tool descriptions use canonical names',()=>{
  assert.ok(!marketplaceToolsSource.includes('machine_capability.quote'),'machine_capability.quote phantom still referenced');
  assert.ok(!marketplaceToolsSource.includes('offer.list'),'offer.list phantom still referenced in marketplace descriptions');
});

test('live tools/list matches canonical discovery names',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-naming-'));
  fs.mkdirSync(path.join(dir,'data'));
  const files={catalog:path.join(dir,'data','stripe_catalog.json'),credits:path.join(dir,'data','credit_links.json'),fulfillment:path.join(dir,'data','fulfillment_map.json'),services:path.join(dir,'data','request_services.json'),state:path.join(dir,'data','state.json'),commerce:path.join(dir,'data','commerce.json'),marketplace:path.join(dir,'data','marketplace.json'),funnel:path.join(dir,'data','funnel.sqlite3')};
  fs.writeFileSync(files.catalog,JSON.stringify({offers:[{id:'naming-offer',name:'Naming Offer',kind:'service',description:'naming fixture',price_usd:5,checkout_url:'https://checkout.example/naming'}]}));
  fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));
  fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));
  fs.writeFileSync(files.services,JSON.stringify({services:[]}));
  fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
  fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
  const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const child=spawn(process.execPath,[path.join(process.cwd(),'server.mjs')],{cwd:dir,env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal(ready,true);
  let session;let id=0;
  async function rpc(method,params={}){
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
    if(session)headers['mcp-session-id']=session;
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    assert.equal(response.status,200);
    session=response.headers.get('mcp-session-id')||session;
    const text=await response.text();
    const data=text.split('\n').find(line=>line.startsWith('data:'))?.slice(5);
    return JSON.parse(data||text);
  }
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'naming',version:'1'}});
  await rpc('notifications/initialized');
  const names=(await rpc('tools/list')).result.tools.map(x=>x.name);
  for(const canonical of ['offers.list','requirements.check','credits.options']) assert.ok(names.includes(canonical),`missing ${canonical}`);
  for(const phantom of ['offer.list','requirement.check','credit.options','service.list','machine_capability.quote']) assert.ok(!names.includes(phantom),`phantom tool visible: ${phantom}`);
  // credits.options is callable and free
  const credits=await rpc('tools/call',{name:'credits.options',arguments:{}});
  assert.equal(credits.result.structuredContent.free,true);
  assert.equal(credits.result.structuredContent.payment_started,false);
  assert.ok(Array.isArray(credits.result.structuredContent.packs));
  // item_id resolution: capability names and offer ids resolve through discovery
  for(const item_id of ['x402.compatibility_audit','naming-offer']){
    const req=await rpc('tools/call',{name:'requirements.check',arguments:{item_id}});
    assert.equal(req.result.structuredContent.found,true,`${item_id} should resolve`);
  }
});
