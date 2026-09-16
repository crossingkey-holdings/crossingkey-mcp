import crypto from 'node:crypto';
import {z} from 'zod';
import {readJson} from './marketplace-storage.mjs';
import {id,atomic,providerSchema,capabilitySchema,boundedJson,DELIVERY_TYPES} from './marketplace-schema.mjs';

export function resolveMarketplacePrincipal(authorization,file) {
  if(!file||typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization))return null;
  const hash=crypto.createHash('sha256').update(authorization.slice(7)).digest('hex');
  const entry=readJson(file,{principals:{}}).principals?.[hash];
  if(!entry||!['admin','buyer','provider'].includes(entry.role)||!entry.id||entry.disabled||!Number.isFinite(Date.parse(entry.expiresAt))||Date.parse(entry.expiresAt)<=Date.now())return null;
  return {...entry,credentialHash:hash};
}

export function createRateLimit({max=120,windowMs=60000,maxKeys=2000}={}) {
  const buckets=new Map();
  return key=>{
    const current=Date.now();
    for(const [k,v] of buckets)if(v.until<=current)buckets.delete(k);
    if(!buckets.has(key)&&buckets.size>=maxKeys)throw new Error('RATE_LIMITED');
    const bucket=buckets.get(key)||{until:current+windowMs,count:0};
    if(++bucket.count>max)throw new Error('RATE_LIMITED');buckets.set(key,bucket);
  };
}

export const purchaseSchema=z.object({capabilityId:id,approvalId:id,idempotencyKey:z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/),input:z.record(z.unknown()),paymentPayload:z.record(z.unknown())}).strict();
const paging={offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(100).default(25)};
const searchSchema=z.object({query:z.string().max(160).optional(),category:id.optional(),provider:id.optional(),deliveryType:z.enum(DELIVERY_TYPES).optional(),minPrice:atomic.optional(),maxPrice:atomic.optional(),...paging}).strict();
const publicCodes=new Set(['UNAUTHORIZED','NOT_FOUND','HUMAN_AUTHORIZATION_REQUIRED','PAYMENT_FAILED','CAPABILITY_DISABLED','PROVIDER_INACTIVE','INVALID_STATUS','INVALID_INPUT','INVALID_SCHEMA','INVALID_ENDPOINT','UNSUPPORTED_SCHEMA_KEYWORD','SCHEMA_VALIDATION_FAILED','PAYLOAD_TOO_LARGE','RATE_LIMITED','STORE_BUSY','STORE_CAPACITY','SLUG_EXISTS','REPLAY_DETECTED','IDEMPOTENCY_CONFLICT','SSRF_BLOCKED','DELIVERY_FAILED','VERIFICATION_FAILED','ENTITLEMENT_FAILED','PRIVATE_PATH_FORBIDDEN']);
export function safeError(error) {return error?.name==='ZodError'?'INVALID_INPUT':publicCodes.has(error?.message)?error.message:'INTERNAL_ERROR';}
export function registerMarketplaceTools(server,{marketplace,principal,legacyCapabilities,core,rate=()=>{}}) {
  const add=(name,schema,description,write,handler)=>server.registerTool(name,{
    description,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:write,openWorldHint:name==='capability.purchase'},
    _meta:{humanAuthorizationRequired:name==='capability.purchase'}
  },async args=>{
    try {boundedJson(args);rate(name);const result=await handler(args,principal());return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};}
    catch(error){const code=safeError(error);return {isError:true,structuredContent:{errorCode:code},content:[{type:'text',text:code}]};}
  });
  add('marketplace.describe',z.object({}).strict(),'FREE. Marketplace types, fees, creator rights, supported payment rails and active catalog counts.',false,()=>marketplace.describe());
  add('provider.register',providerSchema,'FREE WRITE. Submit a pending provider application. No automatic approval, credential issuance or transfer of ownership.',true,args=>marketplace.registerProvider(args));
  add('provider.get',z.object({providerId:id}).strict(),'FREE. Public active provider metadata. Pending applications require owner or administrator authorization.',false,({providerId},p)=>({provider:marketplace.getProvider(providerId,p)}));
  add('provider.setStatus',z.object({providerId:id,status:z.enum(['pending','active','suspended','rejected'])}).strict(),'FREE ADMIN WRITE. Change provider approval status using authenticated administrator authority.',true,({providerId,status},p)=>marketplace.setProviderStatus(providerId,status,p));
  add('capability.register',capabilitySchema,'FREE PROVIDER WRITE. Register a planned capability with price in USDC atomic units and affirmed commercialization rights. Owner authorization required.',true,(args,p)=>marketplace.registerCapability(args,p));
  add('capability.setStatus',z.object({capabilityId:id,status:z.enum(['active','beta','planned','disabled']),visibility:z.enum(['public','private']).optional()}).strict(),'FREE ADMIN WRITE. Activate only an approved provider capability with a configured, validated execution adapter. Changing visibility to public publishes metadata.',true,({capabilityId,status,visibility},p)=>marketplace.setCapabilityStatus(capabilityId,status,p,visibility));
  // Preserve the old name-based deterministic capability contract.
  add('capability.get',z.object({name:id.optional(),capabilityId:id.optional()}).strict(),
    'FREE. Use name for legacy deterministic capability metadata or capabilityId for public marketplace metadata, rights and provenance.',false,({name,capabilityId},p)=>{
      if(Boolean(name)===Boolean(capabilityId))throw new Error('INVALID_INPUT');
      const item=name?legacyCapabilities.find(c=>c.name===name):marketplace.getCapability(capabilityId,p);
      if(!item)throw new Error('NOT_FOUND');return {item};
    });
  add('capability.search',searchSchema,'FREE. Search active public capabilities by text, category, provider, delivery type and atomic-unit price range. Deterministic ranking.',false,args=>marketplace.search(args));
  add('catalog.list',z.object(paging).strict(),'FREE. Paginated active public marketplace capabilities; planned and private capabilities are excluded.',false,args=>marketplace.search(args));
  add('commerce.quote',z.object({capabilityId:id}).strict(),'FREE. Exact gross price, platform fee, provider share and x402 v1/v2 requirements. No charge. Human authorization required before purchase.',false,({capabilityId})=>marketplace.quote(capabilityId));
  add('capability.purchase',purchaseSchema,'PAID. Canonical marketplace purchase with a signed x402 payment and a prior buyer-bound human approval. Quote first. Payment is settled before bounded execution; failures retain receipts and dispute accounting. Background tasks forbidden.',true,(args,p)=>marketplace.purchase(args,p));
  add('job.status',z.object({jobId:id}).strict(),'FREE AUTHENTICATED. Buyer, provider or administrator job status without inputs, outputs or payment credentials.',false,({jobId},p)=>({job:marketplace.jobStatus(jobId,p)}));
  add('receipt.get',z.object({receiptId:id}).strict(),'FREE AUTHENTICATED. Compatible receipt plus marketplace allocation for the authorized buyer; legacy receipts require an operator-bound payer identity.',false,({receiptId},p)=>{
    const found=marketplace.getReceipt(receiptId,p);if(found)return found;
    const receipt=core?.getReceipt(receiptId);if(receipt&&p?.role!=='admin'&&(!p?.payer||p.payer.toLowerCase()!==receipt.holder?.toLowerCase()))throw new Error('UNAUTHORIZED');
    return {receipt:receipt||null,allocation:null};
  });
  add('creator.apply',z.object({provider:providerSchema,summary:z.string().min(1).max(4000)}).strict(),'FREE WRITE. Private creator intake for assets needing a capability model. No ownership transfer and AI training defaults false.',true,args=>marketplace.applyCreator(args));
  add('settlement.getProviderBalance',z.object({providerId:id}).strict(),'FREE AUTHENTICATED. Provider or administrator accounting balances separated by network and currency. No payout or treasury spending.',false,({providerId},p)=>marketplace.getProviderBalance(providerId,p));
  add('settlement.listAllocations',z.object({providerId:id,...paging}).strict(),'FREE AUTHENTICATED. Paginated post-sale revenue allocations for the provider or administrator.',false,({providerId,...page},p)=>marketplace.listAllocations(providerId,p,page));
  add('settlement.markSettled',z.object({allocationId:id,reference:z.string().min(3).max(300)}).strict(),'FREE ADMIN WRITE. Record evidence of a separately human-authorized completed settlement. Accounting only; this tool never transfers funds.',true,({allocationId,reference},p)=>marketplace.markSettled(allocationId,reference,p));
}
