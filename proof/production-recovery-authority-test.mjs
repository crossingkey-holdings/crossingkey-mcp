import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createMachineCommerce,RECEIVER} from '../lib/machine-commerce.mjs';
import {startHttpsRpcFixture,createFixtureFetch} from '../tests/fixtures/https-rpc-fixture.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-authority-reentry-'));const rpc=await startHttpsRpcFixture();
let verifyCalls=0,settleCalls=0;
const facilitator=async(url,init)=>{const operation=String(url).endsWith('/verify')?'verify':'settle';if(operation==='verify')verifyCalls++;else settleCalls++;return new Response(JSON.stringify(operation==='verify'?{isValid:true}:{success:true,transaction:'fixture-never-used'}),{status:200,headers:{'content-type':'application/json'}});};
const core=createMachineCommerce({dataFile:path.join(dir,'state.json'),receiver:RECEIVER,network:'eip155:84532',mainnetEnabled:false,publicBaseUrl:'https://mcp.example.test',facilitatorUrl:'https://facilitator.example.test',rpcUrl:rpc.url,kennekarteSecret:'x'.repeat(64),fetchImpl:createFixtureFetch(rpc,facilitator)});
const auth={from:'0x1111111111111111111111111111111111111111',to:RECEIVER,value:'100000',validAfter:'1',validBefore:'9999999999',nonce:`0x${'d'.repeat(64)}`};
const payment={x402Version:1,scheme:'exact',network:'base-sepolia',payload:{signature:['0x','f'.repeat(64)].join(''),authorization:auth}};
const result=await core.invoke({capabilityName:'artifact.integrity_manifest',input:{artifacts:[{name:'authority.txt',content:'recovery'}]},idempotencyKey:'authority-reentry-1',paymentPayload:payment});
assert.equal(result.status,'fulfilled');const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8'));const context=state.idempotency['authority-reentry-1'].gate1b.context;assert.ok(context.recoveryAuthorization);const before=verifyCalls;await core.revalidateRecovery(context);assert.equal(verifyCalls,before+1);assert.equal(settleCalls,1);await rpc.close();console.log(JSON.stringify({status:'FRESH_EXECUTION',canonicalizePayment:true,enforcePolicy:true,rpcAnchor:true,facilitatorVerifyCalls:verifyCalls,settleCalls,settlement_repeated:false,recovery_authorization_persisted:true,verdict:'PASS'}));
