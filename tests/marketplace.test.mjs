import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createMachineCommerce,RECEIVER} from '../lib/machine-commerce.mjs';
import {createMarketplace} from '../lib/marketplace.mjs';
import {createAdapters,publicIp,validateEndpoint,artifactInfo} from '../lib/marketplace-adapters.mjs';
import {splitAmount,validateSchema,validateValue,boundedJson} from '../lib/marketplace-schema.mjs';
import {resolveMarketplacePrincipal,createRateLimit} from '../lib/marketplace-tools.mjs';
import {readJson,writeJson,withFileLock} from '../lib/marketplace-storage.mjs';
import {usdToAtomic,importCatalog,validateCatalog} from '../scripts/import-marketplace-catalog.mjs';

const admin={role:'admin',id:'LOCAL TEST FIXTURE administrator'};
const buyer={role:'buyer',buyerReference:'LOCAL-TEST-BUYER',id:'buyer'};
const schema={type:'object',properties:{message:{type:'string',maxLength:80}},required:['message'],additionalProperties:false};
const providerInput={displayName:'Provider A — LOCAL TEST FIXTURE',slug:'provider-a-test',description:'Sandbox echo fixture; not a real provider or sale.',contact:'test fixture'};
const rights={ownershipRepresentation:'LOCAL TEST FIXTURE generated input',distributionPermission:true,commercializationPermission:true,derivativePermission:false,revocationPolicy:'Disable fixture; no real sales.',affirmed:true};
async function fixture(t,{execute=({input})=>input,timeoutMs=100,settle,version=2}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-marketplace-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let calls=[];
  const core=createMachineCommerce({dataFile:path.join(dir,'core.json'),network:'eip155:84532',kennekarteSecret:'local-fixture-only'.repeat(4),facilitatorUrl:'https://facilitator.invalid',publicBaseUrl:'https://local.invalid',fetchImpl:async(url,init)=>{
    const op=String(url).split('/').pop();calls.push(op);const request=JSON.parse(init.body);assert.equal(request.paymentRequirements.payTo,RECEIVER);
    return new Response(JSON.stringify(op==='verify'?{isValid:true}:settle?await settle():{success:true,transaction:'0x'+'1'.repeat(64)}));
  }});
  const bindings={},adapters=createAdapters({bindings,local:{echo:execute},timeoutMs});
  const mp=createMarketplace({core,dataFile:path.join(dir,'marketplace.json'),adapters});
  const p=await mp.registerProvider(providerInput);assert.equal(p.status,'pending');
  await mp.setProviderStatus(p.providerId,'active',admin);
  const principal={role:'provider',providerId:p.providerId};
  const cap=await mp.registerCapability({providerId:p.providerId,name:'marketplace.echo',slug:'marketplace-echo',description:'LOCAL TEST FIXTURE echoes bounded input.',category:'test',version:'1.0.0',inputSchema:schema,outputSchema:schema,deliveryType:'mcp_tool',price:'100001',currency:'USDC',network:'eip155:84532',license:'Test only',visibility:'public',rights,sourceProvenance:'LOCAL TEST FIXTURE'},principal);
  bindings[cap.capabilityId]={type:'local',adapter:'echo'};
  await mp.setCapabilityStatus(cap.capabilityId,'active',admin);
  const input={message:'hello marketplace'},idempotencyKey='sandbox-purchase-0001';
  const approval=await mp.approvePurchase({capabilityId:cap.capabilityId,buyerReference:buyer.buyerReference,idempotencyKey,input,expiresAt:new Date(Date.now()+60000).toISOString()},admin);
  const q=mp.quote(cap.capabilityId),requirement=q.paymentRequirement[`v${version}`];
  const paymentPayload={x402Version:version,...(version===2?{accepted:requirement}:{scheme:'exact',network:'base-sepolia'}),payload:{signature:'sandbox-facilitator-fixture-not-a-signature',authorization:{from:'0x'+'2'.repeat(40),to:RECEIVER,value:cap.price,validAfter:'1',validBefore:'9999999999',nonce:'0x'+'3'.repeat(64)}}};
  const args={capabilityId:cap.capabilityId,approvalId:approval.approvalId,idempotencyKey,input,paymentPayload};
  return {dir,mp,core,p,principal,cap,args,calls,bindings,adapters};
}

for(const version of [1,2])test(`marketplace E2E x402 v${version}: registration, approval, discovery, quote, payment, receipt, entitlement, allocation`,async t=>{
  const f=await fixture(t,{version});
  assert.equal(f.mp.describe().activeCapabilityCount,1);assert.equal(f.mp.search({query:'marketplace.echo'}).total,1);
  assert.equal(f.mp.getCapability(f.cap.capabilityId).rights.aiTrainingPermission,false);
  assert.equal(f.mp.getCapability(f.cap.capabilityId).rights.ownershipTransferred,false);
  const quote=f.mp.quote(f.cap.capabilityId);assert.equal(quote.grossAmount,'100001');assert.equal(quote.platformAmount,'10000');assert.equal(quote.providerAmount,'90001');assert.equal(f.calls.length,0);
  const result=await f.mp.purchase(f.args,buyer);assert.equal(result.status,'verified');assert.equal(result.paymentStatus,'successful');
  assert.deepEqual(f.calls,['verify','settle']);assert.deepEqual(result.result,f.args.input);assert.ok(result.job.history.some(x=>x.status==='delivered'));
  assert.equal(f.core.verifyReceipt(result.receipt),true);assert.equal(f.core.getReceipt(result.receipt.id).id,result.receipt.id);assert.equal(f.core.inspectEntitlement(result.entitlementId).status,'consumed');
  assert.equal(f.mp.getReceipt(result.receipt.id,buyer).allocation.providerAmount,'90001');assert.equal(f.mp.getProviderBalance(f.p.providerId,f.principal).balances[0].payable,'90001');
  const repeat=await f.mp.purchase(f.args,buyer);assert.equal(repeat.duplicate,true);assert.equal(f.calls.length,2);assert.equal(f.mp.listAllocations(f.p.providerId,f.principal).total,1);
  await assert.rejects(()=>f.mp.purchase({...f.args,input:{message:'different'}},buyer),/IDEMPOTENCY_CONFLICT/);
  const key='sandbox-purchase-0002';const approval=await f.mp.approvePurchase({capabilityId:f.cap.capabilityId,buyerReference:buyer.buyerReference,idempotencyKey:key,input:f.args.input,expiresAt:new Date(Date.now()+60000).toISOString()},admin);
  await assert.rejects(()=>f.mp.purchase({...f.args,idempotencyKey:key,approvalId:approval.approvalId},buyer),/REPLAY_DETECTED/);assert.equal(f.calls.length,2);
  const reload=createMarketplace({core:f.core,dataFile:f.mp.dataFile,adapters:f.adapters});assert.equal((await reload.purchase(f.args,buyer)).duplicate,true);
});

test('provider/capability statuses and ownership reject unauthorized registration, activation and private discovery',async t=>{
  const f=await fixture(t);await assert.rejects(()=>f.mp.setProviderStatus(f.p.providerId,'active',buyer),/UNAUTHORIZED/);
  await assert.rejects(()=>f.mp.setCapabilityStatus(f.cap.capabilityId,'active',f.principal),/UNAUTHORIZED/);
  await f.mp.setProviderStatus(f.p.providerId,'suspended',admin);
  assert.equal(f.mp.search().total,0);assert.throws(()=>f.mp.getCapability(f.cap.capabilityId),/UNAUTHORIZED/);
  await assert.rejects(()=>f.mp.purchase(f.args,buyer),/CAPABILITY_DISABLED/);assert.equal(f.calls.length,0);
});
test('first-party metadata import requires a later human rights affirmation before activation',async t=>{
  const f=await fixture(t);
  const cap=await f.mp.registerCapability({providerId:f.p.providerId,name:'staged-first-party',slug:'staged-first-party',description:'First-party metadata only',category:'test',version:'1.0.1',inputSchema:schema,outputSchema:schema,deliveryType:'mcp_tool',price:'1',currency:'USDC',network:'eip155:84532',license:'Operator review required',sourceProvenance:'LOCAL TEST CATALOG'},admin,{stagedImport:true});
  assert.equal(cap.rights.affirmed,false);assert.equal(cap.rights.commercializationPermission,false);assert.equal(cap.rights.affirmationTimestamp,null);
  f.bindings[cap.capabilityId]={type:'local',adapter:'echo'};
  await assert.rejects(()=>f.mp.setCapabilityStatus(cap.capabilityId,'active',admin),/RIGHTS_AFFIRMATION_REQUIRED/);
  await assert.rejects(()=>f.mp.affirmCapabilityRights(cap.capabilityId,rights,buyer),/UNAUTHORIZED/);
  await f.mp.affirmCapabilityRights(cap.capabilityId,rights,admin);await f.mp.setCapabilityStatus(cap.capabilityId,'active',admin,'public');
  assert.equal(f.mp.getCapability(cap.capabilityId).rights.affirmed,true);
});
test('inactive and unconfigured capability rejects payment',async t=>{
  const f=await fixture(t);await f.mp.setCapabilityStatus(f.cap.capabilityId,'disabled',admin);
  await assert.rejects(()=>f.mp.purchase(f.args,buyer),/CAPABILITY_DISABLED/);
  delete f.bindings[f.cap.capabilityId];await assert.rejects(()=>f.mp.setCapabilityStatus(f.cap.capabilityId,'active',admin),/CAPABILITY_DISABLED/);
});
test('caller cannot manufacture human authorization or change buyer, input, price or destination',async t=>{
  const f=await fixture(t);
  await assert.rejects(()=>f.mp.purchase({...f.args,approvalId:'invented'},buyer),/HUMAN_AUTHORIZATION_REQUIRED/);
  await assert.rejects(()=>f.mp.purchase(f.args,{...buyer,buyerReference:'other'}),/HUMAN_AUTHORIZATION_REQUIRED/);
  await assert.rejects(()=>f.mp.purchase({...f.args,input:{message:'changed'}},buyer),/HUMAN_AUTHORIZATION_REQUIRED/);
  await assert.rejects(()=>f.mp.approvePurchase({},buyer),/UNAUTHORIZED/);
  const changed=structuredClone(f.args);changed.paymentPayload.payload.authorization.to='0x'+'4'.repeat(40);
  await assert.rejects(()=>f.mp.purchase(changed,buyer),/PAYMENT_FAILED/);assert.equal(f.calls.length,0);
});
for(const [name,execute,expected] of [['timeout',()=>new Promise(()=>{}),'PROVIDER_TIMEOUT'],['invalid response',()=>({invented:true}),'INVALID_PROVIDER_RESPONSE'],['provider failure',()=>{throw new Error('PROVIDER_UNAVAILABLE');},'PROVIDER_UNAVAILABLE']])
test(`paid ${name} retains failed job, receipt and disputed allocation`,async t=>{
  const f=await fixture(t,{execute,timeoutMs:15});const result=await f.mp.purchase(f.args,buyer);
  assert.equal(result.paymentStatus,'successful');assert.equal(result.status,'failed');assert.equal(result.errorCode,expected);assert.equal(result.allocation.status,'disputed');assert.equal(f.core.verifyReceipt(result.receipt),true);
  assert.equal(f.mp.getProviderBalance(f.p.providerId,f.principal).balances[0].payable,'0');assert.equal((await f.mp.purchase(f.args,buyer)).duplicate,true);assert.equal(f.calls.length,2);
});
test('uncertain settlement is retained and never automatically charged again',async t=>{
  const f=await fixture(t,{settle:()=>{throw new Error('connection lost');}});const result=await f.mp.purchase(f.args,buyer);
  assert.equal(result.status,'disputed');assert.equal(result.paymentStatus,'settlement_pending');assert.equal(result.receipt,undefined);
  await f.mp.purchase(f.args,buyer);assert.equal(f.calls.length,2);
});
test('concurrent purchase fails closed before second settlement',async t=>{
  let release;const gate=new Promise(r=>{release=r;});const f=await fixture(t,{execute:async({input})=>{await gate;return input;},timeoutMs:1000});
  const first=f.mp.purchase(f.args,buyer);
  await new Promise(r=>setTimeout(r,10));await assert.rejects(()=>f.mp.purchase(f.args,buyer),/STORE_BUSY/);release();await first;assert.equal(f.calls.length,2);
});
test('cross-path replay reservation protects legacy x402 invoke',async t=>{
  const f=await fixture(t);await f.mp.purchase(f.args,buyer);
  const payload=structuredClone(f.args.paymentPayload);payload.accepted=f.core.paymentRequired('artifact.integrity_manifest',2);
  payload.accepted=JSON.parse(Buffer.from(payload.accepted.headers['PAYMENT-REQUIRED'],'base64')).accepts[0];payload.payload.authorization.value='100000';
  await assert.rejects(()=>f.core.invoke({capabilityName:'artifact.integrity_manifest',input:{artifacts:[{name:'a',content:'b'}]},idempotencyKey:'legacy-replay-0001',paymentPayload:payload}),/Replay detected/);
});
test('settlement authorization, accounting and idempotent marking do not transfer funds',async t=>{
  const f=await fixture(t);const result=await f.mp.purchase(f.args,buyer);
  await assert.rejects(()=>f.mp.markSettled(result.allocation.allocationId,'operator-proof',f.principal),/UNAUTHORIZED/);
  await f.mp.markSettled(result.allocation.allocationId,'operator-proof',admin);await f.mp.markSettled(result.allocation.allocationId,'operator-proof',admin);
  const b=f.mp.getProviderBalance(f.p.providerId,f.principal).balances[0];assert.equal(b.payable,'0');assert.equal(b.settled,'90001');assert.equal(f.calls.length,2);
  assert.throws(()=>f.mp.getProviderBalance(f.p.providerId,buyer),/UNAUTHORIZED/);
});
test('buyer isolation protects receipt, job output and intake contact',async t=>{
  const f=await fixture(t);const r=await f.mp.purchase(f.args,buyer);
  assert.throws(()=>f.mp.getReceipt(r.receipt.id,{...buyer,buyerReference:'other'}),/UNAUTHORIZED/);
  assert.throws(()=>f.mp.jobStatus(r.job.jobId,null),/UNAUTHORIZED/);assert.equal(f.mp.getProvider(f.p.providerId).contact,undefined);
  const intake=await f.mp.applyCreator({provider:providerInput,summary:'Test IP intake'});assert.equal(intake.ownershipTransferred,false);assert.equal(intake.aiTrainingPermission,false);
});
test('fee rounding and large amounts use integer atomic arithmetic',()=>{
  for(const amount of ['1','9','100001','999999999999999999999999999999'])for(const fee of [0,1,1000,9999,10000]) {
    const a=splitAmount(amount,fee);assert.equal(BigInt(a.platformAmount)+BigInt(a.providerAmount),BigInt(amount));
  }
  assert.equal(usdToAtomic('0.123456'),'123456');assert.equal(usdToAtomic('19'),'19000000');assert.throws(()=>usdToAtomic('1e9'));
  assert.throws(()=>splitAmount('1',10001));assert.throws(()=>splitAmount('1.2',1000));
});
test('strict bounded JSON schemas reject unsupported keywords and unknown values',()=>{
  validateSchema(schema);validateValue(schema,{message:'yes'});
  assert.throws(()=>validateValue(schema,{message:'x',unknown:1}));assert.throws(()=>validateValue(schema,{message:12}));
  assert.throws(()=>validateSchema({...schema,$ref:'https://internal.invalid'}));assert.throws(()=>validateSchema({type:'string',pattern:'(a+)+$',maxLength:80}));
  assert.throws(()=>boundedJson({big:'x'.repeat(70000)}),/PAYLOAD_TOO_LARGE/);assert.throws(()=>boundedJson(JSON.parse('{"__proto__":{"x":1}}')),/INVALID_INPUT/);
});
test('SSRF rejects private, special, mapped, mixed-DNS, credential and insecure destinations',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','fd00::1','fe80::1','2001:db8::1'])assert.equal(publicIp(ip),false,ip);
  assert.equal(publicIp('8.8.8.8'),true);
  for(const url of ['http://example.com','https://user:password@example.com','https://localhost','https://127.0.0.1','https://[::1]','https://example.com:8443'])await assert.rejects(()=>validateEndpoint(url));
  await assert.rejects(()=>validateEndpoint('https://example.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),/SSRF_BLOCKED/);
});
test('digital artifact hashes, entitlement delivery and path confinement',async t=>{
  const f=await fixture(t);const root=path.join(f.dir,'assets');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'fixture.zip'),'LOCAL TEST ARTIFACT');
  const info=await artifactInfo(root,'fixture.zip');assert.match(info.contentHash,/^sha256:[a-f0-9]{64}$/);
  await assert.rejects(()=>artifactInfo(root,'../marketplace.json'),/DELIVERY_FAILED/);
  const output={type:'object',properties:{artifactId:{type:'string',maxLength:160},contentHash:{type:'string',maxLength:80},bytes:{type:'integer'},downloadPath:{type:'string',maxLength:300},authentication:{type:'string',maxLength:100}},additionalProperties:false};
  const store=readJson(f.mp.dataFile,{});const c=store.capabilities[f.cap.capabilityId];c.deliveryType='digital_asset';c.outputSchema=output;c.contentHash=info.contentHash;writeJson(f.mp.dataFile,store);
  const adapters=createAdapters({assetRoot:root,bindings:{[c.capabilityId]:{type:'digital_asset',file:'fixture.zip'}}});
  const mp=createMarketplace({core:f.core,dataFile:f.mp.dataFile,adapters});
  const approval=await mp.approvePurchase({capabilityId:c.capabilityId,buyerReference:buyer.buyerReference,idempotencyKey:f.args.idempotencyKey,input:f.args.input,expiresAt:new Date(Date.now()+60000).toISOString()},admin);
  const result=await mp.purchase({...f.args,approvalId:approval.approvalId},buyer);assert.equal(result.status,'verified');assert.equal(result.result.contentHash,info.contentHash);assert.equal(JSON.stringify(result).includes(root),false);
  await assert.rejects(()=>mp.download(result.entitlementId,{...buyer,buyerReference:'other'}),/UNAUTHORIZED/);
  assert.equal((await mp.download(result.entitlementId,buyer)).contentHash,info.contentHash);
  fs.appendFileSync(path.join(root,'fixture.zip'),'tampered');await assert.rejects(()=>mp.download(result.entitlementId,buyer),/VERIFICATION_FAILED/);
});
test('credential hashes, expiry and rate limits are enforced',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-auth-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'auth.json'),token=crypto.randomBytes(32).toString('hex'),hash=crypto.createHash('sha256').update(token).digest('hex');
  writeJson(file,{principals:{[hash]:{id:'buyer',role:'buyer',buyerReference:'A',expiresAt:new Date(Date.now()+60000).toISOString()}}});
  assert.equal(resolveMarketplacePrincipal(`Bearer ${token}`,file).buyerReference,'A');assert.equal(resolveMarketplacePrincipal(`Bearer ${'x'.repeat(64)}`,file),null);
  const limit=createRateLimit({max:2});limit('a');limit('a');assert.throws(()=>limit('a'),/RATE_LIMITED/);
  await withFileLock(file,async()=>{await assert.rejects(()=>withFileLock(file,()=>{}),/STORE_BUSY/);});
});
test('catalog import preserves bytes, is idempotent and rejects a mismatched sidecar',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-catalog-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'catalog'));fs.mkdirSync(path.join(dir,'releases'));
  const name='crossingkey-fixture-v1.0.1.zip',bytes=Buffer.from('TEST-ONLY-ARTIFACT'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(dir,'releases',name),bytes);fs.writeFileSync(path.join(dir,'releases',name+'.sha256'),`${hash}  ${name}\n`);
  writeJson(path.join(dir,'catalog/products.json'),[{id:'fixture-product',slug:'fixture-product',name:'Fixture',description:'Local catalog fixture',version:'1.0.1',priceUsd:9,license:'Test only',verification:'LOCAL_TEST',archive:'releases/'+name,sha256:hash}]);
  const dataFile=path.join(dir,'state.json');const first=await importCatalog({root:dir,dataFile}),second=await importCatalog({root:dir,dataFile});
  assert.equal(first.count,1);assert.equal(second.products[0].capabilityId,first.products[0].capabilityId);assert.deepEqual(fs.readFileSync(path.join(dir,'releases',name)),bytes);
  const s=readJson(dataFile,{});assert.equal(Object.values(s.providers)[0].status,'pending');assert.equal(Object.values(s.capabilities)[0].rights.affirmed,false);
  fs.writeFileSync(path.join(dir,'releases',name+'.sha256'),`${'0'.repeat(64)}  ${name}\n`);await assert.rejects(()=>validateCatalog(dir),/CATALOG_HASH_MISMATCH/);
});
