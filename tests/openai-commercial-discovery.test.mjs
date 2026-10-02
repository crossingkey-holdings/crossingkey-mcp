import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {FREE_DISCOVERY_TOOL_NAMES,PAID_TOOL_NAMES} from '../lib/mcp-manifest.mjs';
import {MARKETPLACE_PUBLIC_TOOL_NAMES} from '../lib/marketplace-tools.mjs';
import {validateProofAllowlist,ZERO_SPEND_PROOF_ALLOWLIST} from '../scripts/openai-commercial-discovery-proof.mjs';

test('OpenAI commercial discovery is free, strict, annotated, and stops before payment',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-openai-discovery-'));
  fs.mkdirSync(path.join(dir,'data'));
  const files={
    catalog:path.join(dir,'data','stripe_catalog.json'),credits:path.join(dir,'data','credit_links.json'),fulfillment:path.join(dir,'data','fulfillment_map.json'),services:path.join(dir,'data','request_services.json'),state:path.join(dir,'data','state.json'),commerce:path.join(dir,'data','commerce.json'),marketplace:path.join(dir,'data','marketplace.json'),funnel:path.join(dir,'data','funnel.sqlite3')
  };
  fs.writeFileSync(files.catalog,JSON.stringify({offers:[{id:'proof-offer',name:'Proof Offer',kind:'service',description:'A proof-only offer',price_usd:10,checkout_url:'https://checkout.example/proof'}]}));
  fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));fs.writeFileSync(files.services,JSON.stringify({services:[]}));
  fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
  fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
  const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const child=spawn(process.execPath,[path.join(process.cwd(),'server.mjs')],{cwd:dir,env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert.equal(ready,true);assert.equal((await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`)).status,404);
  let session;let id=0;
  async function rpc(method,params={}){const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};if(session)headers['mcp-session-id']=session;const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});assert.equal(response.status,200);session=response.headers.get('mcp-session-id')||session;const text=await response.text();const data=text.split('\n').find(line=>line.startsWith('data:'))?.slice(5);return JSON.parse(data||text);}
  const initialized=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'proof',version:'1'}});assert.match(initialized.result.instructions,/Discover capabilities and requirements first/);assert.match(initialized.result.instructions,/HUMAN AUTHORIZATION/);
  const listed=(await rpc('tools/list')).result.tools;const names=listed.map(tool=>tool.name);
  for(const name of FREE_DISCOVERY_TOOL_NAMES){const tool=listed.find(x=>x.name===name);assert.ok(tool);assert.equal(tool.annotations.readOnlyHint,true);assert.equal(tool.annotations.destructiveHint,false);assert.equal(tool.inputSchema.additionalProperties,false);}
  for(const name of PAID_TOOL_NAMES)assert.ok(names.includes(name));
  assert.deepEqual(new Set(names),new Set([...FREE_DISCOVERY_TOOL_NAMES,...PAID_TOOL_NAMES,...MARKETPLACE_PUBLIC_TOOL_NAMES]));
  const provider=(await rpc('tools/call',{name:'provider.describe',arguments:{}})).result.structuredContent;assert.equal(provider.stopBeforePayment,true);
  const offers=(await rpc('tools/call',{name:'offers.list',arguments:{limit:10}})).result.structuredContent;assert.equal(offers.free,true);assert.equal(offers.payment_started,false);
  const req=(await rpc('tools/call',{name:'requirements.check',arguments:{item_id:'proof-offer'}})).result.structuredContent;assert.equal(req.payment_required,true);
  const cost=(await rpc('tools/call',{name:'cost.estimate',arguments:{item_id:'proof-offer'}})).result.structuredContent;assert.equal(cost.cost_state,'ESTIMATE_ONLY');assert.equal(cost.payment_started,false);
  const preview=(await rpc('tools/call',{name:'result.preview',arguments:{item_id:'proof-offer'}})).result.structuredContent;assert.equal(preview.preview_state,'SHAPE_ONLY');assert.equal(preview.payment_started,false);
  const preflight=(await rpc('tools/call',{name:'execution.preflight',arguments:{item_id:'proof-offer'}})).result.structuredContent;assert.equal(preflight.state,'READY_FOR_HUMAN_AUTHORIZATION');assert.equal(preflight.execution_started,false);assert.equal(preflight.entitlement_created,false);assert.equal(preflight.receipt_created,false);
  assert.equal(fs.existsSync(files.commerce),false);assert.equal(fs.existsSync(path.join(dir,'checkout.json')),false);
  assert.equal(preflight.authorization_required,true);
});

test('zero-spend OpenAI proof allowlist cannot include paid or action tools',()=>{
  assert.doesNotThrow(()=>validateProofAllowlist(ZERO_SPEND_PROOF_ALLOWLIST));
  assert.throws(()=>validateProofAllowlist(['execution.preflight','xkey.validate']),/exactly the \d+ free discovery tools/);
});
