import crypto from 'node:crypto';
import path from 'node:path';
import {canonicalizePayment,enforcePolicy,facilitatorCall,BASE_USDC,BASE_SEPOLIA_USDC,sha256} from './machine-commerce.mjs';
import {readJson,writeJson,withFileLock} from './marketplace-storage.mjs';
import {providerSchema,capabilitySchema,rightsSchema,validateSchema,validateValue,boundedJson,splitAmount,DELIVERY_TYPES} from './marketplace-schema.mjs';
import {createAdapters,validateEndpoint} from './marketplace-adapters.mjs';

const now=()=>new Date().toISOString();
const uid=prefix=>`ck_${prefix}_${crypto.randomUUID()}`;
const empty=()=>({version:1,providers:{},capabilities:{},intakes:{},approvals:{},jobs:{},receipts:{},entitlements:{},allocations:{},purchases:{},audit:[]});
export const NATIVE_PLANNED=['commercialization.audit','productize.asset','productize.software','workflow.audit','mcp.audit','mcp.monetize','product.verify','creator.package','commerce.deploy'];
export const FAILURE_CODES=['PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','INVALID_PROVIDER_RESPONSE','DELIVERY_FAILED','VERIFICATION_FAILED','CAPABILITY_DISABLED','PAYMENT_FAILED','ENTITLEMENT_FAILED','INTERNAL_ERROR'];
const codeOf=error=>FAILURE_CODES.includes(error.message)?error.message:'INTERNAL_ERROR';
function admin(principal) {if(principal?.role!=='admin') throw new Error('UNAUTHORIZED');}
function owner(principal,providerId) {if(principal?.role!=='admin'&&(principal?.role!=='provider'||principal.providerId!==providerId)) throw new Error('UNAUTHORIZED');}
function buyer(principal,reference) {if(principal?.role!=='admin'&&(principal?.role!=='buyer'||principal.buyerReference!==reference)) throw new Error('UNAUTHORIZED');}
function safeProvider(p) {if(!p)return null;const {contact,...publicFields}=p;return {...publicFields,reputation:'NEW / UNRATED'};}
function safeCapability(c) {if(!c)return null;const {executionEndpoint,...metadata}=c;return {...metadata,executionEndpoint:executionEndpoint?'operator-bound HTTPS adapter':null};}

export function createMarketplace({core,dataFile=path.resolve('data/marketplace.json'),feeBps=1000,adapters=createAdapters(),maxRecords=10000}={}) {
  splitAmount('1',feeBps);
  const read=()=>readJson(dataFile,empty());
  const write=s=>{if(Buffer.byteLength(JSON.stringify(s))>64*1024*1024)throw new Error('STORE_CAPACITY');writeJson(dataFile,s);};
  const update=operation=>withFileLock(dataFile,()=>{const s=read();const result=operation(s);write(s);return result;});
  function recordAudit(s,operation,target,principal) {s.audit.push({operation,target,actor:principal?.id||principal?.role||'public',timestamp:now()});}
  function capacity(collection) {if(Object.keys(collection).length>=maxRecords) throw new Error('STORE_CAPACITY');}
  function eligible(s,capabilityId) {
    const c=s.capabilities[capabilityId];
    if(!c||c.status!=='active'||s.providers[c.providerId]?.status!=='active'||c.visibility!=='public'||c.rights?.affirmed!==true) throw new Error('CAPABILITY_DISABLED');
    if(!core||c.network!==core.config.network) throw new Error('PAYMENT_FAILED');
    return c;
  }
  function requirement(c,version=2) {
    if(!core) throw new Error('PAYMENT_FAILED');
    const common={scheme:'exact',network:version===1?(c.network==='eip155:8453'?'base':'base-sepolia'):c.network,
      asset:c.network==='eip155:8453'?BASE_USDC:BASE_SEPOLIA_USDC,payTo:core.config.receiver,maxTimeoutSeconds:60,extra:{name:'USDC',version:'2'}};
    return version===1?{...common,maxAmountRequired:c.price,resource:`${core.config.publicBaseUrl}/api/marketplace/purchase`,description:c.description,mimeType:'application/json'}:{...common,amount:c.price};
  }
  function makeQuote(s,capabilityId) {
    const c=eligible(s,capabilityId),allocation=splitAmount(c.price,c.crossingKeyFee.bps);
    const quote={capability:safeCapability(c),...allocation,network:c.network,currency:c.currency,
      feeBps:c.crossingKeyFee.bps,paymentRequirement:{v1:requirement(c,1),v2:requirement(c,2)},
      deliveryExpectations:{type:c.deliveryType,timeoutSeconds:8},
      refundFailurePolicy:'Payment and delivery are separate. Failed paid jobs are disputed; balances are not payable until verified delivery. Refunds require operator reconciliation; no automatic refund or payout.',humanAuthorizationRequired:true};
    return {...quote,quoteHash:sha256(quote)};
  }
  function describe() {const s=read();return {marketplace:true,machineCommerce:true,
    purpose:'Creator-owned capabilities with post-sale allocation and buyer-authorized payment.',
    providerCount:Object.values(s.providers).filter(p=>p.status==='active').length,
    activeCapabilityCount:Object.values(s.capabilities).filter(c=>c.status==='active'&&c.visibility==='public'&&s.providers[c.providerId]?.status==='active').length,
    supportedDeliveryTypes:DELIVERY_TYPES,paymentMethods:['x402-v1','x402-v2','Base USDC','Base Sepolia USDC'],
    feePolicy:{defaultBps:feeBps,rounding:'platform floor; remainder to provider',atomicUnits:true},
    walletMode:'receiver-only',providerPayouts:'manual accounting only',creatorOwnershipRetained:true,aiTrainingDefault:false,
    plannedCapabilities:NATIVE_PLANNED.map(name=>({name,status:'planned',purchasable:false}))};}
  async function registerProvider(input) {boundedJson(input);const p=providerSchema.parse(input);
    return update(s=>{capacity(s.providers);if(Object.values(s.providers).some(x=>x.slug===p.slug))throw new Error('SLUG_EXISTS');
      const provider={...p,providerId:uid('provider'),status:'pending',createdAt:now(),updatedAt:now()};s.providers[provider.providerId]=provider;return safeProvider(provider);});}
  async function applyCreator(input) {boundedJson(input);const {provider,summary}=input;
    providerSchema.parse(provider);if(typeof summary!=='string'||summary.length<1||summary.length>4000)throw new Error('INVALID_INPUT');
    return update(s=>{capacity(s.intakes);const intake={intakeId:uid('intake'),provider,summary,status:'pending',ownershipTransferred:false,aiTrainingPermission:false,createdAt:now()};s.intakes[intake.intakeId]=intake;return {intakeId:intake.intakeId,status:'pending',ownershipTransferred:false,aiTrainingPermission:false};});}
  async function registerCapability(input,principal,{stagedImport=false}={}) {
    if(stagedImport)admin(principal);
    boundedJson(input);const cap=(stagedImport?capabilitySchema.omit({rights:true}):capabilitySchema).parse(input);owner(principal,cap.providerId);
    validateSchema(cap.inputSchema);validateSchema(cap.outputSchema);
    if(cap.executionEndpoint)await validateEndpoint(cap.executionEndpoint);
    if(/(?:\/home\/|\/tmp\/|file:\/\/|[A-Z]:\\)/i.test(cap.sourceProvenance))throw new Error('PRIVATE_PATH_FORBIDDEN');
    return update(s=>{capacity(s.capabilities);if(!s.providers[cap.providerId]||(!stagedImport&&s.providers[cap.providerId]?.status!=='active'))throw new Error('PROVIDER_INACTIVE');
      if(Object.values(s.capabilities).some(x=>x.slug===cap.slug))throw new Error('SLUG_EXISTS');
      const allocation=splitAmount(cap.price,feeBps);
      const capability={...cap,capabilityId:uid('capability'),status:'planned',createdAt:now(),updatedAt:now(),
        crossingKeyFee:{bps:feeBps,amount:allocation.platformAmount},providerShare:allocation.providerAmount,
        rights:stagedImport?{ownershipRepresentation:'First-party catalog metadata; operator rights affirmation required before activation.',distributionPermission:false,commercializationPermission:false,aiTrainingPermission:false,derivativePermission:false,affirmed:false,revocationPolicy:'Pending operator review',affirmationTimestamp:null,affirmationVersion:null,ownershipTransferred:false,affirmationSource:'catalog-metadata-only'}:{...cap.rights,affirmationTimestamp:now(),affirmationVersion:'ck-rights/1',ownershipTransferred:false},
        provenance:{version:cap.version,provider:cap.providerId,registrationTimestamp:now(),source:cap.sourceProvenance,contentHash:cap.contentHash||null,transformations:[]}};
      s.capabilities[capability.capabilityId]=capability;return safeCapability(capability);});
  }
  async function setProviderStatus(providerId,status,principal) {
    admin(principal);if(!['pending','active','suspended','rejected'].includes(status))throw new Error('INVALID_STATUS');
    return update(s=>{const p=s.providers[providerId];if(!p)throw new Error('NOT_FOUND');p.status=status;p.updatedAt=now();recordAudit(s,'provider.status',providerId,principal);return safeProvider(p);});
  }
  async function setCapabilityStatus(capabilityId,status,principal,visibility) {
    admin(principal);if(!['active','beta','planned','disabled'].includes(status))throw new Error('INVALID_STATUS');
    if(visibility!==undefined&&!['public','private'].includes(visibility))throw new Error('INVALID_INPUT');
    const current=read().capabilities[capabilityId];if(!current)throw new Error('NOT_FOUND');
    if(status==='active'&&current.rights?.affirmed!==true)throw new Error('RIGHTS_AFFIRMATION_REQUIRED');
    if(status==='active')await adapters.preflight(current);
    return update(s=>{const c=s.capabilities[capabilityId];if(status==='active'&&s.providers[c.providerId]?.status!=='active')throw new Error('PROVIDER_INACTIVE');
      c.status=status;if(visibility!==undefined)c.visibility=visibility;c.updatedAt=now();recordAudit(s,'capability.status',capabilityId,principal);return safeCapability(c);});
  }
  async function affirmCapabilityRights(capabilityId,input,principal) {
    admin(principal);boundedJson(input);const rights=rightsSchema.parse(input);
    return update(s=>{const c=s.capabilities[capabilityId];if(!c)throw new Error('NOT_FOUND');c.rights={...rights,affirmationTimestamp:now(),affirmationVersion:'ck-rights/1',ownershipTransferred:false};c.updatedAt=now();recordAudit(s,'capability.rights.affirmed',capabilityId,principal);return safeCapability(c);});
  }
  function getProvider(providerId,principal) {const p=read().providers[providerId];if(!p)return null;if(p.status!=='active')owner(principal,providerId);return safeProvider(p);}
  function getCapability(capabilityId,principal) {const s=read(),c=s.capabilities[capabilityId];if(!c)return null;
    if(c.visibility!=='public'||c.status!=='active'||s.providers[c.providerId]?.status!=='active')owner(principal,c.providerId);return safeCapability(c);}
  function search({query='',category,provider,deliveryType,minPrice,maxPrice,offset=0,limit=25}={}) {
    const s=read(),q=query.toLowerCase();
    const found=Object.values(s.capabilities).filter(c=>c.status==='active'&&c.visibility==='public'&&s.providers[c.providerId]?.status==='active'&&
      (!q||`${c.name} ${c.description} ${c.category}`.toLowerCase().includes(q))&&(!category||c.category===category)&&(!provider||c.providerId===provider)&&(!deliveryType||c.deliveryType===deliveryType)&&
      (minPrice===undefined||BigInt(c.price)>=BigInt(minPrice))&&(maxPrice===undefined||BigInt(c.price)<=BigInt(maxPrice)));
    function score(c) {const jobs=Object.values(s.jobs).filter(j=>j.capabilityId===c.capabilityId);return (c.name.toLowerCase()===q?100:0)+(category===c.category?20:0)+jobs.filter(j=>j.status==='verified').length-jobs.filter(j=>['failed','disputed'].includes(j.status)).length;}
    found.sort((a,b)=>score(b)-score(a)||a.name.localeCompare(b.name)||a.capabilityId.localeCompare(b.capabilityId));
    return {items:found.slice(offset,offset+limit).map(safeCapability),total:found.length,offset,limit,ranking:'deterministic; no paid placement; observed job counts only'};
  }
  function quote(capabilityId) {return makeQuote(read(),capabilityId);}
  // Deliberately not exposed as an MCP tool. Only local human operator CLI/test fixtures call this.
  async function approvePurchase({capabilityId,buyerReference,idempotencyKey,input,expiresAt},principal) {
    admin(principal);boundedJson(input);
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)||!buyerReference||buyerReference.length>160||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Date.now()+3600000)throw new Error('INVALID_APPROVAL');
    return update(s=>{capacity(s.approvals);const c=eligible(s,capabilityId);validateValue(c.inputSchema,input);
      const approval={approvalId:uid('approval'),capabilityId,buyerReference,idempotencyKey,inputHash:sha256(input),quoteHash:makeQuote(s,capabilityId).quoteHash,expiresAt,createdAt:now(),used:false};
      s.approvals[approval.approvalId]=approval;recordAudit(s,'human.purchase.approval',approval.approvalId,principal);return approval;});
  }
  function assertApproval(s,args,principal,c) {
    if(principal?.role!=='buyer'||!principal.buyerReference)throw new Error('UNAUTHORIZED');
    const approval=s.approvals[args.approvalId];
    if(!approval||approval.used||approval.buyerReference!==principal.buyerReference||approval.capabilityId!==c.capabilityId||approval.idempotencyKey!==args.idempotencyKey||approval.inputHash!==sha256(args.input)||approval.quoteHash!==makeQuote(s,c.capabilityId).quoteHash||Date.parse(approval.expiresAt)<=Date.now())throw new Error('HUMAN_AUTHORIZATION_REQUIRED');
    return approval;
  }
  async function purchase(args,principal) {
    boundedJson(args);if(!core)throw new Error('PAYMENT_FAILED');
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey||''))throw new Error('INVALID_INPUT');
    if(principal?.role!=='buyer')throw new Error('UNAUTHORIZED');
    return withFileLock(core.config.dataFile,()=>withFileLock(dataFile,async()=>{
      const s=read(),key=sha256({buyer:principal.buyerReference,key:args.idempotencyKey}),requestHash=sha256(args);
      const prior=s.purchases[key];
      if(prior) {
        if(prior.requestHash!==requestHash)throw new Error('IDEMPOTENCY_CONFLICT');
        if(prior.response)return {...prior.response,duplicate:true};
        const stranded=s.jobs[prior.jobId];
        if(stranded){stranded.status='disputed';stranded.errorCode='RECONCILIATION_REQUIRED';stranded.updatedAt=now();write(s);}
        return {status:'disputed',paymentStatus:prior.paymentStatus||'unknown',jobId:prior.jobId,errorCode:'RECONCILIATION_REQUIRED',duplicate:true};
      }
      const c=eligible(s,args.capabilityId);validateValue(c.inputSchema,args.input);
      // Reserve room for the bounded output, receipt, duplicated idempotent response and journal.
      if(Buffer.byteLength(JSON.stringify(s))>60*1024*1024)throw new Error('STORE_CAPACITY');
      const approval=assertApproval(s,args,principal,c);
      await adapters.preflight(c);
      const version=args.paymentPayload?.x402Version,expected=requirement(c,version);
      let payment;try{payment=canonicalizePayment(args.paymentPayload,expected);enforcePolicy(payment,expected,core.config);}catch{throw new Error('PAYMENT_FAILED');}
      const coreState=readJson(core.config.dataFile,{version:1,idempotency:{},replayKeys:{},receipts:{},entitlements:{}});
      const replayKey=`${payment.network}:${payment.authorization.nonce}`;
      if(coreState.replayKeys[replayKey])throw new Error('REPLAY_DETECTED');
      capacity(s.jobs);capacity(s.purchases);
      const purchaseId=uid('purchase'),jobId=uid('job'),receiptId=uid('rcpt'),entitlementId=uid('ent');
      const job={jobId,capabilityId:c.capabilityId,providerId:c.providerId,buyerReference:principal.buyerReference,receiptId,status:'awaiting_payment',inputHash:sha256(args.input),outputHash:null,createdAt:now(),updatedAt:now(),history:[{status:'quoted',timestamp:now()},{status:'awaiting_payment',timestamp:now()}]};
      s.jobs[jobId]=job;s.purchases[key]={requestHash,jobId,paymentStatus:'unverified'};approval.used=true;
      // Journal BEFORE any facilitator request; a crash never silently retries a settlement.
      write(s);coreState.replayKeys[replayKey]={purchaseId,marketplace:true,status:'reserved'};writeJson(core.config.dataFile,coreState);
      const transition=status=>{job.status=status;job.updatedAt=now();job.history.push({status,timestamp:now()});};
      let settled,result,receipt,entitlement,allocation;
      try {
        const verification=await facilitatorCall(core.config,'verify',args.paymentPayload,expected);
        if(!(verification.isValid===true||verification.valid===true))throw new Error('PAYMENT_FAILED');
        s.purchases[key].paymentStatus='settlement_pending';write(s);
        settled=await facilitatorCall(core.config,'settle',args.paymentPayload,expected);
        if(settled.success!==true||!settled.transaction)throw new Error('PAYMENT_FAILED');
        s.purchases[key].paymentStatus='successful';transition('paid');
        receipt={receiptVersion:'ck/1',id:receiptId,purchaseId,capability:c.capabilityId,holder:payment.payer,entitlementId,
          payment:{protocol:'x402',version,network:payment.network,asset:payment.asset,amount:payment.amount,payTo:payment.payTo,transaction:settled.transaction},
          xkeyHash:sha256({capability:c.capabilityId,inputHash:job.inputHash,jobId}),resultHash:sha256({status:'pending'}),result:{status:'pending'},completedAt:null};
        entitlement={id:entitlementId,purchaseId,capability:c.capabilityId,buyerReference:principal.buyerReference,holder:payment.payer,status:'active',usesRemaining:1,createdAt:now()};
        allocation={allocationId:uid('allocation'),receiptId,providerId:c.providerId,capabilityId:c.capabilityId,...splitAmount(c.price,c.crossingKeyFee.bps),currency:c.currency,network:c.network,status:'recorded',createdAt:now()};
        s.receipts[receiptId]=receipt;s.entitlements[entitlementId]=entitlement;s.allocations[allocation.allocationId]=allocation;write(s);
        transition('executing');write(s);
        result=await adapters.executeCapability({capability:c,input:args.input,job:structuredClone(job),entitlement:structuredClone(entitlement),receipt:structuredClone(receipt)});
        boundedJson(result,262144);validateValue(c.outputSchema,result);
        transition('delivered');job.outputHash=sha256(result);job.deliveredAt=now();write(s);
        receipt.result=result;receipt.resultHash=job.outputHash;receipt.completedAt=now();
        if(!core.verifyReceipt(receipt))throw new Error('VERIFICATION_FAILED');
        transition('verified');job.verifiedAt=now();allocation.status='payable';
        entitlement.status=c.deliveryType==='digital_asset'?'active':'consumed';entitlement.usesRemaining=c.deliveryType==='digital_asset'?3:0;
      } catch(error) {
        const paid=s.purchases[key].paymentStatus==='successful',uncertain=s.purchases[key].paymentStatus==='settlement_pending';
        transition(paid?'failed':uncertain?'disputed':'failed');job.errorCode=paid?codeOf(error):'PAYMENT_FAILED';
        if(allocation)allocation.status='disputed';
        if(entitlement)entitlement.status='suspended';
        if(receipt){receipt.result={status:'failed',errorCode:job.errorCode};receipt.resultHash=sha256(receipt.result);receipt.completedAt=now();}
        if(!paid&&!uncertain)s.purchases[key].paymentStatus='failed';
      }
      const response={status:job.status,paymentStatus:s.purchases[key].paymentStatus,job:structuredClone(job),
        ...(receipt?{receipt,entitlementId,allocation}:{}),...(result&&job.status==='verified'?{result}:{}),...(job.errorCode?{errorCode:job.errorCode}:{})};
      s.purchases[key].response=response;write(s);
      // Project compatible paid receipts/entitlements into the existing read-only inspection tools.
      if(receipt) {const latest=readJson(core.config.dataFile,coreState);latest.receipts[receipt.id]=receipt;latest.entitlements[entitlementId]=entitlement;latest.replayKeys[replayKey].status=job.status;latest.replayKeys[replayKey].transaction=settled.transaction;writeJson(core.config.dataFile,latest);}
      return response;
    }));
  }
  function jobStatus(jobId,principal) {const job=read().jobs[jobId];if(!job)return null;
    if(principal?.role==='provider')owner(principal,job.providerId);else buyer(principal,job.buyerReference);
    const {buyerReference,...safe}=job;return safe;}
  function getReceipt(receiptId,principal) {const s=read(),receipt=s.receipts[receiptId];if(!receipt)return null;
    const job=Object.values(s.jobs).find(j=>j.receiptId===receiptId);buyer(principal,job.buyerReference);
    return {receipt,allocation:Object.values(s.allocations).find(a=>a.receiptId===receiptId)||null};}
  function listAllocations(providerId,principal,{offset=0,limit=25}={}) {owner(principal,providerId);const all=Object.values(read().allocations).filter(a=>a.providerId===providerId);return {items:all.slice(offset,offset+limit),total:all.length};}
  function getProviderBalance(providerId,principal) {owner(principal,providerId);const groups={};
    for(const a of Object.values(read().allocations).filter(x=>x.providerId===providerId)){const key=`${a.network}:${a.currency}`;const g=groups[key] ||= {network:a.network,currency:a.currency,recorded:'0',payable:'0',settled:'0',refunded:'0',disputed:'0'};g[a.status]=String(BigInt(g[a.status])+BigInt(a.providerAmount));}
    return {providerId,balances:Object.values(groups),accountingOnly:true,automaticPayouts:false};}
  async function markSettled(allocationId,reference,principal) {admin(principal);if(typeof reference!=='string'||reference.length<3||reference.length>300)throw new Error('INVALID_INPUT');
    return update(s=>{const a=s.allocations[allocationId];if(!a)throw new Error('NOT_FOUND');if(a.status==='settled'&&a.settlementReference===reference)return a;
      if(a.status!=='payable')throw new Error('INVALID_STATUS');a.status='settled';a.settlementReference=reference;a.settledAt=now();recordAudit(s,'settlement.markSettled',allocationId,principal);return {...a,moneyMoved:false};});}
  async function download(entitlementId,principal) {
    return withFileLock(dataFile,async()=>{const s=read(),ent=s.entitlements[entitlementId];if(!ent)throw new Error('NOT_FOUND');buyer(principal,ent.buyerReference);
      if(ent.status!=='active'||ent.usesRemaining<=0)throw new Error('ENTITLEMENT_FAILED');
      const c=s.capabilities[ent.capability];const info=await adapters.delivery(c);
      ent.usesRemaining--;write(s);return info;});
  }
  return {dataFile,describe,registerProvider,applyCreator,registerCapability,setProviderStatus,setCapabilityStatus,affirmCapabilityRights,getProvider,getCapability,search,quote,approvePurchase,purchase,jobStatus,getReceipt,listAllocations,getProviderBalance,markSettled,download};
}
