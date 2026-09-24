import {keccak256,toHex} from 'viem';
import crypto from 'node:crypto';
import {readState,durableWrite,withProcessLock} from './gate1b-store.mjs';
import {verifyOnchain} from './onchain-verifier.mjs';

// This adapter shares the existing machine_commerce JSON as the sole authority.
// Existing idempotency.response, replayKeys, entitlements and receipts stay intact.
export function createProductionGate1B({dataFile,prepare,verify,settle,execute,finalize,reconcile,barrier=async()=>{}}){
 async function invoke(args){return withProcessLock(dataFile,async assertOwned=>{
  let state=readState(dataFile);const context=prepare(args);let record=state.idempotency[args.idempotencyKey];
  const persist=()=>{assertOwned();durableWrite(dataFile,state);};
  if(record){
   if(record.requestHash!==context.requestHash||record.paymentHash!==context.paymentHash)throw new Error('Idempotency key conflict');
   if(record.response)return {...record.response,duplicate:true};
   if(!record.gate1b)throw Object.assign(new Error('Legacy unresolved purchase requires reconciliation'),{code:'RECONCILIATION_REQUIRED'});
  }else{
   if(state.replayKeys[context.replayKey])throw new Error('Replay detected');
   if(await verify(context)!==true)throw new Error('Payment verification failed');assertOwned();
   if(!context.durableContext)throw new Error('Durable reconciliation context is required');
   record={requestHash:context.requestHash,paymentHash:context.paymentHash,gate1b:{state:'settlement_unknown',generation:1,context:structuredClone(context.durableContext),purchaseId:`ck_purchase_${crypto.randomUUID()}`,entitlementId:`ck_ent_${crypto.randomUUID()}`,receiptId:`ck_rcpt_${crypto.randomUUID()}`,createdAt:new Date().toISOString()}};
   state.idempotency[args.idempotencyKey]=record;state.revenueEvents??={};
   state.replayKeys[context.replayKey]={purchaseId:record.gate1b.purchaseId,status:'reserved'};persist();await barrier('INTENT_DURABLE',record.gate1b);assertOwned();
   // Once this call is entered, retry can ONLY reconcile; never settle again.
   let result;try{result=await settle(context);await barrier('AFTER_EXTERNAL_SETTLEMENT',record.gate1b);}catch(error){record.gate1b.lastError='Settlement outcome unknown';persist();throw Object.assign(new Error('Settlement outcome unknown; reconciliation required'),{code:'RECONCILIATION_REQUIRED'});}
   if(!result?.success||!result.transaction){persist();throw Object.assign(new Error('Settlement outcome unknown'),{code:'RECONCILIATION_REQUIRED'});}
   record.gate1b.settlement=result;record.gate1b.state='pending_fulfillment';record.gate1b.generation++;persist();await barrier('PENDING_DURABLE',record.gate1b);
  }
  const tx=record.gate1b;
  if(['settlement_unknown','unresolved'].includes(tx.state)){
   const proof=await reconcile(tx.context,tx);assertOwned();
   if(proof?.outcome!=='settled'||!proof.transaction){tx.state='unresolved';tx.reconciliation=proof??{outcome:'unknown'};persist();throw Object.assign(new Error('Settlement outcome unresolved; no settlement retry'),{code:'RECONCILIATION_REQUIRED'});}
   tx.settlement={success:true,transaction:proof.transaction,network:tx.context.payment.network};tx.reconciliation=proof;tx.state='pending_fulfillment';tx.generation++;persist();
  }
  if(tx.state==='executing'||tx.state==='execution_unknown'){
   // An arbitrary external side effect cannot be repeated merely because its owner died.
   tx.state='execution_unknown';persist();throw Object.assign(new Error('Execution outcome requires reconciliation'),{code:'EXECUTION_RECONCILIATION_REQUIRED'});
  }
  tx.state='claimed';tx.owner={pid:process.pid,token:crypto.randomUUID()};tx.generation++;persist();await barrier('FULFILLMENT_CLAIMED',tx);assertOwned();
  tx.state='executing';persist();await barrier('EXECUTION_STARTED',tx);const result=await execute(tx.context);assertOwned();
  const response=finalize(tx.context,tx,result);state=readState(dataFile);
  record=state.idempotency[args.idempotencyKey];
  if(record.gate1b.owner.token!==tx.owner.token)throw new Error('Fulfillment ownership changed');
  state.entitlements[response.entitlementId]=response.entitlement;
  delete response.entitlement;
  state.receipts[response.receipt.id]=response.receipt;
  record.response=response;record.gate1b.state='fulfilled';record.gate1b.generation++;
  state.replayKeys[tx.context.replayKey]={purchaseId:response.purchaseId,transaction:tx.settlement.transaction};
  state.revenueEvents??={};const eventId=response.receipt.id;
  if(state.revenueEvents[eventId])throw new Error('Revenue event already exists before finalization');
  state.revenueEvents[eventId]={id:eventId,receiptId:response.receipt.id,purchaseId:response.purchaseId,transaction:tx.settlement.transaction,capability:tx.context.capabilityName,network:tx.context.payment.network,amountAtomic:tx.context.payment.amount};
  persist();await barrier('FINALIZED',record.gate1b);return response;
 });}
 return {invoke,revenueEvents:()=>Object.values(readState(dataFile).revenueEvents||{})};
}

// Existing verification authority checks transaction success, chain, USDC transfer,
// payer, receiver, amount and confirmations. Missing hash remains UNKNOWN.
async function rpcAuthority(url,method,params,fetchImpl){
 if(!url||new URL(url).protocol!=='https:')throw new Error('TLS RPC authority is required');
 const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('RPC authority unavailable');const body=await response.json();if(body.error||body.jsonrpc!=='2.0')throw new Error('RPC response rejected');return body.result;
}
export async function captureReconciliationAnchor(context,{rpcUrl,fetchImpl=fetch}){
 if(await rpcAuthority(rpcUrl,'eth_chainId',[],fetchImpl)!=='0x2105')throw new Error('Reconciliation authority network mismatch');
 const block=await rpcAuthority(rpcUrl,'eth_blockNumber',[],fetchImpl);
 if(!/^0x[0-9a-f]+$/i.test(block))throw new Error('Invalid reconciliation anchor');
 context.reconciliationFromBlock=block;
 if(!context.durableContext)throw new Error('Durable reconciliation context is required');
 context.durableContext.reconciliationFromBlock=block;
 if(context.durableContext.reconciliationFromBlock!==context.reconciliationFromBlock)throw new Error('Durable reconciliation anchor mismatch');
}

// Canonical non-secret identity used by independent settlement witnesses.
// The signature and full payment payload are intentionally excluded.
export function durableSettlementBinding(context){
 const payment=context?.payment,authorization=payment?.authorization;
 const binding={
  payer:payment?.payer,
  payTo:payment?.payTo,
  network:payment?.network,
  asset:payment?.asset,
  amount:payment?.amount,
  authorization:{nonce:authorization?.nonce,validAfter:authorization?.validAfter,validBefore:authorization?.validBefore},
  requestHash:context?.requestHash,
  paymentHash:context?.paymentHash,
  capabilityName:context?.capabilityName,
  idempotencyKey:context?.idempotencyKey
 };
 const required=[binding.payer,binding.payTo,binding.network,binding.asset,binding.amount,binding.authorization.nonce,binding.authorization.validAfter,binding.authorization.validBefore,binding.requestHash,binding.paymentHash,binding.capabilityName,binding.idempotencyKey];
 if(required.some(value=>typeof value!=='string'||value.length===0))throw new Error('Incomplete durable settlement binding');
 return binding;
}
export async function reconcileProduction(context,tx,{rpcUrl,fallbackRpcUrl,fetchImpl=fetch}={}){
 try{
  if(context.payment.network!=='eip155:8453'||!context.reconciliationFromBlock)return {outcome:'unknown',reason:'Missing chain-bound pre-settlement anchor'};
  if(await rpcAuthority(rpcUrl,'eth_chainId',[],fetchImpl)!=='0x2105')return {outcome:'unknown',reason:'Wrong reconciliation network'};
  // ERC-3009 AuthorizationUsed binds the authorizer and nonce to a transaction.
  // Absence is UNKNOWN, never proof of permission to settle again.
  const topics=[keccak256(toHex('AuthorizationUsed(address,bytes32)')),'0x'+context.payment.payer.slice(2).toLowerCase().padStart(64,'0'),context.payment.authorization.nonce];
  const logs=await rpcAuthority(rpcUrl,'eth_getLogs',[{address:context.payment.asset,fromBlock:context.reconciliationFromBlock,toBlock:'latest',topics}],fetchImpl);
  const matches=Array.isArray(logs)?logs.filter(l=>!l.removed&&l.address?.toLowerCase()===context.payment.asset.toLowerCase()&&topics.every((t,i)=>l.topics?.[i]?.toLowerCase()===t.toLowerCase())):[];
  if(matches.some(l=>!l.blockNumber||BigInt(l.blockNumber)<BigInt(context.reconciliationFromBlock)))return {outcome:'unknown',reason:'Authorization predates durable anchor'};
  if(matches.length!==1)return {outcome:'unknown',reason:'No unique authenticated authorization observation'};
  const transaction=matches[0].transactionHash;
  if(tx.settlement?.transaction&&tx.settlement.transaction!==transaction)return {outcome:'unknown',reason:'Settlement transaction mismatch'};
  const receipt=await rpcAuthority(rpcUrl,'eth_getTransactionReceipt',[transaction],fetchImpl);
  if(!receipt?.logs?.some(l=>l.address?.toLowerCase()===context.payment.asset.toLowerCase()&&topics.every((t,i)=>l.topics?.[i]?.toLowerCase()===t.toLowerCase())))return {outcome:'unknown',reason:'Authorization absent from transaction receipt'};
  const proof=await verifyOnchain({txHash:transaction,receiver:context.payment.payTo,expected:{network:context.payment.network,token:context.payment.asset,payer:context.payment.payer,amountAtomic:context.payment.amount},rpcUrl,fallbackRpcUrl,fetchImpl});
  return proof.verified?{outcome:'settled',transaction,proof,authorization:{payer:context.payment.payer,nonce:context.payment.authorization.nonce,asset:context.payment.asset,fromBlock:context.reconciliationFromBlock}}:{outcome:'unknown',reason:proof.errorCode};
 }catch{return {outcome:'unknown',reason:'Settlement authority unavailable or invalid'};}
}
