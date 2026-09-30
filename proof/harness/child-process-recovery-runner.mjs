import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createProductionGate1B} from '../../lib/gate1b-production-adapter.mjs';
import {createExternalEffectAdapter} from './external-effect-adapter.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'ck-process-recovery-'));
const childPath=path.resolve('proof/harness/recovery-child.mjs');
function makeGate(dataFile,effectFile,witnessMode='normal'){
 const effect=createExternalEffectAdapter(effectFile,{mode:witnessMode});
 const prepare=args=>({capabilityName:'crossingkey.proof.external_echo',input:args.input,idempotencyKey:args.idempotencyKey,paymentPayload:{},requestHash:'request:'+args.idempotencyKey,paymentHash:'payment:'+args.idempotencyKey,replayKey:'replay:'+args.idempotencyKey,durableContext:{capabilityName:'crossingkey.proof.external_echo',input:args.input,idempotencyKey:args.idempotencyKey,replayKey:'replay:'+args.idempotencyKey,payment:{network:'fixture',asset:'fixture',amount:'1',payTo:'fixture',payer:'fixture',authorization:{nonce:args.idempotencyKey,validAfter:'0',validBefore:'9999999999'}}}});
 const finalize=(c,t,result)=>({status:'fulfilled',purchaseId:t.purchaseId,entitlementId:t.entitlementId,result,receipt:{id:t.receiptId,result,resultHash:'sha256:'+Buffer.from(JSON.stringify(result)).toString('hex').slice(0,64).padEnd(64,'0')},settlement:t.settlement,entitlement:{id:t.entitlementId,purchaseId:t.purchaseId,status:'consumed'}});
 return {effect,gate:createProductionGate1B({dataFile,prepare,verify:async()=>true,settle:async c=>({success:true,transaction:'fixture:'+c.idempotencyKey}),execute:async c=>effect.execute(c.idempotencyKey,c.input),finalize,reconcile:async()=>({outcome:'unknown'})})};
}
async function run(mode,witnessMode='normal'){
 const dir=path.join(root,mode);fs.mkdirSync(dir);const dataFile=path.join(dir,'state.json'),effectFile=path.join(dir,'effect.json'),idempotencyKey='recovery-'+mode.toLowerCase();
 const child=fork(childPath,{env:{...process.env,CK_RECOVERY_CHILD_CONFIG:JSON.stringify({mode,checkpoint:mode==='REC01'?'FULFILLMENT_CLAIMED':mode==='REC02_CONFIRMED'||mode==='REC03'?'REC03_POST_EFFECT_PRE_DURABLE_RESULT':mode.startsWith('REC02')?'EXECUTION_STARTED':'AFTER_DURABLE_KNOWLEDGE',dataFile,effectFile,idempotencyKey,witnessMode})},silent:true});
 const checkpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('checkpoint timeout '+mode)),15000);child.on('message',m=>{if(m.type==='checkpoint'){clearTimeout(timer);if(m.pid!==child.pid)reject(new Error('child pid mismatch'));else resolve(m);}});child.on('error',reject);});
 process.kill(child.pid,'SIGKILL');const exit=await new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));if(exit.signal!=='SIGKILL')throw new Error('child did not terminate by SIGKILL');
 const fresh=makeGate(dataFile,effectFile,witnessMode);let first;
 if(mode==='REC04') first=await fresh.gate.finalizeRecoveredOperation(idempotencyKey);
 else {first=await fresh.gate.recoverExecutionOutcome(idempotencyKey,{witness:async()=>fresh.effect.reconcile(idempotencyKey),resumeExecution:async c=>fresh.effect.execute(idempotencyKey,c.input)});if(first.action==='FINALIZE_LOCAL_STATE') first.finalization=await fresh.gate.finalizeRecoveredOperation(idempotencyKey);}
 const second=(first.action==='REMAIN_EXECUTION_UNKNOWN')?await fresh.gate.recoverExecutionOutcome(idempotencyKey,{witness:async()=>fresh.effect.reconcile(idempotencyKey),resumeExecution:async c=>fresh.effect.execute(idempotencyKey,c.input)}):await fresh.gate.finalizeRecoveredOperation(idempotencyKey);
 return {mode,childPid:child.pid,checkpoint,termination:exit,first,second,effectCount:fresh.effect.count(idempotencyKey),state:JSON.parse(fs.readFileSync(dataFile,'utf8')),witnessMode};
}
const results=[];for(const [mode,witness] of [['REC01','not_observed'],['REC02_NOT_OBSERVED','not_observed'],['REC02_UNKNOWN','unknown'],['REC02_CONFIRMED','normal'],['REC03','normal'],['REC04','normal']]){try{results.push(await run(mode,witness));}catch(error){results.push({mode,status:'FAILED',error:error.message});}}
const summary=results.map(r=>{const key=Object.keys(r.state?.idempotency||{})[0],tx=r.state?.idempotency?.[key]?.gate1b;return {mode:r.mode,childPid:r.childPid,checkpoint:r.checkpoint,termination:r.termination,witnessMode:r.witnessMode,firstAction:r.first?.action,secondAction:r.second?.action,executionCount:r.effectCount,externalEffectCount:r.effectCount,receiptCount:Object.keys(r.state?.receipts||{}).length,entitlementCount:Object.keys(r.state?.entitlements||{}).length,revenueEventCount:Object.keys(r.state?.revenueEvents||{}).length,durableResult:Boolean(tx?.durableResult),finalState:tx?.state,pass:r.termination?.signal==='SIGKILL'&&((r.mode==='REC02_UNKNOWN'&&tx?.state==='execution_unknown'&&r.effectCount===0)||(r.mode!=='REC02_UNKNOWN'&&tx?.state==='fulfilled'&&r.effectCount===1))};});
const evidence={status:'FRESH_EXECUTION',test_infrastructure:'isolated child processes and independent external-effect adapter',root,summary,raw_results:results};fs.writeFileSync(path.resolve('proof/evidence/process-death-harness.json'),JSON.stringify(evidence,null,2)+'\n');
if(summary.some(x=>!x.pass))process.exitCode=1;
console.log(JSON.stringify({status:evidence.status,root,summary}));
