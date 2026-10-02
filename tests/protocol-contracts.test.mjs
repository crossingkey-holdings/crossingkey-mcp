// Group A — protocol/schema correctness.
// Every registered tool must expose an outputSchema; xkey.validate must carry
// idempotentHint; discovery tools must validate their structured output.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';

function bootServer(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-proto-contracts-'));
  fs.mkdirSync(path.join(dir,'data'));
  const files={
    catalog:path.join(dir,'data','stripe_catalog.json'),
    credits:path.join(dir,'data','credit_links.json'),
    fulfillment:path.join(dir,'data','fulfillment_map.json'),
    services:path.join(dir,'data','request_services.json'),
    state:path.join(dir,'data','state.json'),
    commerce:path.join(dir,'data','commerce.json'),
    marketplace:path.join(dir,'data','marketplace.json'),
    funnel:path.join(dir,'data','funnel.sqlite3')
  };
  fs.writeFileSync(files.catalog,JSON.stringify({offers:[{id:'proto-offer',name:'Proto Offer',kind:'service',description:'Protocol contract fixture',price_usd:10,checkout_url:'https://checkout.example/proto'}]}));
  fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));
  fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));
  fs.writeFileSync(files.services,JSON.stringify({services:[]}));
  fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
  fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
  return {dir,files};
}

async function startServer(t,files){
  const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const child=spawn(process.execPath,[path.join(process.cwd(),'server.mjs')],{cwd:path.dirname(path.dirname(files.catalog)),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal(ready,true,'server did not become ready');
  let session;let id=0;
  async function rpc(method,params={}){
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
    if(session)headers['mcp-session-id']=session;
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    assert.equal(response.status,200,`${method} http status`);
    session=response.headers.get('mcp-session-id')||session;
    const text=await response.text();
    const data=text.split('\n').find(line=>line.startsWith('data:'))?.slice(5);
    return JSON.parse(data||text);
  }
  return {rpc,port};
}

test('every registered tool exposes an outputSchema',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const listed=(await rpc('tools/list')).result.tools;
  assert.ok(listed.length>=12,`expected at least 12 tools, got ${listed.length}`);
  for(const tool of listed){
    assert.ok(tool.outputSchema,`tool ${tool.name} is missing outputSchema`);
    assert.equal(tool.outputSchema.type,'object',`tool ${tool.name} outputSchema should be an object schema`);
  }
});

test('xkey.validate carries idempotentHint and a title',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const listed=(await rpc('tools/list')).result.tools;
  const xkey=listed.find(x=>x.name==='xkey.validate');
  assert.ok(xkey);
  assert.equal(xkey.annotations.idempotentHint,true);
  assert.ok(xkey.title);
});

test('discovery tools return structured output that validates',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const call=async(name,args)=>{
    const res=await rpc('tools/call',{name,arguments:args});
    assert.ok(!res.error,`${name} rpc error: ${JSON.stringify(res.error)}`);
    return res.result;
  };
  const provider=await call('provider.describe',{});
  assert.equal(provider.structuredContent.stopBeforePayment,true);
  const offers=await call('offers.list',{limit:5});
  assert.equal(offers.structuredContent.free,true);
  assert.ok(Array.isArray(offers.structuredContent.offers));
  for(const item_id of ['proto-offer','x402.compatibility_audit','no-such-item']){
    const req=await call('requirements.check',{item_id});
    assert.equal(typeof req.structuredContent.found,'boolean');
    const cost=await call('cost.estimate',{item_id});
    assert.equal(typeof cost.structuredContent.cost_state,'string');
    const preview=await call('result.preview',{item_id});
    assert.equal(typeof preview.structuredContent.preview_state,'string');
    const preflight=await call('execution.preflight',{item_id});
    assert.equal(preflight.structuredContent.payment_started,false);
    assert.equal(preflight.structuredContent.execution_started,false);
  }
});

test('paid x402 tools expose a challenge outputSchema without spending',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const listed=(await rpc('tools/list')).result.tools;
  const audit=listed.find(x=>x.name==='x402.compatibility_audit');
  assert.ok(audit.outputSchema);
  const props=audit.outputSchema.properties||{};
  for(const key of ['payment_required','execution_mode','execution_url','payment_required_header','settlement_expectations','confirmation_expectations','instruction']){
    assert.ok(props[key],`challenge outputSchema missing ${key}`);
  }
});

test('x402 challenge states settlement and confirmation expectations',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const challenge=await rpc('tools/call',{name:'x402.compatibility_audit',arguments:{url:'https://example.com/pay'}});
  assert.equal(challenge.result.isError||false,false);
  const sc=challenge.result.structuredContent;
  assert.equal(sc.payment_required,true);
  assert.ok(sc.settlement_expectations.includes('facilitator'),'settlement expectations should name the facilitator');
  assert.ok(sc.confirmation_expectations.includes('idempotency_key'),'confirmation expectations should cover idempotent retry');
  assert.ok(sc.instruction.includes('HUMAN')||sc.instruction.includes('authorized'),'instruction should require authorization');
});

test('tool errors use the structured error_code/message/hint shape',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  // xkey.validate without a credential: gated, structured, no leak.
  const gated=await rpc('tools/call',{name:'xkey.validate',arguments:{idempotency_key:'proto-err-0001',raw_intake:'{}'}});
  assert.equal(gated.result.isError,true);
  const sc=gated.result.structuredContent;
  assert.equal(sc.error_code,'authentication_required');
  assert.equal(typeof sc.message,'string');
  assert.ok(sc.message.length>0);
  assert.equal(typeof sc.hint,'string');
  assert.ok(sc.hint.length>0);
  const text=gated.result.content.map(c=>c.text).join(' ');
  assert.ok(text.includes(sc.message),'human-readable text should carry the message');
  assert.ok(!text.includes('Error:')&&!text.includes(' at '),'error text must not leak stack traces');
  // Discovery tools stay soft on unknown items: found:false, not an error.
  const unknown=await rpc('tools/call',{name:'requirements.check',arguments:{item_id:'no-such-item'}});
  assert.equal(unknown.result.isError||false,false);
  assert.equal(unknown.result.structuredContent.found,false);
});

test('public resources expose discovery guide, commerce policy, and per-capability instructions',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {rpc}=await startServer(t,files);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proto',version:'1'}});
  await rpc('notifications/initialized');
  const listed=(await rpc('resources/list')).result.resources||[];
  const uris=listed.map(r=>r.uri);
  assert.ok(uris.includes('crossingkey://discovery-guide'),'missing discovery guide resource');
  assert.ok(uris.includes('crossingkey://commerce-policy'),'missing commerce policy resource');
  const guide=await rpc('resources/read',{uri:'crossingkey://discovery-guide'});
  const guideText=guide.result.contents.map(c=>c.text).join('\n');
  assert.ok(guideText.includes('offers.list'),'guide should name canonical discovery tools');
  assert.ok(guideText.includes('HUMAN AUTHORIZATION')||guideText.includes('Human authorization'),'guide should require human authorization');
  const policy=await rpc('resources/read',{uri:'crossingkey://commerce-policy'});
  const policyText=policy.result.contents.map(c=>c.text).join('\n');
  assert.ok(policyText.includes('Receiver-only'),'policy should state receiver-only');
  assert.ok(policyText.includes('idempotency'),'policy should cover idempotency');
  // Per-capability instructions for a known paid capability.
  const cap=await rpc('resources/read',{uri:'crossingkey://capability/x402.compatibility_audit'});
  const capText=cap.result.contents.map(c=>c.text).join('\n');
  assert.ok(capText.includes('x402.compatibility_audit'));
  assert.ok(capText.includes('HUMAN AUTHORIZATION'));
  // Unknown capability: JSON-RPC error, no leak.
  const unknown=await rpc('resources/read',{uri:'crossingkey://capability/no-such-cap'});
  assert.ok(unknown.error,'unknown capability should produce a JSON-RPC error');
});
