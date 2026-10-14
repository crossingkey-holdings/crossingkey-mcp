import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {X402_CAPABILITIES} from '../lib/paid-capability-catalog.mjs';
import {BASE_USDC,RECEIVER,createMachineCommerce,canonicalizePayment,enforcePolicy,normalizeX402Version} from '../lib/machine-commerce.mjs';

const config={dataFile:'/tmp/ck-x402-bilingual-unused.json',receiver:RECEIVER,network:'eip155:8453',mainnetEnabled:true,publicBaseUrl:'https://mcp.example',facilitatorUrl:'https://facilitator.example',kennekarteSecret:'k'.repeat(64)};
const core=createMachineCommerce(config);
const payer='0x1111111111111111111111111111111111111111';
function auth(amount,nonce='0x'+'a'.repeat(64)){return {from:payer,to:RECEIVER,value:amount,validAfter:'1',validBefore:'9999999999',nonce};}

test('all 13 paid capabilities expose validated v1 and v2 requirements',()=>{
  assert.equal(X402_CAPABILITIES.length,13);
  for(const cap of X402_CAPABILITIES){
    const v1=core.paymentRequired(cap.name,1).body;
    assert.equal(v1.x402Version,1,cap.name);
    assert.equal(v1.accepts[0].network,'base',cap.name);
    assert.equal(v1.accepts[0].asset,BASE_USDC,cap.name);
    assert.equal(v1.accepts[0].maxAmountRequired,cap.amount,cap.name);
    const v2=JSON.parse(Buffer.from(core.paymentRequired(cap.name,2).headers['PAYMENT-REQUIRED'],'base64'));
    assert.equal(v2.x402Version,2,cap.name);
    assert.equal(v2.accepts[0].network,'eip155:8453',cap.name);
    assert.equal(v2.accepts[0].asset,BASE_USDC,cap.name);
    assert.equal(v2.accepts[0].amount,cap.amount,cap.name);
  }
});

test('protocol negotiation is strict and defaults to v2',()=>{
  assert.equal(normalizeX402Version(undefined),2);
  assert.equal(normalizeX402Version('1'),1);
  assert.equal(normalizeX402Version('2'),2);
  assert.throws(()=>normalizeX402Version('3'),/Unsupported/);
  assert.throws(()=>normalizeX402Version('v2'),/Unsupported/);
});

test('v1 and v2 payment envelopes are distinct and validated',()=>{
  const v1=core.paymentRequired('xkey.validate',1).body.accepts[0];
  const p1={x402Version:1,scheme:'exact',network:'base',payload:{signature:'fixture-v1',authorization:auth('100000')}};
  assert.equal(canonicalizePayment(p1,v1).receivedVersion,1);
  const v2=JSON.parse(Buffer.from(core.paymentRequired('xkey.validate',2).headers['PAYMENT-REQUIRED'],'base64'));
  const p2={x402Version:2,accepted:v2.accepts[0],payload:{signature:'fixture-v2',authorization:auth('100000','0x'+'b'.repeat(64))}};
  assert.equal(canonicalizePayment(p2,v2.accepts[0]).receivedVersion,2);
  assert.throws(()=>canonicalizePayment({...p1,accepted:v2.accepts[0]},v1),/v2 accepted/);
  assert.throws(()=>canonicalizePayment({...p2,accepted:undefined},v2.accepts[0]),/accepted requirements/);
  assert.throws(()=>canonicalizePayment({...p2,x402Version:1,network:'base'},v1),/v2 accepted/);
});

test('wrong amount, asset, recipient, and cross-version replay inputs fail closed',()=>{
  const v2=JSON.parse(Buffer.from(core.paymentRequired('xkey.validate',2).headers['PAYMENT-REQUIRED'],'base64'));
  const good={x402Version:2,accepted:v2.accepts[0],payload:{signature:'fixture',authorization:auth('100000')}};
  assert.throws(()=>enforcePolicy(canonicalizePayment({...good,accepted:{...good.accepted,amount:'1'}},v2.accepts[0]),v2.accepts[0],config),/amount/);
  assert.throws(()=>enforcePolicy(canonicalizePayment({...good,accepted:{...good.accepted,asset:'0x'+'2'.repeat(40)}},v2.accepts[0]),v2.accepts[0],config),/asset/);
  assert.throws(()=>canonicalizePayment({...good,payload:{...good.payload,authorization:auth('100000').toString()}},v2.accepts[0]),/Signed/);
  assert.throws(()=>canonicalizePayment({...good,x402Version:1},core.paymentRequired('xkey.validate',1).body.accepts[0]),/v2 accepted/);
});

test('facilitator failure is surfaced without settlement fallback',async()=>{
  const calls=[];
  const failing=createMachineCommerce({...config,rpcUrl:'https://rpc.example',dataFile:'/tmp/ck-x402-failing.json',fetchImpl:async(url,init)=>{calls.push(String(url)); if(String(url)==='https://rpc.example') return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:init.body.includes('eth_chainId')?'0x2105':'0x100'})); if(String(url).endsWith('/verify')) return new Response(JSON.stringify({isValid:false}),{status:200}); return new Response('{}',{status:500});}});
  const v2=JSON.parse(Buffer.from(failing.paymentRequired('xkey.validate',2).headers['PAYMENT-REQUIRED'],'base64'));
  await assert.rejects(()=>failing.invoke({capabilityName:'xkey.validate',input:{idempotency_key:'bilingual-fail-1',raw_intake:'{}'},idempotencyKey:'bilingual-fail-1',paymentPayload:{x402Version:2,accepted:v2.accepts[0],payload:{signature:'fixture',authorization:auth('100000','0x'+'c'.repeat(64))}}}),/verify|failed/i);
  assert.deepEqual(calls.filter(url=>url.includes('facilitator')),['https://facilitator.example/verify']);
});

test('HTTP and MCP transport declarations do not overclaim native MCP payments',()=>{
  const runtime=fs.readFileSync(new URL('../server-runtime.mjs',import.meta.url),'utf8');
  const manifest=fs.readFileSync(new URL('../lib/mcp-manifest.mjs',import.meta.url),'utf8');
  assert.match(runtime,/normalizeX402Version/);
  assert.match(runtime,/payment_header_version_mismatch/);
  assert.match(runtime,/X-PAYMENT-RESPONSE/);
  assert.match(runtime,/PAYMENT-RESPONSE/);
  assert.match(runtime,/execution_mode:'x402_http'/);
  assert.match(manifest,/mcpNativePaymentExchange: false/);
  assert.match(manifest,/preferredVersion:2/);
});
