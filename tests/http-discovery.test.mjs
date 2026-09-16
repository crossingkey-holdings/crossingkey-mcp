import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import {validateDiscoveryExtension} from '@x402/extensions/bazaar';
import {BASE_USDC, RECEIVER} from '../lib/machine-commerce.mjs';

const listenPort=()=>new Promise((resolve,reject)=>{const server=net.createServer(); server.once('error',reject); server.listen(0,'127.0.0.1',()=>{const {port}=server.address(); server.close(()=>resolve(port));});});
const waitForHealth=async base=>{for(let i=0;i<80;i++){try{const response=await fetch(`${base}/health`); if(response.ok)return;}catch{} await new Promise(resolve=>setTimeout(resolve,50));} throw new Error('isolated server did not become healthy');};
const sseJson=async response=>{const text=await response.text(); const data=text.split('\n').find(line=>line.startsWith('data: ')); assert.ok(data,`missing SSE data: ${text}`); return JSON.parse(data.slice(6));};

test('isolated HTTP lifecycle exposes discovery before validation and preserves free MCP verification',async t=>{
  const port=await listenPort();
  const base=`http://127.0.0.1:${port}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-http-discovery-'));
  const commerceFile=path.join(dir,'commerce.json');
  const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:base,MACHINE_COMMERCE_FILE:commerceFile,CK_ENABLE_MAINNET:'true',CK_KENNEKARTE_HMAC_SECRET:'k'.repeat(64),CLAIM_SECRET:'c'.repeat(64),X402_FACILITATOR_URL:`${base}/unreachable-facilitator`},stdio:['ignore','ignore','pipe']});
  let errors=''; child.stderr.on('data',chunk=>{errors+=chunk;});
  t.after(()=>{if(child.exitCode===null) child.kill('SIGTERM'); fs.rmSync(dir,{recursive:true,force:true});});
  await waitForHealth(base);
  await promisify(execFile)('bash',['-c','source scripts/deploy-v2.4.0.sh; set +e; verify_runtime_spend_authority "$1"','authority-fixture',base],{env:{...process.env,CROSSINGKEY_DEPLOY_LIB_ONLY:'1'}});

  const unpaid=await fetch(`${base}/api/x402/artifact.integrity_manifest`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(unpaid.status,402);
  const challenge=JSON.parse(Buffer.from(unpaid.headers.get('payment-required'),'base64').toString());
  assert.equal(challenge.accepts[0].network,'eip155:8453');
  assert.equal(challenge.accepts[0].asset,BASE_USDC);
  assert.equal(challenge.accepts[0].payTo,RECEIVER);
  assert.deepEqual(validateDiscoveryExtension(challenge.extensions.bazaar),{valid:true});
  assert.equal(fs.existsSync(commerceFile),false,'quote/discovery must not consume or persist payment state');

  const malformedPaid=await fetch(`${base}/api/x402/artifact.integrity_manifest`,{method:'POST',headers:{'content-type':'application/json','payment-signature':Buffer.from('{}').toString('base64')},body:JSON.stringify({idempotency_key:'bounded-key-001',input:{artifacts:[]}})});
  assert.equal(malformedPaid.status,400);
  assert.deepEqual(await malformedPaid.json(),{error:'bounded_artifacts_required'});
  assert.equal(fs.existsSync(commerceFile),false,'invalid paid input must be rejected before verify or settlement');

  const initialize=await fetch(`${base}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'local-gate',version:'1.0.0'}}})});
  assert.equal(initialize.status,200,errors);
  const initBody=await sseJson(initialize);
  assert.equal(initBody.result.serverInfo.version,'2.5.0');
  const session=initialize.headers.get('mcp-session-id'); assert.ok(session);
  const toolsResponse=await fetch(`${base}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-session-id':session},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})});
  const toolsBody=await sseJson(toolsResponse);
  const verification=toolsBody.result.tools.find(tool=>tool.name==='payment.verify_onchain');
  assert.ok(verification);
  assert.equal(verification.annotations.readOnlyHint,true);
  assert.equal(verification.annotations.destructiveHint,false);
  const verifyResponse=await fetch(`${base}/mcp`,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream','mcp-session-id':session},body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'payment.verify_onchain',arguments:{}}})});
  const verifyBody=await sseJson(verifyResponse);
  assert.equal(verifyBody.result.isError,undefined);
  const verificationResult=verifyBody.result.structuredContent;
  assert.equal(verificationResult.verified,false);
  assert.equal(verificationResult.errorCode,'MISSING_VERIFICATION_TARGET');
  assert.equal(fs.existsSync(commerceFile),false,'free on-chain verification must not create commerce state');
});
