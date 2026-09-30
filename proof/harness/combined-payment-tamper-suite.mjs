import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { createMachineCommerce, RECEIVER } from '../../lib/machine-commerce.mjs';
import { startHttpsRpcFixture, createFixtureFetch } from '../../tests/fixtures/https-rpc-fixture.mjs';
import { createExternalEffectAdapter } from './external-effect-adapter.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ck-tamper-'));
const child=path.resolve('proof/harness/combined-payment-child.mjs');
const validId='tamper-operation';
const mutations={
  'TAMPER-01 capability':c=>{c.capabilityName='unknown.capability';},
  'TAMPER-02 amount':c=>{c.recoveryAuthorization.payload.authorization.value='999999';},
  'TAMPER-03 receiver':c=>{c.recoveryAuthorization.payload.authorization.to='0x2222222222222222222222222222222222222222';},
  'TAMPER-04 network':c=>{c.recoveryAuthorization.network='base';},
  'TAMPER-05 nonce':c=>{c.recoveryAuthorization.payload.authorization.nonce='0x'+'1'.repeat(64);},
  'TAMPER-06 idempotency_identity':c=>{c.idempotencyKey='tampered-operation';},
  'TAMPER-07 execution_identity':c=>{c.executionIdentity='tampered-execution';},
  'TAMPER-08 signed_authorization':c=>{c.recoveryAuthorization.payload.signature='0x'+'e'.repeat(128);}
};

async function one(label,mutate){
  const d=path.join(root,label.replaceAll(' ','-'));fs.mkdirSync(d);
  const dataFile=path.join(d,'state.json'),effectFile=path.join(d,'effect.json'),counterFile=path.join(d,'counters.json');
  const ch=fork(child,{silent:true,env:{...process.env,CK_COMBINED_CONFIG:JSON.stringify({dataFile,effectFile,counterFile,idempotencyKey:validId,checkpoint:'FULFILLMENT_CLAIMED',rejectVerify:false})}});
  await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('checkpoint timeout')),15000);ch.on('message',m=>{if(m.checkpoint==='FULFILLMENT_CLAIMED'){clearTimeout(t);resolve();}});ch.on('error',reject);ch.on('exit',(code,signal)=>{if(signal!=='SIGKILL')reject(new Error(`child exited ${code}/${signal}`));});});
  process.kill(ch.pid,'SIGKILL');const term=await new Promise(r=>ch.once('exit',(code,signal)=>r({code,signal})));
  const state=JSON.parse(fs.readFileSync(dataFile,'utf8'));const context=state.idempotency[validId].gate1b.context;mutate(context);fs.writeFileSync(dataFile,JSON.stringify(state,null,2));
  const rpc=await startHttpsRpcFixture();let verify=0,settle=0;
  const facilitator=async(url)=>{if(String(url).endsWith('/verify')){verify++;if(label.includes('signed_authorization'))return new Response(JSON.stringify({isValid:false}),{status:200});return new Response(JSON.stringify({isValid:true}),{status:200});}settle++;return new Response(JSON.stringify({success:true,transaction:'fixture'}),{status:200});};
  const fetchImpl=createFixtureFetch(rpc,facilitator);const effect=createExternalEffectAdapter(effectFile,{mode:'not_observed'});
  const core=createMachineCommerce({dataFile,receiver:RECEIVER,network:'eip155:84532',mainnetEnabled:false,publicBaseUrl:'https://mcp.example.test',facilitatorUrl:'https://facilitator.example.test',rpcUrl:rpc.url,kennekarteSecret:'x'.repeat(64),fetchImpl,executionDependencies:{execute:({idempotencyKey})=>effect.execute(idempotencyKey,{tamper:true})}});
  let error=null;
  try { await core.recoverExecutionOutcome(validId,{witness:async()=>effect.reconcile(validId)}); }
  catch (e) { error=e.code||e.message; }
  await rpc.close();
  const final=JSON.parse(fs.readFileSync(dataFile,'utf8'));
  return {case:label,termination:term,verify,settle,error,effect:effect.count(validId),receipts:Object.keys(final.receipts||{}).length,entitlements:Object.keys(final.entitlements||{}).length,pass:term.signal==='SIGKILL'&&Boolean(error)&&settle===0&&effect.count(validId)===0&&Object.keys(final.receipts||{}).length===0&&Object.keys(final.entitlements||{}).length===0};
}
const results=[];for(const [label,mutation] of Object.entries(mutations))results.push(await one(label,mutation));
fs.writeFileSync('proof/evidence/recovery-authorization-tampering.json',JSON.stringify({status:'FRESH_EXECUTION',results,passCount:results.filter(x=>x.pass).length,total:results.length},null,2)+'\n');
console.log(JSON.stringify(results,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
