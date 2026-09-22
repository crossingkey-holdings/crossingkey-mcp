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

export const purchaseSchema=z.object({
  capabilityId:id.describe('Exact active public marketplace capability identifier returned by capability.search, catalog.list, or capability.get.'),
  approvalId:id.describe('Prior buyer-bound human approval identifier authorizing this exact capability, input, idempotency key, and quote.'),
  idempotencyKey:z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/).describe('Buyer-generated idempotency key for safe retry of this exact purchase; 8-160 characters.'),
  input:z.record(z.unknown()).describe('Capability input object that must match the registered bounded input schema and the prior approval.'),
  paymentPayload:z.record(z.unknown()).describe('Signed x402 payment payload satisfying the current commerce.quote requirements.')
}).strict();

const paging={
  offset:z.number().int().min(0).max(10000).default(0).describe('Zero-based result offset; defaults to 0.'),
  limit:z.number().int().min(1).max(100).default(25).describe('Maximum number of results to return; 1-100, defaults to 25.')
};

const searchSchema=z.object({
  query:z.string().max(160).optional().describe('Optional case-insensitive search text across capability name, description, and category; maximum 160 characters.'),
  category:id.optional().describe('Optional exact marketplace category identifier.'),
  provider:id.optional().describe('Optional exact provider identifier.'),
  deliveryType:z.enum(DELIVERY_TYPES).optional().describe('Optional capability delivery-type filter.'),
  minPrice:atomic.optional().describe('Optional inclusive minimum USDC price in atomic units.'),
  maxPrice:atomic.optional().describe('Optional inclusive maximum USDC price in atomic units.'),
  ...paging
}).strict();
const publicCodes=new Set(['UNAUTHORIZED','NOT_FOUND','HUMAN_AUTHORIZATION_REQUIRED','PAYMENT_FAILED','CAPABILITY_DISABLED','PROVIDER_INACTIVE','INVALID_STATUS','INVALID_INPUT','INVALID_SCHEMA','INVALID_ENDPOINT','UNSUPPORTED_SCHEMA_KEYWORD','SCHEMA_VALIDATION_FAILED','PAYLOAD_TOO_LARGE','RATE_LIMITED','STORE_BUSY','STORE_CAPACITY','SLUG_EXISTS','REPLAY_DETECTED','IDEMPOTENCY_CONFLICT','SSRF_BLOCKED','DELIVERY_FAILED','VERIFICATION_FAILED','ENTITLEMENT_FAILED','PRIVATE_PATH_FORBIDDEN']);
export function safeError(error) {return error?.name==='ZodError'?'INVALID_INPUT':error?.message==='RIGHTS_AFFIRMATION_REQUIRED'?error.message:publicCodes.has(error?.message)?error.message:'INTERNAL_ERROR';}
export function registerMarketplaceTools(server,{marketplace,principal,legacyCapabilities,core,rate=()=>{}}) {
  const visibilityPrincipal=typeof principal==='function'?principal():null;
  const visibilityRole=visibilityPrincipal?.role||'public';
  const adminOnly=new Set(['provider.set_status','capability.set_status','settlement.mark_settled']);
  const providerOrAdmin=new Set(['capability.register','settlement.get_balance','settlement.list_allocations']);
  const authenticated=new Set(['job.status','receipt.get']);
  const buyerOnly=new Set(['capability.purchase']);
  const visible=name=>{
    if(adminOnly.has(name))return visibilityRole==='admin';
    if(providerOrAdmin.has(name))return visibilityRole==='provider'||visibilityRole==='admin';
    if(authenticated.has(name))return ['buyer','provider','admin'].includes(visibilityRole);
    if(buyerOnly.has(name))return visibilityRole==='buyer';
    return true;
  };
  const register=(name,schema,description,write,handler)=>server.registerTool(name,{
    description,inputSchema:schema,annotations:{readOnlyHint:!write,destructiveHint:write,openWorldHint:name==='capability.purchase'},
    _meta:{humanAuthorizationRequired:name==='capability.purchase'}
  },async args=>{
    try {boundedJson(args);rate(name);const result=await handler(args,principal());return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};}
    catch(error){const code=safeError(error);return {isError:true,structuredContent:{errorCode:code},content:[{type:'text',text:code}]};}
  });
  const add=(...args)=>visible(args[0])?register(...args):null;
  add('marketplace.describe',z.object({}).strict(),'FREE, read-only marketplace overview. Use this first for marketplace-specific capability commerce, fee policy, creator rights, payment rails, and active catalog counts; use provider.describe for the broader CrossingKey provider and legacy offer surface.',false,()=>marketplace.describe());
  add('provider.register',providerSchema,'FREE public intake. Submit a pending marketplace provider application; this creates no credential, approval, payment, ownership transfer, or active capability. Use creator.apply instead when submitting an asset or body of work that still needs a capability model.',true,args=>marketplace.registerProvider(args));
  add('provider.get',z.object({providerId:id.describe('Exact CrossingKey marketplace provider identifier.')}).strict(),'FREE. Public active provider metadata. Pending applications require owner or administrator authorization.',false,({providerId},p)=>({provider:marketplace.getProvider(providerId,p)}));
  add('provider.set_status',z.object({providerId:id.describe('Exact provider identifier whose approval status will be changed.'),status:z.enum(['pending','active','suspended','rejected']).describe('New provider approval status.')}).strict(),'FREE ADMIN WRITE. Change provider approval status using authenticated administrator authority.',true,({providerId,status},p)=>marketplace.setProviderStatus(providerId,status,p));
  add('capability.register',capabilitySchema,'FREE PROVIDER WRITE. Register a planned capability with price in USDC atomic units and affirmed commercialization rights. Owner authorization required.',true,(args,p)=>marketplace.registerCapability(args,p));
  add('capability.set_status',z.object({capabilityId:id.describe('Exact capability identifier whose status will be changed.'),status:z.enum(['active','beta','planned','disabled']).describe('New capability lifecycle status.'),visibility:z.enum(['public','private']).optional().describe('Optional marketplace visibility to set with the status change.')}).strict(),'FREE ADMIN WRITE. Activate only an approved provider capability with a configured, validated execution adapter. Changing visibility to public publishes metadata.',true,({capabilityId,status,visibility},p)=>marketplace.setCapabilityStatus(capabilityId,status,p,visibility));
  // Preserve the old name-based deterministic capability contract.
  add('capability.get',z.object({name:id.optional().describe('Exact deterministic first-party machine capability name. Use either name or capabilityId, never both.'),capabilityId:id.optional().describe('Exact marketplace capability identifier. Use either capabilityId or name, never both.')}).strict(),
    'FREE. Use name for legacy deterministic capability metadata or capabilityId for public marketplace metadata, rights and provenance.',false,({name,capabilityId},p)=>{
      if(Boolean(name)===Boolean(capabilityId))throw new Error('INVALID_INPUT');
      const item=name?legacyCapabilities.find(c=>c.name===name):marketplace.getCapability(capabilityId,p);
      if(!item)throw new Error('NOT_FOUND');return {item};
    });
  add('capability.search',searchSchema,'FREE MARKETPLACE FILTERED DISCOVERY ONLY. Search active public marketplace capabilities when one or more filters are known: text, category, provider, delivery type, or price. Metadata is free; purchased execution and deliverables are not. Do NOT use for unfiltered browsing; use catalog.list. Do NOT use for CrossingKey digital/service offers; use offer.list. For one exact capabilityId use capability.get.',false,args=>marketplace.search(args));
  add('catalog.list',z.object(paging).strict(),'FREE MARKETPLACE UNFILTERED DISCOVERY ONLY. Page through active public marketplace capabilities when no search filters are needed. Metadata is free; execution, entitlement, delivery, and purchased output remain gated. Do NOT use for filtered discovery; use capability.search. Do NOT use for CrossingKey digital/service offers; use offer.list. For one exact capabilityId use capability.get.',false,args=>marketplace.search(args));
  add('commerce.quote',z.object({capabilityId:id.describe('Exact active public marketplace capability identifier to quote.')}).strict(),'FREE MARKETPLACE PAYMENT QUOTE ONLY. After selecting an active marketplace capabilityId, return authoritative gross price, CrossingKey fee, provider share, and x402 v1/v2 payment requirements. A quote grants no entitlement and performs no execution. Do NOT use for first-party deterministic capabilities; use machine_capability.quote. Do NOT use for generic price lookup; use cost.estimate. Paid marketplace execution requires capability.purchase with authorization and verified payment.',false,({capabilityId})=>marketplace.quote(capabilityId));
  add('capability.purchase',purchaseSchema,'PAID VALUE-PRODUCING ACTION. Canonical marketplace purchase and bounded execution. Requires an authenticated buyer, prior buyer-bound human approval, and signed x402 payment satisfying commerce.quote. This is the paid transition from free metadata into execution/delivery. Payment is verified before bounded execution. Failed delivery retains receipt/dispute accounting; background tasks are forbidden.',true,(args,p)=>marketplace.purchase(args,p));
  add('job.status',z.object({jobId:id.describe('Exact marketplace job identifier returned by a purchase or execution result.')}).strict(),'FREE AUTHENTICATED. Buyer, provider or administrator job status without inputs, outputs or payment credentials.',false,({jobId},p)=>({job:marketplace.jobStatus(jobId,p)}));
  add('receipt.get',z.object({receiptId:id.describe('Exact CrossingKey marketplace receipt identifier.')}).strict(),'FREE AUTHENTICATED. Compatible receipt plus marketplace allocation for the authorized buyer; legacy receipts require an operator-bound payer identity.',false,({receiptId},p)=>{
    const found=marketplace.getReceipt(receiptId,p);if(found)return found;
    const receipt=core?.getReceipt(receiptId);if(receipt&&p?.role!=='admin'&&(!p?.payer||p.payer.toLowerCase()!==receipt.holder?.toLowerCase()))throw new Error('UNAUTHORIZED');
    return {receipt:receipt||null,allocation:null};
  });
  add('creator.apply',z.object({provider:providerSchema.describe('Proposed provider identity for this private creator intake.'),summary:z.string().min(1).max(4000).describe('Private creator intake summary describing the asset, service, or capability to evaluate; 1-4000 characters.')}).strict(),'FREE WRITE. Private creator intake for assets needing a capability model. No ownership transfer and AI training defaults false.',true,args=>marketplace.applyCreator(args));
  add('settlement.get_balance',z.object({providerId:id.describe('Exact provider identifier whose accounting balance should be returned.')}).strict(),'FREE AUTHENTICATED. Provider or administrator accounting balances separated by network and currency. No payout or treasury spending.',false,({providerId},p)=>marketplace.getProviderBalance(providerId,p));
  add('settlement.list_allocations',z.object({providerId:id.describe('Exact provider identifier whose post-sale allocations should be listed.'),...paging}).strict(),'FREE AUTHENTICATED. Paginated post-sale revenue allocations for the provider or administrator.',false,({providerId,...page},p)=>marketplace.listAllocations(providerId,p,page));
  add('settlement.mark_settled',z.object({allocationId:id.describe('Exact payable allocation identifier to mark as externally settled.'),reference:z.string().min(3).max(300).describe('Human-authorized external settlement reference; 3-300 characters.')}).strict(),'FREE ADMIN WRITE. Record evidence of a separately human-authorized completed settlement. Accounting only; this tool never transfers funds.',true,({allocationId,reference},p)=>marketplace.markSettled(allocationId,reference,p));
}
