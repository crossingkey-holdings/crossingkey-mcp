import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {X402_CAPABILITIES,PREPAID_CAPABILITIES} from '../lib/paid-capability-catalog.mjs';

test('live MCP transport advertises paid tools and keeps public discovery free',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-paid-http-'));
  const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:base,CK_FUNNEL_DB:path.join(dir,'funnel.sqlite3'),MACHINE_COMMERCE_FILE:path.join(dir,'core.json'),MARKETPLACE_FILE:path.join(dir,'marketplace.json'),CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<80;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(ready,true,'server started');
  const discovery=await (await fetch(base+'/.well-known/mcp.json')).json();
  assert.equal(discovery.canonicalId,'com.crossingkeyintelligence/crossingkey-mcp');
  assert.equal(discovery.storefront.freeMcpTools,0);
  assert.equal(discovery.walletMode,'receiver-only');
  assert.equal(discovery.paidCapabilities.length,X402_CAPABILITIES.length);
  const health=await (await fetch(base+'/health')).json();
  assert.equal(health.ok,true);assert.equal(health.stripe_configured,undefined);
  let session;let id=0;
  async function rpc(method,params){
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
    if(session)headers['mcp-session-id']=session;
    const response=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
    assert.equal(response.status,200);session=response.headers.get('mcp-session-id')||session;
    const body=await response.text();const data=body.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5)).join('\n');return JSON.parse(data||body);
  }
  await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'paid-storefront-test',version:'1'}});
  const listed=(await rpc('tools/list',{})).result.tools.map(x=>x.name).sort();
  assert.deepEqual(listed,[...X402_CAPABILITIES,...PREPAID_CAPABILITIES].map(x=>x.name).sort());
  assert.equal(listed.includes('payment.verify'),false);
  const paid=await rpc('tools/call',{name:'artifact.integrity_manifest',arguments:{artifacts:[{name:'a',content:'b'}]}});
  assert.equal(paid.result.structuredContent.payment_required,true);
  assert.equal(paid.result.structuredContent.price,'100000');
  assert.equal(paid.result.structuredContent.execution_mode,'x402_http');
  const gated=await rpc('tools/call',{name:'xkey.validate',arguments:{idempotency_key:'paid-fixture-0001',raw_intake:'{}'}});
  assert.equal(gated.result.isError,true);
  assert.equal(gated.result.structuredContent.error,'authentication_required');
});
