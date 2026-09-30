import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createMachineCommerce,RECEIVER} from '../../lib/machine-commerce.mjs';
import {startHttpsRpcFixture,createFixtureFetch} from '../../tests/fixtures/https-rpc-fixture.mjs';
import {createExternalEffectAdapter} from './external-effect-adapter.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ck-combined-payment-')),child=path.resolve('proof/harness/combined-payment-child.mjs');
async function run(name,checkpoint,rejectVerify=false,witnessMode='not_observed'){
  const d=path.join(root,name);fs.mkdirSync(d);
  const dataFile=path.join(d,'state.json'),effectFile=path.join(d,'effect.json'),counterFile=path.join(d,'counters.json'),idempotencyKey='combined-'+name.toLowerCase();
  const ch=fork(child,{silent:true,env:{...process.env,CK_COMBINED_CONFIG:JSON.stringify({dataFile,effectFile,counterFile,idempotencyKey,checkpoint,rejectVerify:false})}});
  const m=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('checkpoint timeout')),15000);ch.on('message',x=>{clearTimeout(t);if(x?.checkpoint!==checkpoint)rej(new Error(`unexpected checkpoint ${x?.checkpoint}`));else res(x)});ch.on('error',rej);ch.on('exit',(code,signal)=>{clearTimeout(t);rej(new Error(`child exited before checkpoint code=${code} signal=${signal}`));});if(ch.stderr)ch.stderr.on('data',b=>process.stderr.write(`[${name}:child] ${b}`));});
  if(m.pid!==ch.pid)throw Error('pid mismatch');
  process.kill(ch.pid,'SIGKILL');
  const term=await new Promise(r=>ch.once('exit',(code,signal)=>r({code,signal})));
  const rpc=await startHttpsRpcFixture();
  const counters=()=>fs.existsSync(counterFile)?JSON.parse(fs.readFileSync(counterFile,'utf8')):{};
  const facilitator=async(url,init)=>{const op=String(url).endsWith('/verify')?'verify':'settle';const s=counters();s[`recovery_${op}`]=(s[`recovery_${op}`]||0)+1;fs.writeFileSync(counterFile,JSON.stringify(s));if(op==='verify'&&rejectVerify)return new Response(JSON.stringify({isValid:false}),{status:200});return new Response(JSON.stringify(op==='verify'?{isValid:true}:{success:true,transaction:'fixture:'+idempotencyKey}),{status:200});};
  const fetchImpl=createFixtureFetch(rpc,facilitator);
  const effect=createExternalEffectAdapter(effectFile,{mode:witnessMode});
  const core=createMachineCommerce({dataFile,receiver:RECEIVER,network:'eip155:84532',mainnetEnabled:false,publicBaseUrl:'https://mcp.example.test',facilitatorUrl:'https://facilitator.example.test',rpcUrl:rpc.url,kennekarteSecret:'x'.repeat(64),fetchImpl,executionDependencies:{execute:({capabilityName,input,idempotencyKey})=>effect.execute(idempotencyKey,{capabilityName,...input})}});
  let recoveryError=null;let first=null;try{first=await core.recoverExecutionOutcome(idempotencyKey,{witness:async()=>effect.reconcile(idempotencyKey)});if(first.action==='FINALIZE_LOCAL_STATE')await core.finalizeRecoveredOperation(idempotencyKey);}catch(e){recoveryError=e.code||e.message;}
  const second=first?.action==='REMAIN_EXECUTION_UNKNOWN'?await core.recoverExecutionOutcome(idempotencyKey,{witness:async()=>effect.reconcile(idempotencyKey)}):await core.finalizeRecoveredOperation(idempotencyKey);await rpc.close();
  const state=JSON.parse(fs.readFileSync(dataFile,'utf8'));const successful=state.state?.[idempotencyKey]||state.transactions?.[idempotencyKey]?.state;
  const stateSummary={version:state.version,operationState:state.idempotency?.[idempotencyKey]?.gate1b?.state||null,durableResult:Boolean(state.idempotency?.[idempotencyKey]?.gate1b?.durableResult),receiptCount:Object.keys(state.receipts||{}).length,entitlementCount:Object.keys(state.entitlements||{}).length,revenueEventCount:(state.revenueEvents||[]).length};
  const counts=counters();const rejected=Boolean(rejectVerify);
  const pass=term.signal==='SIGKILL'&&(rejected?Boolean(recoveryError)&&effect.count(idempotencyKey)===0:(witnessMode==='unknown'?first?.action==='REMAIN_EXECUTION_UNKNOWN'&&effect.count(idempotencyKey)===0:Object.keys(state.receipts||{}).length===1&&effect.count(idempotencyKey)===1&&!recoveryError));
  return {name,checkpoint:m,termination:term,recoveryError,first,second,counters:counts,effectCount:effect.count(idempotencyKey),stateSummary,successful,pass};
}
const results=[];for(const x of [['REC01','FULFILLMENT_CLAIMED',false,'not_observed'],['REC01_REJECT','FULFILLMENT_CLAIMED',true,'not_observed'],['REC02B','EXECUTION_STARTED',false,'not_observed'],['REC02B_REJECT','EXECUTION_STARTED',true,'not_observed'],['REC02_CONFIRMED','REC03_POST_EFFECT_PRE_DURABLE_RESULT',false,'normal'],['REC02_UNKNOWN','EXECUTION_STARTED',false,'unknown'],['REC03','REC03_POST_EFFECT_PRE_DURABLE_RESULT',false,'normal'],['REC04','AFTER_DURABLE_KNOWLEDGE',false,'normal']]){try{results.push(await run(...x));}catch(e){results.push({name:x[0],pass:false,error:e.message});}}fs.writeFileSync('proof/evidence/combined-payment-recovery.json',JSON.stringify({status:'FRESH_EXECUTION',results},null,2)+'\n');console.log(JSON.stringify(results.map(x=>({name:x.name,pass:x.pass,termination:x.termination,recoveryError:x.recoveryError,effectCount:x.effectCount,second:x.second?.action,counters:x.counters})),null,2));if(results.some(x=>!x.pass))process.exitCode=1;
