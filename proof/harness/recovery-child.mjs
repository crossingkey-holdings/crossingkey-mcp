import fs from 'node:fs';
import { createProductionGate1B } from '../../lib/gate1b-production-adapter.mjs';
import { createExternalEffectAdapter } from './external-effect-adapter.mjs';

const cfg=JSON.parse(process.env.CK_RECOVERY_CHILD_CONFIG);
const effect=createExternalEffectAdapter(cfg.effectFile,{mode:cfg.witnessMode||'normal'});
const ack=checkpoint=>process.send?.({type:'checkpoint',checkpoint,pid:process.pid});
const wait=()=>new Promise(()=>{});
const prepare=args=>({capabilityName:'crossingkey.proof.external_echo',input:args.input,idempotencyKey:args.idempotencyKey,paymentPayload:{},requestHash:'request:'+args.idempotencyKey,paymentHash:'payment:'+args.idempotencyKey,replayKey:'replay:'+args.idempotencyKey,durableContext:{capabilityName:'crossingkey.proof.external_echo',input:args.input,idempotencyKey:args.idempotencyKey,replayKey:'replay:'+args.idempotencyKey,payment:{network:'fixture',asset:'fixture',amount:'1',payTo:'fixture',payer:'fixture',authorization:{nonce:args.idempotencyKey,validAfter:'0',validBefore:'9999999999'}}}});
const finalize=(c,t,result)=>({status:'fulfilled',purchaseId:t.purchaseId,entitlementId:t.entitlementId,result,receipt:{id:t.receiptId,result,resultHash:'sha256:'+requireHash(result)},settlement:t.settlement,entitlement:{id:t.entitlementId,purchaseId:t.purchaseId,status:'consumed'}});
function requireHash(value){return Buffer.from(JSON.stringify(value)).toString('hex').slice(0,64).padEnd(64,'0');}
const barrier=async point=>{if(point===cfg.checkpoint){ack(point);await wait();}};
const gate=createProductionGate1B({dataFile:cfg.dataFile,prepare,verify:async()=>true,settle:async c=>({success:true,transaction:'fixture:'+c.idempotencyKey}),execute:async c=>{if(cfg.mode==='REC03'||cfg.mode==='REC02_CONFIRMED'){const out=effect.execute(c.idempotencyKey,c.input);ack('REC03_POST_EFFECT_PRE_DURABLE_RESULT');await wait();return out;}return effect.execute(c.idempotencyKey,c.input);},finalize,reconcile:async()=>({outcome:'unknown'}),barrier});
if(cfg.mode==='REC01'||cfg.mode.startsWith('REC02')||cfg.mode==='REC04'||cfg.mode==='REC03'){
  if(cfg.mode==='REC01') await gate.invoke({capabilityName:'crossingkey.proof.external_echo',input:{message:'recovery'},idempotencyKey:cfg.idempotencyKey,paymentPayload:{}});
  else await gate.invoke({capabilityName:'crossingkey.proof.external_echo',input:{message:'recovery'},idempotencyKey:cfg.idempotencyKey,paymentPayload:{}});
}
