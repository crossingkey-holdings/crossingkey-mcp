// Group D — approval/idempotency/receipt/entitlement verification surfaces.
// These tools are read-only and buyer-authenticated. Approval minting stays a
// local-operator action and must never appear as an MCP tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';

const VERIFY_TOOLS=['approval.verify','idempotency.inspect','receipt.verify','entitlement.inspect'];

async function boot(t,{authenticated}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-verify-'));
  fs.mkdirSync(path.join(dir,'data'));
  const files={catalog:path.join(dir,'data','stripe_catalog.json'),credits:path.join(dir,'data','credit_links.json'),fulfillment:path.join(dir,'data','fulfillment_map.json'),services:path.join(dir,'data','request_services.json'),state:path.join(dir,'data','state.json'),commerce:path.join(dir,'data','commerce.json'),marketplace:path.join(dir,'data','marketplace.json'),funnel:path.join(dir,'data','funnel.sqlite3'),auth:path.join(dir,'data','marketplace-auth.json')};
  fs.writeFileSync(files.catalog,JSON.stringify({offers:[]}));
  fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));
  fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));
  fs.writeFileSync(files.services,JSON.stringify({services:[]}));
  fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
  fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
  const token=crypto.randomBytes(32).toString('hex');
  const hash=crypto.createHash('sha256').update(token).digest('hex');
  fs.writeFileSync(files.auth,JSON.stringify({principals:{[hash]:{id:'buyer-1',role:'buyer',buyerReference:'buyer-1',expiresAt:new Date(Date.now()+3600000).toISOString()}}}));
  const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const child=spawn(process.execPath,[path.join(process.cwd(),'server.mjs')],{cwd:dir,env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,MARKETPLACE_AUTH_FILE:files.auth,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal(ready,true);
  let session;let id=0;
  async function rpc(method,params={}){
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
    if(authenticated)headers.authorization=`Bearer ${token}`;
    if(session)headers['mcp-session-id']=session;
    const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    assert.equal(response.status,200);
    session=response.headers.get('mcp-session-id')||session;
    const text=await response.text();
    const data=text.split('\n').find(line=>line.startsWith('data:'))?.slice(5);
    return JSON.parse(data||text);
  }
  return {rpc};
}

test('verification tools are hidden from anonymous sessions',async t=>{
  const {rpc}=await boot(t);
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'verify',version:'1'}});
  await rpc('notifications/initialized');
  const names=(await rpc('tools/list')).result.tools.map(x=>x.name);
  for(const name of VERIFY_TOOLS) assert.ok(!names.includes(name),`${name} must not be visible anonymously`);
  assert.ok(!names.some(n=>/approv/i.test(n)&&n!=='approval.verify'),`no approval-minting tool may exist: ${names.filter(n=>/approv/i.test(n))}`);
});

test('buyer session sees verification tools and can probe safely',async t=>{
  const {rpc}=await boot(t,{authenticated:true});
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'verify',version:'1'}});
  await rpc('notifications/initialized');
  const listed=(await rpc('tools/list')).result.tools;
  const names=listed.map(x=>x.name);
  for(const name of VERIFY_TOOLS){
    const tool=listed.find(x=>x.name===name);
    assert.ok(tool,`${name} must be visible to a buyer`);
    assert.equal(tool.annotations.readOnlyHint,true,`${name} must be read-only`);
    assert.ok(tool.outputSchema,`${name} must expose an outputSchema`);
  }
  // No approval minting tool exists even for authenticated buyers.
  assert.ok(!names.some(n=>n!=='approval.verify'&&/approv/i.test(n)),'approval minting must stay off-MCP');

  // Idempotency probe on a fresh key: nothing exists, nothing created.
  const probe=await rpc('tools/call',{name:'idempotency.inspect',arguments:{idempotencyKey:'buyer-probe-key-0001'}});
  assert.equal(probe.result.isError||false,false);
  assert.equal(probe.result.structuredContent.exists,false);
  assert.equal(probe.result.structuredContent.duplicateSafe,true);

  // Unknown approval/receipt/entitlement: soft nulls, not errors, no leak.
  const approval=await rpc('tools/call',{name:'approval.verify',arguments:{approvalId:'approval_nope'}});
  assert.equal(approval.result.isError||false,false);
  assert.equal(approval.result.structuredContent.approval,null);

  const receipt=await rpc('tools/call',{name:'receipt.verify',arguments:{receiptId:'rcpt_nope'}});
  assert.equal(receipt.result.isError||false,false);
  assert.equal(receipt.result.structuredContent.found,false);

  const entitlement=await rpc('tools/call',{name:'entitlement.inspect',arguments:{entitlementId:'ent_nope'}});
  assert.equal(entitlement.result.isError||false,false);
  assert.equal(entitlement.result.structuredContent.entitlement,null);

  // Malformed idempotency key is rejected at the input-validation layer
  // (never reaches the handler, no stack trace).
  const bad=await rpc('tools/call',{name:'idempotency.inspect',arguments:{idempotencyKey:'bad!'}});
  assert.equal(bad.result.isError,true);
  const badText=bad.result.content.map(c=>c.text).join(' ');
  assert.ok(/invalid/i.test(badText),`expected an invalid-input message, got ${badText.slice(0,160)}`);
  assert.ok(!/\n\s*at\s/.test(badText)&&!badText.includes('node:internal'),'no stack trace may leak');
});
