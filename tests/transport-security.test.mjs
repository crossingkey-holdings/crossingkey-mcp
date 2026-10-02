// Group G — transport hardening and observability.
// Covers: safeFetch 256KB response cap, Origin validation on POST /mcp.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {readCappedBody,SAFE_FETCH_MAX_BYTES} from '../lib/machine-commerce.mjs';

function fakeResponse(byteLength){
  const stream=new ReadableStream({
    start(controller){
      controller.enqueue(new Uint8Array(byteLength));
      controller.close();
    }
  });
  return {body:stream};
}

test('readCappedBody rejects responses over 256KB and accepts smaller ones',async ()=>{
  assert.equal(SAFE_FETCH_MAX_BYTES,256*1024);
  const small=await readCappedBody(fakeResponse(1024));
  assert.equal(small.length,1024);
  await assert.rejects(
    ()=>readCappedBody(fakeResponse(SAFE_FETCH_MAX_BYTES+1)),
    /256KB/
  );
});

test('readCappedBody rejects oversized bodies even when streamed in chunks',async ()=>{
  const chunk=new Uint8Array(64*1024);
  const stream=new ReadableStream({
    start(controller){
      for(let i=0;i<5;i++)controller.enqueue(chunk);
      controller.close();
    }
  });
  await assert.rejects(()=>readCappedBody({body:stream}),/256KB/);
});

function bootServer(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-transport-'));
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
  fs.writeFileSync(files.catalog,JSON.stringify({offers:[]}));
  fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));
  fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));
  fs.writeFileSync(files.services,JSON.stringify({services:[]}));
  fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
  fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
  return {dir,files};
}

async function startRawServer(t,files){
  const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
  const child=spawn(process.execPath,[path.join(process.cwd(),'server.mjs')],{cwd:path.dirname(path.dirname(files.catalog)),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
  let ready=false;
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
  assert.equal(ready,true,'server did not become ready');
  return port;
}

test('POST /mcp rejects cross-origin browser requests (DNS-rebinding defense)',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const port=await startRawServer(t,files);
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'evil',version:'1'}}});
  const evil=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',origin:'https://evil.example'},body});
  assert.equal(evil.status,403);
  const evilJson=await evil.json();
  assert.equal(evilJson.error.code,-32000);
});

test('POST /mcp allows requests with no Origin and with a matching Origin',async t=>{
  const {dir,files}=bootServer(t);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const port=await startRawServer(t,files);
  const body=id=>JSON.stringify({jsonrpc:'2.0',id,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'ok',version:'1'}}});
  const noOrigin=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream'},body:body(1)});
  assert.equal(noOrigin.status,200);
  const sameOrigin=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream',origin:`http://127.0.0.1:${port}`},body:body(2)});
  assert.equal(sameOrigin.status,200);
});
