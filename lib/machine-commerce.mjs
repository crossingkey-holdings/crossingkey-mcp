import {createProductionGate1B,reconcileProduction,captureReconciliationAnchor} from './gate1b-production-adapter.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { buildBazaarExtension } from './discovery.mjs';
import { withFileLock } from './marketplace-storage.mjs';
import { X402_CAPABILITIES } from './paid-capability-catalog.mjs';

export const RECEIVER = '0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28';
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// Canonical commercial metadata lives in paid-capability-catalog.mjs.
export const CAPABILITIES = X402_CAPABILITIES;

function stable(value){
  if(Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if(value && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sha256(value){return `sha256:${crypto.createHash('sha256').update(stable(value)).digest('hex')}`;}
function atomicWrite(file,value){fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.${process.pid}.${Date.now()}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600}); fs.renameSync(tmp,file);}
function initialState(){return {version:1,idempotency:{},replayKeys:{},entitlements:{},receipts:{}};}
function readState(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT') return initialState(); throw e;}}
function address(value,label){const s=String(value||''); if(!/^0x[a-fA-F0-9]{40}$/.test(s)) throw new Error(`${label} must be an EVM address`); return s;}
function atomicAmount(value,label){const s=String(value||''); if(!/^[0-9]+$/.test(s)||BigInt(s)<=0n) throw new Error(`${label} must be a positive atomic amount`); return s;}
function nonNegativeInteger(value,label){const s=String(value??''); if(!/^[0-9]+$/.test(s)||BigInt(s)<0n) throw new Error(`${label} must be a non-negative integer`); return s;}
function network(value){const n={'base':'eip155:8453','base-sepolia':'eip155:84532'}[value]||value; if(!['eip155:8453','eip155:84532'].includes(n)) throw new Error('Unsupported network'); return n;}
function capability(name){const found=CAPABILITIES.find(x=>x.name===name); if(!found) throw new Error('Unknown capability'); return found;}

export function canonicalRequirement(capabilityName,version,config){
  const cap=capability(capabilityName); const n=config.network;
  const common={scheme:'exact',network:version===1?(n==='eip155:8453'?'base':'base-sepolia'):n,asset:n==='eip155:8453'?BASE_USDC:BASE_SEPOLIA_USDC,payTo:config.receiver,maxTimeoutSeconds:60,extra:{name:'USDC',version:'2'}};
  return version===1?{...common,maxAmountRequired:cap.amount,resource:`${config.publicBaseUrl}/api/x402/${encodeURIComponent(cap.name)}`,description:cap.description,mimeType:'application/json'}:{...common,amount:cap.amount};
}

export function paymentRequired(capabilityName,version,config){
  const requirement=canonicalRequirement(capabilityName,version,config);
  if(version===1) return {body:{x402Version:1,error:'Payment required',accepts:[requirement]},headers:{}};
  const body={x402Version:2,error:'Payment required',resource:{url:`${config.publicBaseUrl}/api/x402/${encodeURIComponent(capabilityName)}`,description:capability(capabilityName).description,mimeType:'application/json',serviceName:'CrossingKey MCP',tags:['audit','x402','deterministic','receipt']},accepts:[requirement],extensions:{bazaar:buildBazaarExtension(capabilityName)}};
  return {body:{},headers:{'PAYMENT-REQUIRED':Buffer.from(JSON.stringify(body)).toString('base64')}};
}

export function decodePaymentHeader(value){
  if(!value) return null;
  try{return JSON.parse(Buffer.from(String(value),'base64').toString('utf8'));}catch{throw new Error('Invalid payment header encoding');}
}

export function canonicalizePayment(raw,expected){
  if(!raw||typeof raw!=='object'||![1,2].includes(raw.x402Version)) throw new Error('Unsupported or missing x402Version');
  const version=raw.x402Version;
  const accepted=version===2?raw.accepted:expected;
  const auth=raw.payload?.authorization;
  if(!auth||typeof auth!=='object'||typeof raw.payload?.signature!=='string') throw new Error('Signed authorization is required');
  const canonical={protocol:'x402',receivedVersion:version,scheme:String(version===2?accepted?.scheme:raw.scheme||expected.scheme),network:network(version===2?accepted?.network:raw.network||expected.network),asset:address(version===2?accepted?.asset:expected.asset,'asset'),amount:atomicAmount(version===2?accepted?.amount:expected.maxAmountRequired,'amount'),payTo:address(version===2?accepted?.payTo:expected.payTo,'payTo'),payer:address(auth.from,'payer'),authorization:{signature:raw.payload.signature,from:address(auth.from,'from'),to:address(auth.to,'to'),value:atomicAmount(auth.value,'authorization value'),validAfter:nonNegativeInteger(auth.validAfter,'validAfter'),validBefore:atomicAmount(auth.validBefore,'validBefore'),nonce:String(auth.nonce||'')},raw};
  if(!/^0x[a-fA-F0-9]{64}$/.test(canonical.authorization.nonce)) throw new Error('Invalid nonce');
  if(BigInt(canonical.authorization.validBefore)<=BigInt(canonical.authorization.validAfter)) throw new Error('validBefore must be greater than validAfter');
  return canonical;
}

export function enforcePolicy(payment,expected,config){
  if(payment.scheme!=='exact') throw new Error('Only exact payments are supported');
  if(payment.network!==config.network||payment.network!==network(expected.network)) throw new Error('Payment network mismatch');
  if(payment.asset.toLowerCase()!==expected.asset.toLowerCase()) throw new Error('Payment asset mismatch');
  if(payment.payTo.toLowerCase()!==config.receiver.toLowerCase()||payment.authorization.to.toLowerCase()!==config.receiver.toLowerCase()) throw new Error('Payment destination mismatch');
  const amount=expected.amount||expected.maxAmountRequired;
  if(payment.amount!==amount||payment.authorization.value!==amount) throw new Error('Payment amount mismatch');
  if(payment.network==='eip155:8453'&&!config.mainnetEnabled) throw new Error('Base mainnet is disabled until the Sepolia gate passes');
}

function privateIp(ip){
  if(net.isIP(ip)===4){const p=ip.split('.').map(Number); return p[0]===0||p[0]===10||p[0]===127||(p[0]===169&&p[1]===254)||(p[0]===172&&p[1]>=16&&p[1]<=31)||(p[0]===192&&p[1]===168);}
  const x=ip.toLowerCase(); return x==='::1'||x.startsWith('fc')||x.startsWith('fd')||x.startsWith('fe80:');
}
async function safeFetch(raw,fetchImpl){const u=new URL(raw); if(!['http:','https:'].includes(u.protocol)||u.username||u.password) throw new Error('Only credential-free HTTP(S) URLs are allowed'); const ips=net.isIP(u.hostname)?[u.hostname]:(await dns.lookup(u.hostname,{all:true})).map(x=>x.address); if(ips.some(privateIp)) throw new Error('Private/internal destinations are forbidden'); return fetchImpl(u,{redirect:'error',signal:AbortSignal.timeout(8000),headers:{'user-agent':'CrossingKey-Machine-Commerce/1.0'}});}

async function execute(name,input,fetchImpl){
  if(name==='artifact.integrity_manifest'){const artifacts=Array.isArray(input.artifacts)?input.artifacts:[]; if(!artifacts.length) throw new Error('artifacts[] is required'); const manifest=artifacts.map(a=>{const n=String(a?.name||''),content=String(a?.content??''); if(!n) throw new Error('artifact name is required'); return {name:n,bytes:Buffer.byteLength(content),sha256:crypto.createHash('sha256').update(content).digest('hex')};}); return {capability:name,manifest,manifestSha256:crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};}
  if(name==='mcp.schema_audit'){const tools=Array.isArray(input.tools)?input.tools:[]; if(!tools.length) throw new Error('tools array is required'); const results=tools.map(t=>{const findings=[]; if(!t?.name||typeof t.name!=='string') findings.push('missing_name'); if(!t?.description||String(t.description).length<30) findings.push('weak_description'); if(!t?.inputSchema||t.inputSchema.type!=='object') findings.push('missing_or_invalid_input_schema'); for(const [k,v] of Object.entries(t?.inputSchema?.properties||{})) if(!v?.description) findings.push(`input_without_description:${k}`); return {name:t?.name||null,score:Math.max(0,100-findings.length*18),findings};}); return {capability:name,score:Math.round(results.reduce((a,b)=>a+b.score,0)/results.length),tools:results};}
  if(name==='openapi.quality_audit'){const spec=input.spec; if(!spec||typeof spec!=='object'||Array.isArray(spec)) throw new Error('spec object is required'); const findings=[]; if(!spec.openapi)findings.push({severity:'high',code:'MISSING_OPENAPI_VERSION'}); if(!spec.info?.title)findings.push({severity:'medium',code:'MISSING_TITLE'}); if(!spec.info?.version)findings.push({severity:'medium',code:'MISSING_API_VERSION'}); if(!spec.paths||!Object.keys(spec.paths).length)findings.push({severity:'high',code:'NO_PATHS'}); let operationCount=0; for(const [p,methods] of Object.entries(spec.paths||{})) for(const [method,op] of Object.entries(methods||{})){if(!['get','post','put','patch','delete','options','head'].includes(method.toLowerCase()))continue; operationCount++; if(!op.operationId)findings.push({severity:'medium',code:'MISSING_OPERATION_ID',path:p,method}); if(!op.description&&!op.summary)findings.push({severity:'low',code:'MISSING_OPERATION_DESCRIPTION',path:p,method}); if(!op.responses)findings.push({severity:'high',code:'MISSING_RESPONSES',path:p,method});} const penalty=findings.reduce((n,f)=>n+(f.severity==='high'?20:f.severity==='medium'?8:3),0); return {capability:name,score:Math.max(0,100-penalty),operationCount,findings};}
  if(name==='x402.compatibility_audit'){const url=String(input.url||''); if(!url)throw new Error('url is required'); const res=await safeFetch(url,fetchImpl), text=await res.text(); let body=null; try{body=JSON.parse(text);}catch{} let h=null; try{h=decodePaymentHeader(res.headers.get('payment-required'));}catch{} const detected=h?2:body?.x402Version===1?1:null; const findings=[]; if(res.status!==402)findings.push({severity:'high',code:'NOT_402'}); if(!detected)findings.push({severity:'high',code:'NO_X402_CHALLENGE'}); const challenge=h||body; if(detected&&!Array.isArray(challenge?.accepts))findings.push({severity:'high',code:'ACCEPTS_MISSING'}); return {capability:name,target:url,status:res.status,detectedVersion:detected,findings,passed:findings.every(x=>x.severity!=='high')};}
  if(name==='machine_commerce.readiness_audit'){const base=new URL(String(input.url||'')),checks=[]; for(const p of ['/health','/openapi.json','/llms.txt','/.well-known/x402','/.well-known/mcp.json']){try{const r=await safeFetch(new URL(p,base).toString(),fetchImpl); checks.push({path:p,status:r.status,ok:r.ok});}catch(e){checks.push({path:p,status:null,ok:false,error:e.message});}} return {capability:name,score:Math.round(100*checks.filter(x=>x.ok).length/checks.length),checks};}
  throw new Error('Unknown capability');
}

export async function facilitatorCall(config,operation,paymentPayload,paymentRequirements){
  if(!config.facilitatorUrl) throw new Error('x402 facilitator is not configured');
  const url=`${config.facilitatorUrl.replace(/\/+$/,'')}/${operation}`;

  console.error(`[x402] facilitator_${operation}_start`);

  const response=await config.fetchImpl(url,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({
      x402Version:paymentPayload.x402Version,
      paymentPayload,
      paymentRequirements
    }),
    signal:AbortSignal.timeout(15000)
  });

  console.error(`[x402] facilitator_${operation}_http=${response.status}`);

  const text=await response.text();
  let data={};

  try{
    data=text?JSON.parse(text):{};
  }catch{
    console.error(`[x402] facilitator_${operation}_non_json_response`);
    throw new Error(`Facilitator ${operation} returned invalid JSON`);
  }

  if(!response.ok){
    const reason=String(
      data.invalidReason ||
      data.error ||
      data.message ||
      'unknown'
    ).slice(0,160);

    console.error(`[x402] facilitator_${operation}_rejected reason=${reason}`);
    throw new Error(
      `Facilitator ${operation} failed: HTTP ${response.status}: ${reason}`
    );
  }

  console.error(`[x402] facilitator_${operation}_ok`);
  return data;
}

export function createMachineCommerce(options={}){
  const config={dataFile:options.dataFile||path.resolve('data/machine_commerce.json'),receiver:address(options.receiver||RECEIVER,'receiver'),network:network(options.network||'eip155:84532'),mainnetEnabled:options.mainnetEnabled===true,publicBaseUrl:String(options.publicBaseUrl||'http://localhost:3000').replace(/\/+$/,''),facilitatorUrl:String(options.facilitatorUrl||''),kennekarteSecret:String(options.kennekarteSecret||''),fetchImpl:options.fetchImpl||fetch};
  if(config.kennekarteSecret.length<32) throw new Error('Kennekarte secret must contain at least 32 characters');
  function status(){const s=readState(config.dataFile); return {walletMode:'receiver-only',receiver:config.receiver,network:config.network,mainnetEnabled:config.mainnetEnabled,aiRequired:false,x402Versions:[1,2],purchases:Object.keys(s.idempotency).length,entitlements:Object.keys(s.entitlements).length,receipts:Object.keys(s.receipts).length};}
  function inspectEntitlement(id){return readState(config.dataFile).entitlements[id]||null;}
  function getPurchase(id){const stored=readState(config.dataFile).idempotency[id];if(!stored)return null;const {gate1b,...publicRecord}=stored;return publicRecord;}
  function getReceipt(id){return readState(config.dataFile).receipts[id]||null;}
  function bindOnchainVerification(id, proof){const s=readState(config.dataFile); if(!s.receipts[id])return false; s.onchainVerification=s.onchainVerification||{}; s.onchainVerification[id]=proof; atomicWrite(config.dataFile,s); return true;}
  function verifyReceipt(receipt){return Boolean(receipt&&receipt.resultHash===sha256(receipt.result));}
  const gate=createProductionGate1B({dataFile:config.dataFile,
    prepare:({capabilityName,input,idempotencyKey,paymentPayload})=>{
      if(!/^[A-Za-z0-9._:-]{8,160}$/.test(String(idempotencyKey||'')))throw new Error('A bounded idempotency key is required');
      const expected=canonicalRequirement(capabilityName,paymentPayload?.x402Version,config),payment=canonicalizePayment(paymentPayload,expected);enforcePolicy(payment,expected,config);
      const requestHash=sha256({capability:capabilityName,input}),paymentHash=sha256(paymentPayload),replayKey=`${payment.network}:${payment.authorization.nonce}`;
      const durablePayment={network:payment.network,asset:payment.asset,amount:payment.amount,payTo:payment.payTo,payer:payment.payer,receivedVersion:payment.receivedVersion,authorization:{from:payment.authorization.from,to:payment.authorization.to,value:payment.authorization.value,validAfter:payment.authorization.validAfter,validBefore:payment.authorization.validBefore,nonce:payment.authorization.nonce}};
      return {capabilityName,input,idempotencyKey,paymentPayload,expected,payment,requestHash,paymentHash,replayKey,durableContext:{capabilityName,input,idempotencyKey,payment:durablePayment,requestHash,paymentHash,replayKey,reconciliationFromBlock:null}};
    },
    verify:async c=>{await captureReconciliationAnchor(c,{rpcUrl:options.rpcUrl||process.env.CK_BASE_RPC_URL,fetchImpl:config.fetchImpl});if(c.durableContext.reconciliationFromBlock!==c.reconciliationFromBlock)throw new Error('Durable reconciliation anchor mismatch');const v=await facilitatorCall(config,'verify',c.paymentPayload,c.expected);return v.isValid===true||v.valid===true;},
    settle:c=>facilitatorCall(config,'settle',c.paymentPayload,c.expected),
    reconcile:(c,t)=>reconcileProduction(c,t,{rpcUrl:options.rpcUrl||process.env.CK_BASE_RPC_URL,fallbackRpcUrl:options.fallbackRpcUrl,fetchImpl:config.fetchImpl}),
    execute:c=>execute(c.capabilityName,c.input,config.fetchImpl),
    barrier:options.gate1bBarrier,
    finalize:(c,t,result)=>{
      const purchaseId=t.purchaseId,entitlementId=t.entitlementId,payment=c.payment,version=payment.receivedVersion,capabilityName=c.capabilityName;
      const xkey={xkey_version:'1.0',execution:{capability:capabilityName,idempotency_key:c.idempotencyKey},purchase:{purchase_id:purchaseId,entitlement_id:entitlementId,holder:payment.payer},input:c.input,outputs:['json','manifest'],receipt:{required:true,hash_output:true}};
      const receipt={receiptVersion:'ck/1',id:t.receiptId,purchaseId,capability:capabilityName,holder:payment.payer,entitlementId,payment:{protocol:'x402',version,network:payment.network,asset:payment.asset,amount:payment.amount,payTo:payment.payTo,transaction:t.settlement.transaction},xkeyHash:sha256(xkey),resultHash:sha256(result),result,completedAt:new Date().toISOString()};
      const payload={type:'crossingkey-kennekarte',version:1,holder:payment.payer,purchaseId,entitlementId,capability:capabilityName,rights:{executions:1,downloads:3},issuedAt:new Date().toISOString(),artifactHashes:[receipt.resultHash]};
      const signature=`hmac-sha256:${crypto.createHmac('sha256',config.kennekarteSecret).update(stable(payload)).digest('hex')}`;
      return {status:'fulfilled',purchaseId,entitlementId,result,receipt,kennekarte:{payload,signature},xkey,settlement:t.settlement,entitlement:{id:entitlementId,purchaseId,capability:capabilityName,holder:payment.payer,status:'consumed',usesRemaining:0,createdAt:t.createdAt,consumedAt:receipt.completedAt}};
    }
  });
  return {config,status,inspectEntitlement,getPurchase,getReceipt,bindOnchainVerification,verifyReceipt,invoke:gate.invoke,revenueEvents:gate.revenueEvents,paymentRequired:(name,v)=>paymentRequired(name,v,config),capabilities:CAPABILITIES};
}
