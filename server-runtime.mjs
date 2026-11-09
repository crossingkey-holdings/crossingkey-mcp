import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import express from 'express';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import {McpServer,
  ResourceTemplate
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CAPABILITIES as MACHINE_CAPABILITIES, RECEIVER as LOCKED_RECEIVER, createMachineCommerce, normalizeX402Version, sha256 } from './lib/machine-commerce.mjs';
import {
  PAID_CAPABILITIES as CATALOG_PAID_CAPABILITIES,
  X402_CAPABILITIES,
  PREPAID_CAPABILITIES,
  PAID_CAPABILITY_NAMES,
  publicCapabilityDescriptor,
  assertPaidCatalog
} from './lib/paid-capability-catalog.mjs';
import { validatePaidCapabilityInput } from './lib/discovery.mjs';
import { verifyOnchain } from './lib/onchain-verifier.mjs';
import { createMarketplace } from './lib/marketplace.mjs';
import { createAdapters } from './lib/marketplace-adapters.mjs';
import { readJson as readMarketplaceJson } from './lib/marketplace-storage.mjs';
import { registerMarketplaceTools, resolveMarketplacePrincipal, createRateLimit, purchaseSchema, safeError } from './lib/marketplace-tools.mjs';
import {
  MCP_RELEASE_VERSION,
  MCP_PROTOCOL_VERSION,
  FREE_DISCOVERY_TOOL_NAMES,
  PAID_TOOL_NAMES,
  MCP_TOOL_MANIFEST,
  MCP_SERVER_INSTRUCTIONS
} from './lib/mcp-manifest.mjs';
import { DatabaseSync } from 'node:sqlite';
import { recoverInterruptedOperations } from './lib/recovery/recovery-orchestrator.mjs';

const HERE = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/,'');
const DELIVERY_ROOT = path.resolve(HERE, process.env.DELIVERY_ROOT || './delivery');
const STATE_FILE = process.env.CK_STATE_FILE || path.join(HERE,'data','state.json');
const CATALOG_FILE = process.env.CK_CATALOG_FILE || path.join(HERE,'data','stripe_catalog.json');
const CREDITS_FILE = process.env.CK_CREDITS_FILE || path.join(HERE,'data','credit_links.json');
const FULFILL_FILE = process.env.CK_FULFILL_FILE || path.join(HERE,'data','fulfillment_map.json');
const SERVICES_FILE = process.env.CK_SERVICES_FILE || path.join(HERE,'data','request_services.json');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const CLAIM_SECRET = process.env.CLAIM_SECRET || '';
const CK_RECEIVER_ADDRESS = process.env.CK_RECEIVER_ADDRESS || LOCKED_RECEIVER;
const CK_ENABLE_MAINNET = process.env.CK_ENABLE_MAINNET === 'true';
const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
const MACHINE_COMMERCE_FILE = process.env.MACHINE_COMMERCE_FILE || path.join(HERE,'data','machine_commerce.json');
const KENNEKARTE_SECRET = process.env.CK_KENNEKARTE_HMAC_SECRET || CLAIM_SECRET;
const CK_EXPOSE_LEGACY_TOOLS = process.env.CK_EXPOSE_LEGACY_TOOLS === 'true';
const LEGACY_TOOL_NAMES = new Set(['list_stripe_offers','get_stripe_checkout_link','get_fulfillment_status']);
const DISCOVERY_PROFILE_VERSION = 'mcp-v4-2026-10-26';
const OPENAI_APPS_CHALLENGE_TOKEN = process.env.OPENAI_APPS_CHALLENGE_TOKEN || '';

const XKEY_ROOT =
  process.env.XKEY_ROOT ||
  '/home/founder/CrossingKey/control/xkey/06_REVENUE/XKEY-Compiler-Revenue-Agent';

const XKEY_PYTHON =
  process.env.XKEY_PYTHON ||
  `${XKEY_ROOT}/.venv/bin/python`;

const XKEY_CREDIT_DB =
  process.env.XKEY_CREDIT_DB ||
  path.join(HERE,'data','xkey_paid_credits.sqlite3');

const XKEY_MAX_INPUT_CHARS = 100000;
const XKEY_DIRECT_VALIDATOR = path.join(path.dirname(new URL(import.meta.url).pathname),'scripts','xkey-direct-validation.py');

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
assertPaidCatalog();

const catalogX402Names =
  X402_CAPABILITIES.map(x=>x.name).sort();

const machineX402Names =
  MACHINE_CAPABILITIES.map(x=>x.name).sort();

if(JSON.stringify(catalogX402Names)!==JSON.stringify(machineX402Names)){
  throw new Error(
    `Paid catalog / machine-commerce mismatch: catalog=${catalogX402Names.join(',')} machine=${machineX402Names.join(',')}`
  );
}

const machineCommerce = KENNEKARTE_SECRET.length >= 32 ? createMachineCommerce({
  dataFile:MACHINE_COMMERCE_FILE,
  receiver:CK_RECEIVER_ADDRESS,
  network:CK_ENABLE_MAINNET?'eip155:8453':'eip155:84532',
  mainnetEnabled:CK_ENABLE_MAINNET,
  publicBaseUrl:PUBLIC_BASE_URL,
  facilitatorUrl:X402_FACILITATOR_URL,
  kennekarteSecret:KENNEKARTE_SECRET,
  onPaymentLifecycleEvent:event=>ckObservePaymentLifecycle(event),
  executionDependencies:{execute:({capabilityName,input})=>capabilityName==='xkey.validate'?runXkeyDirectValidation(input):undefined}
}) : null;
const readJson = f => JSON.parse(fs.readFileSync(f,'utf8'));
const writeJsonAtomic = (f, value) => {
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value,null,2));
  fs.renameSync(tmp,f);
};
const state = () => readJson(STATE_FILE);
const saveState = s => writeJsonAtomic(STATE_FILE,s);
const catalog = () => readJson(CATALOG_FILE);
const legacyCreditPacks = () => readJson(CREDITS_FILE).packs;
const creditPacks = () => [];
const fulfillment = () => readJson(FULFILL_FILE).products;
const requestServices = () => readJson(SERVICES_FILE).services || [];
const marketplaceAuthFile = process.env.MARKETPLACE_AUTH_FILE || '';
const marketplace = createMarketplace({core:machineCommerce,
  dataFile:process.env.MARKETPLACE_FILE || path.join(HERE,'data','marketplace.json'),
  feeBps:Number(process.env.MARKETPLACE_FEE_BPS || '1000'),
  adapters:createAdapters({bindings:()=>process.env.MARKETPLACE_ADAPTERS_FILE?readMarketplaceJson(process.env.MARKETPLACE_ADAPTERS_FILE,{}):{},assetRoot:process.env.MARKETPLACE_ASSET_ROOT})
});
const marketplaceRate=createRateLimit();
const marketplaceIntakeRate=createRateLimit({max:10});
const marketplacePrincipal=req=>resolveMarketplacePrincipal(req.headers.authorization,marketplaceAuthFile);

function hmac(label) {
  if (!CLAIM_SECRET) throw new Error('CLAIM_SECRET is not configured');
  return crypto.createHmac('sha256', CLAIM_SECRET).update(label).digest('base64url');
}
function sha256Text(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

function resolveCreditPrincipal(req){
  const auth=String(req.headers.authorization||'');
  const token=auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if(!token.startsWith('ck_')) return null;

  const principalId=sha256Text(token);
  const acct=state().credit_accounts[principalId];

  if(!acct) return null;

  return {principal_id:principalId};
}

function currentCreditAccount(principalId){
  return state().credit_accounts[principalId] || null;
}

function runXkeyBridge(payload){
  if(!fs.existsSync(XKEY_PYTHON)){
    return {ok:false,error:'runtime_unavailable',message:'Paid execution runtime is unavailable.'};
  }

  const result=spawnSync(
    XKEY_PYTHON,
    ['-m','xkey_compiler.mcp_bridge'],
    {
      cwd:XKEY_ROOT,
      input:JSON.stringify({...payload,credit_db:XKEY_CREDIT_DB}),
      encoding:'utf8',
      timeout:5000,
      maxBuffer:1024*1024,
      shell:false,
      env:{
        PATH:process.env.PATH || '/usr/bin:/bin',
        LANG:process.env.LANG || 'C.UTF-8',
        PYTHONUNBUFFERED:'1',
        PYTHONNOUSERSITE:'1'
      }
    }
  );

  if(result.error){
    return {ok:false,error:'runtime_failure',message:'Paid execution failed safely.'};
  }

  const stdout=String(result.stdout||'').trim();
  if(!stdout){
    return {ok:false,error:'empty_runtime_response',message:'Paid execution failed safely.'};
  }

  let parsed;
  try{
    parsed=JSON.parse(stdout.split(/\r?\n/).filter(Boolean).at(-1));
  }catch{
    return {ok:false,error:'invalid_runtime_response',message:'Paid execution failed safely.'};
  }

  return parsed;
}
function runXkeyDirectValidation(payload){
  if(!fs.existsSync(XKEY_PYTHON)||!fs.existsSync(XKEY_DIRECT_VALIDATOR)) return {ok:false,error:'runtime_unavailable',message:'XKEY validation runtime is unavailable.'};
  const result=spawnSync(XKEY_PYTHON,[XKEY_DIRECT_VALIDATOR],{
    cwd:XKEY_ROOT,
    input:JSON.stringify({raw_intake:payload.raw_intake,max_input_chars:XKEY_MAX_INPUT_CHARS}),
    encoding:'utf8',timeout:5000,maxBuffer:1024*1024,shell:false,
    env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:process.env.LANG||'C.UTF-8',PYTHONUNBUFFERED:'1',PYTHONNOUSERSITE:'1',XKEY_ROOT}
  });
  if(result.error||result.status!==0) return {ok:false,error:'validation_runtime_unavailable',message:'XKEY validation runtime is unavailable.'};
  try{return JSON.parse(String(result.stdout||'').trim().split(/\r?\n/).filter(Boolean).at(-1));}
  catch{return {ok:false,error:'validation_runtime_invalid',message:'XKEY validation runtime returned invalid output.'};}
}
function requestToken(sessionId){ return `ck_${hmac(`credits:${sessionId}`).slice(0,40)}`; }
function downloadToken(sessionId, offerId){ return `dl_${hmac(`download:${sessionId}:${offerId}`).slice(0,40)}`; }
function fileSha256(file){
  const h=crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}
function safeDeliveryPath(file){
  const target = path.resolve(DELIVERY_ROOT,file);
  if (!target.startsWith(DELIVERY_ROOT + path.sep)) throw new Error('Unsafe delivery path');
  return target;
}
function isDeliveryReady(offerId){
  const m=fulfillment()[offerId];
  if(!m) return false;
  const p=safeDeliveryPath(m.file);
  return fs.existsSync(p) && fileSha256(p)===m.sha256;
}
function publicOffer(x){
  return {...x, delivery_ready: x.kind==='digital' ? isDeliveryReady(x.id) : false};
}

const AGENT_COMMERCE_VERSION='1.0.0';
const PROVIDER_PROFILE=Object.freeze({
  id:'crossingkey-intelligence',name:'CrossingKey Intelligence',operator_handle:'crossingkey_',
  motto:'intelligence is the standard.',interface:'machine-commerce',endpoint:'/mcp',
  protocol:'MCP Streamable HTTP',
  commerce_model:'discover -> understand -> evaluate -> trust -> price -> authorize -> pay -> execute',
  discovery_policy:'Offer and capability metadata are readable before payment. Valuable execution and delivery remain gated.',
  currency:'USD',payment_rails:['stripe_payment_links','x402_base_usdc'],legacy_compatibility_rails:['prepaid_request_credits'],
  human_sites:['https://www.crossingkeyintelligence.com','https://shop.crossingkeyintelligence.com'],
  machine_site:'https://mcp.crossingkeyintelligence.com/mcp'
});
const PAID_CAPABILITIES=Object.freeze([{
  id:'xkey.validate',tool:'xkey.validate',name:'xkey Intake Validation',
  summary:'Validates and normalizes a bounded xkey intake payload.',access:'paid',
  charging_model:'prepaid_credit',price:{credits:1,currency:'CK_REQUEST_CREDIT'},
  speculative_call_safe:false,idempotency_required:true,
  input_schema:{type:'object',required:['idempotency_key','raw_intake'],properties:{
    idempotency_key:{type:'string',minLength:8,maxLength:160},
    raw_intake:{type:'string',minLength:2,maxLength:100000}},additionalProperties:false},
  output_preview:{type:'object',properties:{success:{type:'boolean'},state:{enum:['VERIFIED_SUCCESS','SAFE_FAILURE']},request_hash:{type:'string'},normalized:{type:['object','null']},error:{type:['string','null']}}},
  failure_policy:'Safe validation failures release the reserved credit. Successful validation commits one credit.'
}]);
function publicCapabilityList(){
  const free=[
    ['provider.describe','Provider discovery','Returns provider identity, commerce policy, payment rails, and discovery sequence.'],

    ['offers.list','Offer discovery','Searches public CrossingKey offers before payment.'],

    ['cost.estimate','Cost estimation','Returns known purchase price or credit cost without executing.'],

    ['result.preview','Result preview','Shows result shape without revealing paid output.'],

    ['requirements.check','Requirements check','Explains prerequisites before purchase or execution.'],

    ['execution.preflight','Execution preflight','Final no-charge decision point before payment/execution.'],

    ['credits.options','Request-credit purchase options','Returns prepaid request-credit packs.'],

  ].filter(([tool])=>CK_EXPOSE_LEGACY_TOOLS || !LEGACY_TOOL_NAMES.has(tool)).map(([tool,name,summary])=>({id:`tool.${tool}`,tool,name,summary,access:'free',price:{amount_usd:0}}));
  const machine=MACHINE_CAPABILITIES.map(x=>({id:x.name,tool:x.name,name:x.name,summary:x.description,access:'paid',charging_model:'x402_exact',price:{amount_usd:Number(x.priceUsd),currency:'USD'},deterministic:true,ai_required:false,idempotency_required:true}));
  return [...free,...PAID_CAPABILITIES,...machine];
}
function offerDescriptor(x){
  const p=publicOffer(x);
  return {id:p.id,name:p.name,kind:p.kind,summary:p.description||p.summary||`${p.name} CrossingKey offer.`,
    access:'paid_purchase',price:{amount_usd:Number(p.price_usd),currency:'USD'},checkout_url:p.checkout_url,
    delivery_ready:Boolean(p.delivery_ready),
    fulfillment:p.kind==='digital'?(p.delivery_ready?'verified_digital_download':'digital_delivery_pending_verification'):'service_order',
    requirements:['Agent must determine relevance before purchase.','Payment authorization must come from the user, policy, or configured spending authority.',
      p.kind==='digital'&&!p.delivery_ready?'Digital fulfillment is not yet verified; do not purchase for immediate autonomous delivery.':'No additional fulfillment warning is currently advertised.'],
    next_action:p.kind==='digital'&&!p.delivery_ready?'wait_for_fulfillment_verification_or_choose_another_offer':'review_checkout_url_and_authorize_payment'};
}
function findPublicItem(id){
  const offer=catalog().offers.find(v=>v.id===id); if(offer) return {type:'offer',value:offerDescriptor(offer)};
  const cap=publicCapabilityList().find(v=>v.access==='paid'&&(v.id===id||v.tool===id)); if(cap) return {type:'capability',value:cap};
  return null;
}
function matchesQuery(item,q){return !q||JSON.stringify(item).toLowerCase().includes(String(q).trim().toLowerCase());}

const discoveryId = z.string().min(1).max(160);
const discoveryQuerySchema = z.object({
  query:z.string().max(160).optional().describe('Optional bounded search text.'),
  offset:z.number().int().min(0).max(1000000).default(0).describe('Zero-based index of first matching record; use next_offset to retrieve the next page.'),
  limit:z.number().int().min(1).max(50).default(20).describe('Maximum number of public metadata records to return.')
}).strict();
const discoveryItemSchema = z.object({
  item_id:discoveryId.describe('Public offer or paid capability identifier returned by offers.list.')
}).strict();

function discoveryOfferList({query,limit,offset=0}) {
  const offers = catalog().offers.map(publicOffer).map(offerDescriptor);
  const capabilities = publicCapabilityList().map(item=>({
    id:item.id,
    name:item.name,
    kind:'capability',
    summary:item.summary,
    access:item.access,
    price:item.price,
    fulfillment:'paid_capability',
    requirements:['Explicit human authorization is required before payment or execution.'],
    next_action:'run_requirements_check_then_cost_estimate'
  }));
  const matches=[...offers,...capabilities].filter(item=>matchesQuery(item,query));
  const page=matches.slice(offset,offset+limit);
  return {offers:page,total:matches.length,next_offset:offset+limit<matches.length?offset+limit:null,free:true,payment_started:false};
}

function discoveryRequirements(item_id) {
  const found=findPublicItem(item_id);
  if(!found) return {item_id,found:false,requirements:['Unknown public offer or capability.'],payment_required:false};
  return {item_id,found:true,type:found.type,requirements:found.value.requirements||['Explicit human authorization is required before payment or execution.'],payment_required:found.value.access!=='free',delivery_ready:found.value.delivery_ready??null};
}

function discoveryCost(item_id) {
  const found=findPublicItem(item_id);
  if(!found) return {item_id,found:false,cost_state:'UNKNOWN',payment_required:false};
  return {item_id,found:true,cost_state:'ESTIMATE_ONLY',cost:found.value.price||null,payment_required:found.value.access!=='free',payment_started:false};
}

function discoveryPreview(item_id) {
  const found=findPublicItem(item_id);
  if(!found) return {item_id,found:false,preview_state:'UNAVAILABLE'};
  return {item_id,found:true,preview_state:'SHAPE_ONLY',result_preview:found.type==='capability' ? (publicCapabilityList().find(x=>x.id===item_id)?.output_preview||{type:'object',description:'Paid result returned only after authorized execution.'}) : {type:'object',description:'Offer fulfillment result is returned only after authorized purchase and delivery.'},payment_started:false};
}

function discoveryPreflight(item_id) {
  const requirements=discoveryRequirements(item_id);
  const cost=discoveryCost(item_id);
  const preview=discoveryPreview(item_id);
  const deliveryBlocked=Boolean(requirements.type==='offer'&&requirements.delivery_ready===false&&requirements.item_id&&findPublicItem(item_id)?.value.kind==='digital');
  const ready=Boolean(requirements.found&&cost.found&&preview.found&&!deliveryBlocked);
  return {item_id,state:ready?'READY_FOR_HUMAN_AUTHORIZATION':'NOT_READY',requirements_satisfied:ready,authorization_required:true,payment_started:false,execution_started:false,entitlement_created:false,receipt_created:false,reason:ready?'All non-financial checks passed; stop for explicit human authorization.':'One or more non-financial requirements are not satisfied.',checks:{requirements,cost,preview}};
}
// schemas describe the success-path structuredContent only.
const DISCOVERY_OUTPUT_SCHEMAS = {
  'provider.describe': z.object({
    provider: z.object({}).passthrough(),
    sequence: z.array(z.string()),
    manifest: z.object({}).passthrough(),
    stopBeforePayment: z.literal(true)
  }),
  'offers.list': z.object({
    offers: z.array(z.object({ id: z.string() }).passthrough()),
    total: z.number().int().nonnegative(),
    next_offset: z.number().int().nonnegative().nullable(),
    free: z.boolean(),
    payment_started: z.boolean()
  }),
  'requirements.check': z.object({
    item_id: z.string(),
    found: z.boolean(),
    requirements: z.array(z.string()),
    payment_required: z.boolean(),
    type: z.string().optional(),
    delivery_ready: z.boolean().nullable().optional()
  }),
  'cost.estimate': z.object({
    item_id: z.string(),
    found: z.boolean(),
    cost_state: z.string(),
    payment_required: z.boolean(),
    cost: z.object({}).passthrough().nullable().optional(),
    payment_started: z.boolean().optional()
  }),
  'result.preview': z.object({
    item_id: z.string(),
    found: z.boolean(),
    preview_state: z.string(),
    result_preview: z.object({}).passthrough().optional(),
    payment_started: z.boolean().optional()
  }),
  'execution.preflight': z.object({
    item_id: z.string(),
    state: z.string(),
    requirements_satisfied: z.boolean(),
    authorization_required: z.boolean(),
    payment_started: z.boolean(),
    execution_started: z.boolean(),
    entitlement_created: z.boolean(),
    receipt_created: z.boolean(),
    reason: z.string(),
    checks: z.object({}).passthrough()
  }),
  'credits.options': z.object({
    packs: z.array(z.object({}).passthrough()),
    free: z.boolean(),
    payment_started: z.boolean()
  })
};
const X402_CHALLENGE_OUTPUT_SCHEMA = z.object({
  payment_required: z.literal(true).optional(),
  x402Version: z.literal(2).optional(),
  error: z.string().optional(),
  resource: z.object({}).passthrough().optional(),
  accepts: z.array(z.object({}).passthrough()).optional(),
  extensions: z.object({}).passthrough().optional(),
  execution_mode: z.string().optional(),
  capability: z.string().optional(),
  input: z.object({}).passthrough().optional(),
  price: z.string().nullable().optional(),
  asset: z.string().nullable().optional(),
  network: z.string().nullable().optional(),
  pay_to: z.string().nullable().optional(),
  execution_url: z.string().nullable().optional(),
  payment_required_header: z.string().optional(),
  settlement_expectations: z.string().optional(),
  confirmation_expectations: z.string().optional(),
  instruction: z.string().optional(),
  status: z.string().optional(),
  purchaseId: z.string().optional(),
  entitlementId: z.string().optional()
}).passthrough();
const XKEY_VALIDATE_OUTPUT_SCHEMA = z.object({
  capability: z.string(),
  state: z.string(),
  success: z.boolean(),
  credits_charged: z.unknown().optional(),
  balance: z.unknown().optional(),
  reservation_id: z.string().nullable().optional(),
  receipt_id: z.string().nullable().optional(),
  request_hash: z.string().nullable().optional(),
  normalized: z.unknown().optional()
});

async function resolveOfferFromSession(session){
  const c = catalog().offers;
  const direct = session.metadata?.offer_id;
  if (direct) {
    const found = c.find(x=>x.id===direct) || legacyCreditPacks().find(x=>x.id===direct);
    if(found) return found;
  }
  if(session.payment_link && stripe){
    const pl = await stripe.paymentLinks.retrieve(session.payment_link);
    const metaOffer = pl.metadata?.offer_id;
    if(metaOffer){
      const found = c.find(x=>x.id===metaOffer) || legacyCreditPacks().find(x=>x.id===metaOffer);
      if(found) return found;
    }
    const byUrl = c.find(x=>x.checkout_url===pl.url) || legacyCreditPacks().find(x=>x.checkout_url===pl.url);
    if(byUrl) return byUrl;
  }
  return null;
}
async function processPaidSession(session){
  if(session.payment_status !== 'paid') return {status:'waiting_for_payment'};
  const prior=state().processed_sessions[session.id];
  if(prior) return prior;

  const offer=await resolveOfferFromSession(session);
  // Reload after the asynchronous lookup. Keep this read/modify/write region
  // synchronous: other requests may have changed state while Stripe resolved.
  const s=state();
  if(s.processed_sessions[session.id]) return s.processed_sessions[session.id];
  if(!offer) {
    const result={status:'unmapped_payment',session_id:session.id};
    s.processed_sessions[session.id]=result; saveState(s); return result;
  }

  const email=session.customer_details?.email || session.customer_email || null;
  let result={status:'paid',session_id:session.id,offer_id:offer.id,email};

  if(String(offer.id).startsWith('request-credits-')){
    // v4 does not fulfill new prepaid-credit sales. Existing credit_accounts
    // remain untouched and continue through xkey.validate.legacy.
    result={...result,status:'credit_sales_disabled',fulfillment:'legacy_credits_not_issued'};
  } else if(offer.kind==='digital') {
    const m=fulfillment()[offer.id];
    if(m && isDeliveryReady(offer.id)){
      const token=downloadToken(session.id,offer.id);
      const tokenHash=sha256Text(token);
      s.download_entitlements[tokenHash]={
        session_id:session.id,email,offer_id:offer.id,file:m.file,sha256:m.sha256,
        max_downloads:m.max_downloads || 5,downloads:0,created_at:new Date().toISOString()
      };
      result={...result,fulfillment:'digital_download',delivery_ready:true};
    } else {
      result={...result,fulfillment:'digital_download',delivery_ready:false,status:'paid_needs_file_binding'};
    }
  } else {
    s.service_orders[session.id]={session_id:session.id,email,offer_id:offer.id,created_at:new Date().toISOString()};
    result={...result,fulfillment:'service_order'};
  }

  s.processed_sessions[session.id]=result;
  saveState(s);
  return result;
}

const app=express();
app.disable('x-powered-by');

app.post('/stripe/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  try{
    if(!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook not configured');
    const sig=req.headers['stripe-signature'];
    let event;
    try{
      event=stripe.webhooks.constructEvent(req.body,sig,STRIPE_WEBHOOK_SECRET);
    }catch{
      return res.status(400).send('Invalid Stripe webhook signature or payload');
    }
    if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded'){
      await processPaidSession(event.data.object);
    }
    res.json({received:true});
  }catch(err){
    console.error('stripe webhook processing failed');
    res.status(500).send('Webhook processing failed; retry required');
  }
});

app.disable('x-powered-by');

app.get("/", (req, res) => {
  res.status(200).json({
    name: "CrossingKey MCP",
    version: MCP_RELEASE_VERSION,
    status: "operational",
    description:
      "CrossingKey MCP v5 governed machine-commerce endpoint for agent discovery, buyer-authorized payment, bounded capabilities, fulfillment, receipts, and verifiable results.",
    operator: "CrossingKey Intelligence",
    mcp: {
      endpoint: "https://mcp.crossingkeyintelligence.com/mcp",
      transport: "streamable-http",
      protocol_version: "2025-11-25"
    },
    commerce: {
      offer_discovery: true,
      stripe_checkout: true,
      digital_fulfillment: true,
      prepaid_credits: true,
      paid_capabilities: true
    },
    discovery: {
      registry: "Official MCP Registry",
      tools_via_mcp: true
    },
    human_site: "https://www.crossingkeyintelligence.com",
    documentation: "https://www.crossingkeyintelligence.com/mcp/",
    repository: "https://github.com/crossingkey-holdings/crossingkey-mcp"
  });
});

app.use(express.json({limit:'1mb'}));


// CK_FUNNEL_SQLITE_V1
const CK_FUNNEL_DB_PATH =
  process.env.CK_FUNNEL_DB ||
  path.resolve('data/commerce_funnel.sqlite3');

const CK_FUNNEL_DB = new DatabaseSync(CK_FUNNEL_DB_PATH);

CK_FUNNEL_DB.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=NORMAL;
  PRAGMA busy_timeout=5000;

  CREATE TABLE IF NOT EXISTS funnel_snapshots (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    updated_at TEXT NOT NULL,
    state_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    request_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    public_route TEXT NOT NULL,
    transport TEXT NOT NULL,
    synthetic INTEGER NOT NULL CHECK (synthetic IN (0, 1)),
    challenge_issued INTEGER NOT NULL CHECK (challenge_issued IN (0, 1)),
    payment_proof_submitted INTEGER NOT NULL CHECK (payment_proof_submitted IN (0, 1)),
    verification_attempted INTEGER NOT NULL CHECK (verification_attempted IN (0, 1)),
    verification_outcome TEXT,
    settlement_attempted INTEGER NOT NULL CHECK (settlement_attempted IN (0, 1)),
    settlement_outcome TEXT,
    receipt_creation_outcome TEXT,
    entitlement_creation_outcome TEXT,
    final_http_status INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    classification TEXT NOT NULL,
    commercial_state TEXT,
    actionable INTEGER NOT NULL CHECK (actionable IN (0, 1)),
    safe_reference TEXT,
    application_version TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS payment_attempts_timestamp_idx
    ON payment_attempts(timestamp DESC);
  CREATE INDEX IF NOT EXISTS payment_attempts_actionable_idx
    ON payment_attempts(actionable, timestamp DESC);
`);

try {
  fs.chmodSync(CK_FUNNEL_DB_PATH, 0o600);
} catch (error) {
  console.error('[funnel] sqlite_permission_error');
}

function ckLoadPersistentFunnel() {
  try {
    const row = CK_FUNNEL_DB
      .prepare('SELECT updated_at, state_json FROM funnel_snapshots WHERE id=1')
      .get();

    if (!row) return null;

    const parsed = JSON.parse(row.state_json);

    if (!parsed || typeof parsed !== 'object') return null;

    return {
      updated_at: row.updated_at,
      state: parsed
    };
  } catch (error) {
    console.error(
      '[funnel] sqlite_load_error',
      error?.message || String(error)
    );
    return null;
  }
}

const CK_FUNNEL_SAVE = CK_FUNNEL_DB.prepare(`
  INSERT INTO funnel_snapshots (id, updated_at, state_json)
  VALUES (1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    updated_at=excluded.updated_at,
    state_json=excluded.state_json
`);

const CK_PAYMENT_ATTEMPT_INSERT = CK_FUNNEL_DB.prepare(`
  INSERT INTO payment_attempts (
    timestamp, request_id, capability, public_route, transport, synthetic,
    challenge_issued, payment_proof_submitted, verification_attempted,
    verification_outcome, settlement_attempted, settlement_outcome,
    receipt_creation_outcome, entitlement_creation_outcome,
    final_http_status, latency_ms, classification, commercial_state,
    actionable, safe_reference, application_version
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const CK_PAYMENT_ATTEMPT_PRUNE = CK_FUNNEL_DB.prepare(`
  DELETE FROM payment_attempts
  WHERE id NOT IN (
    SELECT id FROM payment_attempts ORDER BY id DESC LIMIT ?
  )
`);

const CK_PAYMENT_ATTEMPT_MAX_ROWS_RAW = Number(
  process.env.CK_PAYMENT_ATTEMPT_MAX_ROWS || 5000
);
const CK_PAYMENT_ATTEMPT_MAX_ROWS =
  Number.isSafeInteger(CK_PAYMENT_ATTEMPT_MAX_ROWS_RAW) &&
  CK_PAYMENT_ATTEMPT_MAX_ROWS_RAW >= 100
    ? Math.min(50_000, CK_PAYMENT_ATTEMPT_MAX_ROWS_RAW)
    : 5000;

let ckFunnelSaveTimer = null;

function ckSavePersistentFunnelNow() {
  try {
    CK_FUNNEL_SAVE.run(
      new Date().toISOString(),
      JSON.stringify(CK_FUNNEL)
    );
  } catch (error) {
    console.error(
      '[funnel] sqlite_save_error',
      error?.message || String(error)
    );
  }
}

// Completion events and their accounting cursor are persisted in the SAME SQLite
// snapshot. A crash before snapshot save replays the event from the canonical store.
function ckConsumeDurableRevenueEvents(){
  if(!machineCommerce)return;
  CK_FUNNEL.gate1bConsumed??={};let changed=false;
  for(const event of machineCommerce.revenueEvents()){
    if(CK_FUNNEL.gate1bConsumed[event.id])continue;
    if(event.network!=='eip155:8453')continue;
    const amount=Number(event.amountAtomic);
    if(!Number.isSafeInteger(amount)||amount<0)throw new Error('Invalid durable revenue event amount');
    const cap=ckCapability(event.capability);
    CK_FUNNEL.x402.verified++;CK_FUNNEL.x402.settled++;CK_FUNNEL.x402.fulfilled++;
    CK_FUNNEL.revenue.atomic_usdc+=amount;CK_FUNNEL.revenue.settlements++;
    cap.fulfilled++;cap.settlements++;cap.atomic_usdc+=amount;
    CK_FUNNEL.gate1bConsumed[event.id]=true;changed=true;
  }
  if(changed)ckSavePersistentFunnelNow();
}

function ckSchedulePersistentFunnelSave() {
  if (ckFunnelSaveTimer) return;

  ckFunnelSaveTimer = setTimeout(() => {
    ckFunnelSaveTimer = null;
    ckSavePersistentFunnelNow();
  }, 250);

  ckFunnelSaveTimer.unref?.();
}

// CK_FUNNEL_V1
// Additive machine-commerce telemetry. Never stores payment signatures,
// authorization payloads, secrets, request bodies, or private keys.
const CK_FUNNEL_STARTED_AT = new Date().toISOString();

const CK_FUNNEL = {
  requests: 0,
  mcp_requests: 0,
  discovery_requests: 0,
  mcp: {
    initialize: 0,
    tools_list: 0,
    tools_call: 0,
    paid_tool_calls: 0
  },
  x402: {
    requests: 0,
    challenges_402: 0,
    payment_returns: 0,
    verified: 0,
    settled: 0,
    fulfilled: 0,
    errors: 0
  },
  capabilities: {},
  revenue: {
    settlements: 0,
    atomic_usdc: 0
  },
  commercial: {
    provider_discovery_requests: 0,
    capability_discovery_requests: 0,
    paid_capability_inquiries: 0,
    price_inspections: 0,
    payment_instruction_requests: 0,
    payment_challenges_issued: 0,
    payment_proofs_received: 0,
    verification_attempts: 0,
    verification_failures: 0,
    settlement_attempts: 0,
    settlement_failures: 0,
    receipt_creation_attempts: 0,
    receipt_creation_failures: 0,
    entitlement_creation_attempts: 0,
    entitlement_creation_failures: 0,
    successful_paid_executions: 0,
    unconverted_challenges: 0,
    synthetic_requests: 0
  },
  failure_categories: {
    INVALID_PAYMENT_PROOF: 0,
    VERIFICATION_FAILURE: 0,
    SETTLEMENT_FAILURE: 0,
    FACILITATOR_FAILURE: 0,
    RECEIPT_FAILURE: 0,
    ENTITLEMENT_FAILURE: 0,
    REPLAY_OR_IDEMPOTENCY_CONFLICT: 0,
    UNEXPECTED_SERVER_EXCEPTION: 0,
    MALFORMED_REQUEST: 0,
    INFRASTRUCTURE_FAILURE: 0
  }
};

const CK_FUNNEL_PERSISTED = ckLoadPersistentFunnel();

if (CK_FUNNEL_PERSISTED?.state) {
  const saved = CK_FUNNEL_PERSISTED.state;
  CK_FUNNEL.gate1bConsumed = saved.gate1bConsumed || {};

  CK_FUNNEL.requests =
    Number(saved.requests || 0);

  CK_FUNNEL.mcp_requests =
    Number(saved.mcp_requests || 0);

  CK_FUNNEL.discovery_requests =
    Number(saved.discovery_requests || 0);

  Object.assign(
    CK_FUNNEL.mcp,
    saved.mcp || {}
  );

  Object.assign(
    CK_FUNNEL.x402,
    saved.x402 || {}
  );

  CK_FUNNEL.capabilities =
    saved.capabilities &&
    typeof saved.capabilities === 'object'
      ? saved.capabilities
      : {};

  Object.assign(
    CK_FUNNEL.revenue,
    saved.revenue || {}
  );

  Object.assign(
    CK_FUNNEL.commercial,
    saved.commercial || {}
  );

  Object.assign(
    CK_FUNNEL.failure_categories,
    saved.failure_categories || {}
  );

  console.log(
    `[funnel] restored persistent counters updated=${CK_FUNNEL_PERSISTED.updated_at}`
  );
}



const CK_PAID_TOOL_NAMES = new Set(PAID_TOOL_NAMES);

function ckCapability(name) {
  if (!CK_FUNNEL.capabilities[name]) {
    CK_FUNNEL.capabilities[name] = {
      requests: 0,
      challenges_402: 0,
      payment_returns: 0,
      unconverted_challenges: 0,
      verification_failures: 0,
      settlement_failures: 0,
      fulfilled: 0,
      settlements: 0,
      atomic_usdc: 0
    };
  }
  return CK_FUNNEL.capabilities[name];
}

const CK_PAYMENT_ATTEMPTS = new Map();
let ckPaymentAttemptWrites = 0;

function ckBoundedText(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, max);
}

function ckSafeReference(value) {
  const text = ckBoundedText(value, 128);
  if (!text) return null;
  if (/^0x[a-fA-F0-9]{64}$/.test(text)) {
    return `${text.slice(0, 12)}...${text.slice(-8)}`;
  }
  if (/^ck_(?:purchase|rcpt|ent)_[A-Za-z0-9-]+$/.test(text)) {
    return text.slice(0, 96);
  }
  return null;
}

function ckIncrement(object, key) {
  object[key] = Number(object[key] || 0) + 1;
}

function ckBeginPaymentAttempt({requestId, capability, route, transport, synthetic=false, proofSubmitted=false}) {
  const id = ckBoundedText(requestId || crypto.randomUUID(), 128);
  const attempt = {
    timestamp: new Date().toISOString(),
    startedAt: Date.now(),
    requestId: id,
    capability: ckBoundedText(capability || 'unknown', 160),
    route: ckBoundedText(route || 'unknown', 240),
    transport: transport === 'mcp' ? 'mcp' : 'http',
    synthetic: synthetic === true,
    challengeIssued: false,
    proofSubmitted: proofSubmitted === true,
    verificationAttempted: false,
    verificationOutcome: null,
    settlementAttempted: false,
    settlementOutcome: null,
    receiptOutcome: null,
    entitlementOutcome: null,
    safeReference: null,
    finalized: false
  };
  CK_PAYMENT_ATTEMPTS.set(id, attempt);
  ckIncrement(CK_FUNNEL.commercial, 'paid_capability_inquiries');
  if (attempt.synthetic) ckIncrement(CK_FUNNEL.commercial, 'synthetic_requests');
  if (attempt.proofSubmitted) ckIncrement(CK_FUNNEL.commercial, 'payment_proofs_received');
  return attempt;
}

function ckObservePaymentLifecycle(event) {
  const requestId = ckBoundedText(event?.telemetryContext?.requestId, 128);
  const attempt = CK_PAYMENT_ATTEMPTS.get(requestId);
  if (!attempt || attempt.finalized) return;

  switch (event.stage) {
    case 'VERIFICATION_ATTEMPTED':
      if (!attempt.verificationAttempted) {
        attempt.verificationAttempted = true;
        ckIncrement(CK_FUNNEL.commercial, 'verification_attempts');
      }
      break;
    case 'VERIFICATION_SUCCEEDED':
      attempt.verificationOutcome = 'SUCCEEDED';
      break;
    case 'VERIFICATION_FAILED':
      attempt.verificationOutcome = 'FAILED';
      attempt.failureKind = event.failureKind || 'VERIFICATION_FAILURE';
      ckIncrement(CK_FUNNEL.commercial, 'verification_failures');
      ckIncrement(ckCapability(attempt.capability), 'verification_failures');
      break;
    case 'SETTLEMENT_ATTEMPTED':
      if (!attempt.settlementAttempted) {
        attempt.settlementAttempted = true;
        ckIncrement(CK_FUNNEL.commercial, 'settlement_attempts');
      }
      break;
    case 'SETTLEMENT_SUCCEEDED':
      attempt.settlementOutcome = 'SUCCEEDED';
      attempt.safeReference = ckSafeReference(event.reference);
      break;
    case 'SETTLEMENT_FAILED':
      attempt.settlementOutcome = 'FAILED';
      attempt.failureKind = event.failureKind || 'SETTLEMENT_FAILURE';
      ckIncrement(CK_FUNNEL.commercial, 'settlement_failures');
      ckIncrement(ckCapability(attempt.capability), 'settlement_failures');
      break;
    case 'FINALIZATION_ATTEMPTED':
      if (attempt.receiptOutcome === null) {
        attempt.receiptOutcome = 'ATTEMPTED';
        attempt.entitlementOutcome = 'ATTEMPTED';
        ckIncrement(CK_FUNNEL.commercial, 'receipt_creation_attempts');
        ckIncrement(CK_FUNNEL.commercial, 'entitlement_creation_attempts');
      }
      break;
    case 'FINALIZATION_SUCCEEDED':
      attempt.receiptOutcome = 'SUCCEEDED';
      attempt.entitlementOutcome = 'SUCCEEDED';
      attempt.safeReference = ckSafeReference(event.receiptId) || attempt.safeReference;
      break;
    case 'FINALIZATION_FAILED':
      attempt.receiptOutcome = 'FAILED';
      attempt.entitlementOutcome = 'FAILED';
      attempt.failureKind = 'RECEIPT_FAILURE';
      ckIncrement(CK_FUNNEL.commercial, 'receipt_creation_failures');
      ckIncrement(CK_FUNNEL.commercial, 'entitlement_creation_failures');
      ckIncrement(CK_FUNNEL.failure_categories, 'ENTITLEMENT_FAILURE');
      break;
  }
}

function ckFinalizePaymentAttempt(attempt, {status, classification, commercialState=null, actionable=false, reference=null}={}) {
  if (!attempt || attempt.finalized) return;
  attempt.finalized = true;
  CK_PAYMENT_ATTEMPTS.delete(attempt.requestId);
  const finalClassification = ckBoundedText(classification || attempt.failureKind || 'UNEXPECTED_SERVER_EXCEPTION', 80);
  const finalReference = ckSafeReference(reference) || attempt.safeReference;

  if (finalClassification === 'SUCCESSFUL_PAID_EXECUTION') {
    ckIncrement(CK_FUNNEL.commercial, 'successful_paid_executions');
  } else if (Object.hasOwn(CK_FUNNEL.failure_categories, finalClassification)) {
    ckIncrement(CK_FUNNEL.failure_categories, finalClassification);
  }
  if (actionable) CK_FUNNEL.x402.errors++;

  try {
    CK_PAYMENT_ATTEMPT_INSERT.run(
      attempt.timestamp,
      attempt.requestId,
      attempt.capability,
      attempt.route,
      attempt.transport,
      attempt.synthetic ? 1 : 0,
      attempt.challengeIssued ? 1 : 0,
      attempt.proofSubmitted ? 1 : 0,
      attempt.verificationAttempted ? 1 : 0,
      attempt.verificationOutcome,
      attempt.settlementAttempted ? 1 : 0,
      attempt.settlementOutcome,
      attempt.receiptOutcome,
      attempt.entitlementOutcome,
      Number(status || 500),
      Math.max(0, Date.now() - attempt.startedAt),
      finalClassification,
      commercialState,
      actionable ? 1 : 0,
      finalReference,
      MCP_RELEASE_VERSION
    );
    ckPaymentAttemptWrites++;
    if (ckPaymentAttemptWrites % 100 === 0) {
      CK_PAYMENT_ATTEMPT_PRUNE.run(CK_PAYMENT_ATTEMPT_MAX_ROWS);
    }
  } catch {
    console.error('[payment-telemetry] persistence_error');
  }
  ckSchedulePersistentFunnelSave();
}

ckConsumeDurableRevenueEvents();

app.use((req,res,next)=>{
  CK_FUNNEL.requests++;

  const observationalMcpDiscovery =
    req.path === '/mcp' &&
    req.method === 'POST' &&
    ['initialize', 'tools/list', 'notifications/initialized']
      .includes(req.body?.method);

  res.once('finish', () => {
    // MCP discovery is observational. Keep its process-local counters for
    // diagnostics, but do not turn initialize/tools/list traffic into durable
    // commercial/application-state mutations. Paid calls and all other
    // lifecycle requests retain the existing persistence behavior.
    if (!observationalMcpDiscovery) ckSchedulePersistentFunnelSave();
  });

  const path = req.path || '';

  if (path === '/mcp') CK_FUNNEL.mcp_requests++;

  if (path.startsWith('/.well-known/')) {
    CK_FUNNEL.discovery_requests++;
    if (path.includes('agent') || path.includes('mcp')) {
      ckIncrement(CK_FUNNEL.commercial, 'provider_discovery_requests');
    }
    if (path.includes('x402') || path.includes('mcp')) {
      ckIncrement(CK_FUNNEL.commercial, 'capability_discovery_requests');
    }
  }

  // Always generate the stored correlation ID. Client-supplied request IDs and
  // edge identifiers may contain unnecessary identifying or secret material.
  const correlationId = crypto.randomUUID();

  req.ckCorrelationId = correlationId;
  res.setHeader('X-CrossingKey-Request-ID', correlationId);

  if (path === '/mcp' && req.method === 'POST') {
    const method = req.body?.method;

    if (method === 'initialize') CK_FUNNEL.mcp.initialize++;
    if (method === 'tools/list') CK_FUNNEL.mcp.tools_list++;

    if (method === 'tools/call') {
      CK_FUNNEL.mcp.tools_call++;

      const name = req.body?.params?.name;

      if (name === 'provider.describe') {
        ckIncrement(CK_FUNNEL.commercial, 'provider_discovery_requests');
      }
      if (['offers.list', 'requirements.check', 'result.preview', 'execution.preflight'].includes(name)) {
        ckIncrement(CK_FUNNEL.commercial, 'capability_discovery_requests');
      }
      if (name === 'cost.estimate') {
        ckIncrement(CK_FUNNEL.commercial, 'price_inspections');
      }

      if (CK_PAID_TOOL_NAMES.has(name)) {
        CK_FUNNEL.mcp.paid_tool_calls++;
      }
    }
  }

  next();
});

function ckAgentDiscovery() {
  return {
    name: 'CrossingKey MCP',
    canonicalId: 'com.crossingkeyintelligence/crossingkey-mcp',
    version: MCP_RELEASE_VERSION,

    description:
      'Machine-commerce MCP provider offering deterministic paid capabilities with buyer-authorized x402 settlement.',

    mcp: {
      endpoint: `${PUBLIC_BASE_URL}/mcp`,
      transport: 'streamable-http',
      protocolVersion: MCP_PROTOCOL_VERSION,
      recommendedEntryTool: 'provider.describe'
    },

    commerce: {
      paymentRequired: true,
      autonomousSellerSpend: false,
      walletMode: 'receiver-only',
      discovery: `${PUBLIC_BASE_URL}/.well-known/x402`,
      executionPattern:
        `${PUBLIC_BASE_URL}/api/x402/{capability}`,
      network: CK_ENABLE_MAINNET
        ? 'eip155:8453'
        : 'eip155:84532',
      asset: 'USDC',
      receiver: CK_RECEIVER_ADDRESS
    },

    paidCapabilities: X402_CAPABILITIES.map(c =>
      publicCapabilityDescriptor(
        c,
        PUBLIC_BASE_URL,
        CK_ENABLE_MAINNET ? 'eip155:8453' : 'eip155:84532'
      )
    ),

    purchaseFlow: [
      'discover',
      'select_capability',
      'request_execution',
      'receive_402_PAYMENT_REQUIRED',
      'obtain_buyer_authorization',
      'return_PAYMENT_SIGNATURE',
      'settle',
      'fulfill',
      'receive_receipt'
    ]
  };
}

app.get('/.well-known/agent-card.json', (_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=300');
  return res.json(ckAgentDiscovery());
});

app.get('/.well-known/agent.json', (_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=300');
  return res.json(ckAgentDiscovery());
});

app.get('/.well-known/x402.json', (_req,res)=>{
  res.setHeader('Cache-Control','public, max-age=300');

  return res.json({
    x402Version: 2,

    canonical:
      `${PUBLIC_BASE_URL}/.well-known/x402`,

    mcp:
      `${PUBLIC_BASE_URL}/mcp`,

    network: CK_ENABLE_MAINNET
      ? 'eip155:8453'
      : 'eip155:84532',

    receiver: CK_RECEIVER_ADDRESS,

    walletMode: 'receiver-only',

    capabilities: X402_CAPABILITIES.map(c =>
      publicCapabilityDescriptor(
        c,
        PUBLIC_BASE_URL,
        CK_ENABLE_MAINNET ? 'eip155:8453' : 'eip155:84532'
      )
    )
  });
});

app.get('/api/operator/revenue-funnel', (req,res)=>{
  const supplied =
    String(
      req.headers.authorization || ''
    ).replace(/^Bearer\s+/i,'');

  if (!CLAIM_SECRET || supplied !== CLAIM_SECRET) {
    return res.status(404).json({
      error: 'not_found'
    });
  }

  const settledUsd =
    CK_FUNNEL.revenue.atomic_usdc / 1_000_000;

  return res.json({
    since: CK_FUNNEL_STARTED_AT,
    ...CK_FUNNEL,
    revenue: {
      ...CK_FUNNEL.revenue,
      settled_usdc: settledUsd.toFixed(6)
    }
  });
});


app.use((err,req,res,next)=>{
  if(err instanceof SyntaxError && err.status===400 && 'body' in err){
    return res.status(400).json({jsonrpc:'2.0',error:{code:-32700,message:'Parse error: malformed JSON'},id:null});
  }
  return next(err);
});

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32700,
        message: 'Parse error'
      },
      id: null
    });
  }
  return next(err);
});

app.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).json({
    ok: true,
    service: 'crossingkey-mcp',
    version: MCP_RELEASE_VERSION
  });
});

app.get('/.well-known/glama.json', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.json({
    $schema: 'https://glama.ai/mcp/schemas/connector.json',
    claim: 'glama_claim_Yw8qE-pDyMcKiUgcV_zgQSEwTLUsXGcV'
  });
});

app.get('/.well-known/openai-apps-challenge', (_req, res) => {
  if (!OPENAI_APPS_CHALLENGE_TOKEN) return res.status(404).send('Not Found');
  return res.type('text/plain').send(OPENAI_APPS_CHALLENGE_TOKEN);
});

app.get('/.well-known/x402',(_req,res)=>res.json({
  x402Version:2,
  ingress:[{version:1,requestHeader:'X-PAYMENT',responseHeader:'X-PAYMENT-RESPONSE'},{version:2,requestHeader:'PAYMENT-SIGNATURE',challengeHeader:'PAYMENT-REQUIRED',responseHeader:'PAYMENT-RESPONSE'}],
  networks:CK_ENABLE_MAINNET?['eip155:8453']:['eip155:84532'],
  mainnetEnabled:CK_ENABLE_MAINNET,
  receiver:CK_RECEIVER_ADDRESS,
  walletMode:'receiver-only',
  capabilities:X402_CAPABILITIES.map(c=>
    publicCapabilityDescriptor(
      c,
      PUBLIC_BASE_URL,
      CK_ENABLE_MAINNET?'eip155:8453':'eip155:84532'
    )
  )
}));

app.get('/.well-known/mcp.json',(_req,res)=>res.json({
  name:'CrossingKey MCP',
  canonicalId:'com.crossingkeyintelligence/crossingkey-mcp',
  version:MCP_RELEASE_VERSION,
  endpoint:`${PUBLIC_BASE_URL}/mcp`,
  transport:'streamable-http',
  protocolVersion:MCP_PROTOCOL_VERSION,
  documentation:'https://www.crossingkeyintelligence.com/mcp/',
  repository:'https://github.com/crossingkey-holdings/crossingkey-mcp',
  machineCommerce:true,
  categories:['Payments & Billing','Autonomous Agents'],
  discoveryProfile:`${DISCOVERY_PROFILE_VERSION}-marketplace`,
  walletMode:'receiver-only',
  paymentRails:['stripe_payment_links','x402_base_usdc'],
  nativeMcpPayment:{protocol:'x402',version:2,requestMeta:'x402/payment',responseMeta:'x402/payment-response',preferred:true},
  httpPaymentFallback:{v2:true,v1:true},
  legacyCompatibilityRails:['prepaid_request_credits'],
  recommendedEntryTool:'provider.describe',
  toolNaming:'resource.action',
  roleScopedTools:true,
  anonymousToolProfile:'paid-machine-utility-storefront',
  toolVisibility:'buyer/provider/admin tools appear only in matching authenticated MCP sessions',
  legacyCompatibility:{available:true,exposed:CK_EXPOSE_LEGACY_TOOLS},
  paidCapabilities:X402_CAPABILITIES.map(c=>
    publicCapabilityDescriptor(
      c,
      PUBLIC_BASE_URL,
      CK_ENABLE_MAINNET?'eip155:8453':'eip155:84532'
    )
  ),
  storefront:{
    freeMcpTools:FREE_DISCOVERY_TOOL_NAMES.length,
    paidMcpTools:PAID_TOOL_NAMES.length,
    freeTools:FREE_DISCOVERY_TOOL_NAMES,
    paidTools:PAID_TOOL_NAMES,
    discoveryFree:true,
    computationFree:false,
    buyerAuthorizationRequired:true
  },
  marketplace:marketplace.describe()
}));

app.get('/api/marketplace/delivery/:id',async(req,res)=>{
  try {
    marketplaceRate(`delivery:${req.socket.remoteAddress}`);
    const artifact=await marketplace.download(req.params.id,marketplacePrincipal(req));
    res.setHeader('content-type','application/octet-stream');
    res.setHeader('content-disposition','attachment; filename="capability-asset.zip"');
    res.setHeader('cache-control','private, no-store');
    const stream=fs.createReadStream(artifact.file);stream.on('error',()=>res.destroy());stream.pipe(res);
  }catch(error){res.status(403).json({errorCode:safeError(error)});}
});
app.post('/api/marketplace/purchase',async(req,res)=>{
  try {
    marketplaceRate(`purchase:${req.socket.remoteAddress}`);
    const raw=req.headers['payment-signature']||req.headers['payment-signed']||req.headers['x-payment'];
    if(!raw){const quote=marketplace.quote(req.body?.capabilityId);res.setHeader('PAYMENT-REQUIRED',Buffer.from(JSON.stringify({x402Version:2,resource:{url:`${PUBLIC_BASE_URL}/api/marketplace/purchase`,mimeType:'application/json'},accepts:[quote.paymentRequirement.v2]})).toString('base64'));return res.status(402).json({x402Version:1,accepts:[quote.paymentRequirement.v1]});}
    const args=purchaseSchema.parse({...req.body,paymentPayload:JSON.parse(Buffer.from(String(raw),'base64').toString('utf8'))});
    const result=await marketplace.purchase(args,marketplacePrincipal(req));
    if(result.receipt){const settlement=Buffer.from(JSON.stringify({success:result.paymentStatus==='successful',transaction:result.receipt.payment.transaction,network:result.receipt.payment.network})).toString('base64');res.setHeader('PAYMENT-RESPONSE',settlement);res.setHeader('X-PAYMENT-RESPONSE',settlement);}
    res.status(result.status==='verified'?200:202).json(result);
  }catch(error){res.status(error.message==='STORE_BUSY'?409:400).json({errorCode:safeError(error)});}
});

app.get('/api/machine-commerce/status',(_req,res)=>res.json(machineCommerce?machineCommerce.status():{configured:false,receiver:CK_RECEIVER_ADDRESS,mainnetEnabled:false}));

app.post('/api/x402/:capability',async(req,res)=>{
  CK_FUNNEL.x402.requests++;
  const ckCapName = String(req.params.capability || '');
  const ckCap = ckCapability(ckCapName);
  ckCap.requests++;

  const ckHadPayment =
    Boolean(
      req.headers['payment-signature'] ||
      req.headers['x-payment']
    );

  if (ckHadPayment) {
    CK_FUNNEL.x402.payment_returns++;
    ckCap.payment_returns++;
  }

  const ckAttempt = ckBeginPaymentAttempt({
    requestId: req.ckCorrelationId,
    capability: ckCapName,
    route: `/api/x402/${encodeURIComponent(ckCapName)}`,
    transport: 'http',
    synthetic: String(req.headers['x-crossingkey-synthetic'] || '') === '1',
    proofSubmitted: ckHadPayment
  });

  try{
    if(!machineCommerce){ckFinalizePaymentAttempt(ckAttempt,{status:503,classification:'INFRASTRUCTURE_FAILURE',actionable:true});return res.status(503).json({error:'machine_commerce_not_configured'});}
    const capabilityName=String(req.params.capability||'');
    if(!MACHINE_CAPABILITIES.some(x=>x.name===capabilityName)){ckFinalizePaymentAttempt(ckAttempt,{status:404,classification:'MALFORMED_REQUEST',actionable:false});return res.status(404).json({error:'unknown_capability'});}
    const v1Header=req.headers['x-payment'];
    const v2Header=req.headers['payment-signature'];
    if(!v1Header&&!v2Header){
      const requested=req.query.x402Version??req.headers['x402-version'];
      let version;
      try{version=normalizeX402Version(requested);}catch{ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'MALFORMED_REQUEST',actionable:false});return res.status(400).json({error:'unsupported_x402_version'});}
      const challenge=machineCommerce.paymentRequired(capabilityName,version);
      for(const [name,value] of Object.entries(challenge.headers)) res.set(name,value);
      CK_FUNNEL.x402.challenges_402++;
      ckCap.challenges_402++;
      ckCap.unconverted_challenges++;
      ckAttempt.challengeIssued=true;
      ckIncrement(CK_FUNNEL.commercial, 'payment_instruction_requests');
      ckIncrement(CK_FUNNEL.commercial, 'payment_challenges_issued');
      ckIncrement(CK_FUNNEL.commercial, 'unconverted_challenges');
      ckFinalizePaymentAttempt(ckAttempt,{status:402,classification:'EXPECTED_UNPAID_402',commercialState:'UNCONVERTED_CHALLENGE',actionable:false});
      return res.status(402).json(challenge.body);
    }
    if(v1Header&&v2Header){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'INVALID_PAYMENT_PROOF',actionable:true});return res.status(400).json({error:'ambiguous_payment_headers'});}
    const input=req.body?.input;
    const idempotencyKey=String(req.body?.idempotency_key||req.headers['idempotency-key']||'');
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'MALFORMED_REQUEST',actionable:false});return res.status(400).json({error:'bounded_idempotency_key_required'});}
    const inputValidation=validatePaidCapabilityInput(capabilityName,input);
    if(!inputValidation.ok){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'MALFORMED_REQUEST',actionable:false});return res.status(400).json({error:inputValidation.code});}
    const paymentPayload=decodeBase64Json(v1Header||v2Header);
    const expectedVersion=v1Header?1:2;

    console.error(
      `[x402] paid_ingress capability=${capabilityName} version=${expectedVersion} request=${ckAttempt.requestId}`
    );

    if(paymentPayload.x402Version!==expectedVersion){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'INVALID_PAYMENT_PROOF',actionable:true});return res.status(400).json({error:'payment_header_version_mismatch'});}
    if(expectedVersion===1 && paymentPayload.accepted!==undefined){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'INVALID_PAYMENT_PROOF',actionable:true});return res.status(400).json({error:'v1_envelope_contains_v2_fields'});}
    if(expectedVersion===2 && (!paymentPayload.accepted||typeof paymentPayload.accepted!=='object')){ckFinalizePaymentAttempt(ckAttempt,{status:400,classification:'INVALID_PAYMENT_PROOF',actionable:true});return res.status(400).json({error:'v2_accepted_requirements_required'});}

    console.error(`[x402] invoke_start capability=${capabilityName}`);

    const result=await machineCommerce.invoke({
      capabilityName,
      input,
      idempotencyKey,
      paymentPayload,
      telemetryContext:{requestId:ckAttempt.requestId,route:ckAttempt.route,synthetic:ckAttempt.synthetic}
    });

    console.error(
      `[x402] invoke_ok capability=${capabilityName} request=${ckAttempt.requestId} duplicate=${result.duplicate===true}`
    );

    ckConsumeDurableRevenueEvents();

    console.error(
      `[funnel] fulfilled capability=${capabilityName} request=${req.ckCorrelationId || 'unknown'}`

    );

    const settlementHeader=Buffer.from(JSON.stringify(result.settlement)).toString('base64');
    res.set(expectedVersion===1?'X-PAYMENT-RESPONSE':'PAYMENT-RESPONSE',settlementHeader);
    ckFinalizePaymentAttempt(ckAttempt,{
      status:200,
      classification:result.duplicate?'REPLAY_OR_IDEMPOTENCY_CONFLICT':'SUCCESSFUL_PAID_EXECUTION',
      actionable:false,
      reference:result.receipt?.id||result.settlement?.transaction
    });
    return res.json(result);
  }catch(err){
    const message=String(err?.message||'x402 execution failed');
    const classification = ckAttempt.failureKind ||
      (/replay|idempotency|already processed/i.test(message)
        ? 'REPLAY_OR_IDEMPOTENCY_CONFLICT'
        : /verification|verify/i.test(message)
          ? 'VERIFICATION_FAILURE'
          : /settlement|reconciliation/i.test(message)
            ? 'SETTLEMENT_FAILURE'
            : /invalid|required|mismatch|unsupported|authorization|signature/i.test(message)
              ? 'INVALID_PAYMENT_PROOF'
              : 'UNEXPECTED_SERVER_EXCEPTION');

    console.error(
      `[x402] route_error name=${ckBoundedText(err?.name||'Error',80)} class=${classification}`
    );

    const client=/required|mismatch|unsupported|invalid|conflict|replay|disabled/i.test(message);
    ckFinalizePaymentAttempt(ckAttempt,{status:client?400:502,classification,actionable:classification!=='REPLAY_OR_IDEMPOTENCY_CONFLICT'});
    return res.status(client?400:502).json({
      error:client?'invalid_payment_or_request':'settlement_or_execution_failed'
    });
  }
});

function decodeBase64Json(value){
  try{return JSON.parse(Buffer.from(String(value),'base64').toString('utf8'));}
  catch{throw new Error('Invalid payment header encoding');}
}

app.get('/claim',async(req,res)=>{
  res.set('Cache-Control','no-store');
  res.set('Referrer-Policy','no-referrer');
  try{
    if(!stripe) return res.status(503).send('Stripe is not configured');
    const sessionId=String(req.query.session_id||'');
    if(!sessionId.startsWith('cs_')) return res.status(400).send('Invalid Checkout Session');
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    const result=await processPaidSession(session);
    if(result.status==='waiting_for_payment'){
      return res.status(202).type('html').send('<h1>Payment pending</h1><p>Payment has not yet been confirmed. No entitlement has been issued.</p>');
    }
    const offer=await resolveOfferFromSession(session);

    if(result.fulfillment==='credits'){
      const token=requestToken(session.id);
      return res.type('html').send(`<h1>CrossingKey Request Credits</h1><p>${result.credits} credits are active.</p><p>Your API token:</p><pre>${token}</pre><p>Keep this token private.</p>`);
    }
    if(result.fulfillment==='digital_download' && result.delivery_ready){
      const token=downloadToken(session.id,offer.id);
      const url=`${PUBLIC_BASE_URL}/download/${encodeURIComponent(token)}`;
      return res.type('html').send(`<h1>Purchase confirmed</h1><p>${offer.name}</p><p><a href="${url}">Download your files</a></p>`);
    }
    if(result.fulfillment==='service_order'){
      return res.type('html').send(`<h1>Payment confirmed</h1><p>Your CrossingKey service order has been recorded.</p><p>Session: ${session.id}</p>`);
    }
    return res.status(202).type('html').send('<h1>Payment confirmed</h1><p>Your purchase is recorded, but its delivery file has not yet been bound to the fulfillment server.</p>');
  }catch(err){
    console.error(err);
    res.status(400).send('Unable to verify this checkout session.');
  }
});

app.get('/download/:token',(req,res)=>{
  try{
    const token=String(req.params.token||'');
    const tokenHash=sha256Text(token);
    const s=state();
    const ent=s.download_entitlements[tokenHash];
    if(!ent) return res.status(404).send('Invalid download token');
    if(ent.downloads >= ent.max_downloads) return res.status(410).send('Download limit reached');
    const file=safeDeliveryPath(ent.file);
    if(!fs.existsSync(file)) return res.status(503).send('Delivery file unavailable');
    if(fileSha256(file)!==ent.sha256) return res.status(503).send('Delivery file integrity check failed');
    ent.downloads += 1;
    ent.last_download_at = new Date().toISOString();
    saveState(s);
    return res.download(file,path.basename(file));
  }catch(err){
    console.error(err);
    res.status(500).send('Download failed');
  }
});

app.get('/api/credits/balance',(req,res)=>{
  const principal=resolveCreditPrincipal(req);
  if(!principal) return res.status(401).json({error:'invalid_token'});

  const acct=currentCreditAccount(principal.principal_id);
  if(!acct) return res.status(401).json({error:'invalid_token'});

  const result=runXkeyBridge({
    action:'balance',
    principal_id:principal.principal_id,
    session_id:acct.session_id,
    granted:Number(acct.granted||0)
  });

  if(!result.ok){
    return res.status(503).json({
      error:result.error || 'credit_runtime_unavailable'
    });
  }

  res.json({
    balance:result.balance,
    granted:acct.granted,
    offer_id:acct.offer_id
  });
});

function mcpError(error_code,message,hint=null){
  return {
    isError:true,
    structuredContent:{error_code,message,hint},
    content:[{type:'text',text:hint?`${message} ${hint}`:message}]
  };
}

const DISCOVERY_GUIDE_TEXT = [
  'CrossingKey discovery guide (free; no payment or execution happens here).',
  '',
  'Recommended sequence:',
  '1. provider.describe — learn CrossingKey identity, commerce model, and rails.',
  '2. offers.list — browse public offers and paid capabilities (metadata only).',
  '3. requirements.check — prerequisites for one item_id.',
  '4. cost.estimate — the known price; ESTIMATE_ONLY, never a charge.',
  '5. result.preview — result shape only; paid output is never revealed here.',
  '6. execution.preflight — final no-charge decision point.',
  '7. credits.options — legacy-credit compatibility status; new credit sales are disabled.',
  'Then STOP. Human authorization is required before any purchase, signing,',
  'transfer, spending, entitlement creation, or paid execution.',
  '',
  'Marketplace capabilities: use marketplace.describe, then capability.search',
  'or catalog.list for active public capabilities, capability.get for one',
  'capability, and commerce.quote for the authoritative price breakdown.',
  'Paid marketplace execution is capability.purchase with a prior human',
  'approval, a buyer idempotency key, and verified x402 payment.',
  '',
  'These are guidance only. Server-side authorization, payment, entitlement,',
  'receipt, replay, idempotency, and receiver-only controls are authoritative.'
].join('\n');

function capabilityInstructions(name) {
  const paid = publicCapabilityList().find(x => x.id === name || x.tool === name);
  const offer = catalog().offers.find(o => o.id === name);
  if (!paid && !offer) return null;
  const lines = [
    `Instructions for ${name}.`,
    ''
  ];
  if (paid) {
    lines.push(
      `Paid x402 capability (${paid.name}).`,
      `Price: ${paid.price?.amount_usd ?? 'see cost.estimate'} USD.`,
      '',
      '1. requirements.check {item_id} — confirm prerequisites.',
      '2. cost.estimate {item_id} — confirm the exact price.',
      '3. result.preview {item_id} — confirm the result shape.',
      '4. execution.preflight {item_id} — final no-charge check.',
      '5. Obtain HUMAN AUTHORIZATION.',
          `6. Call the ${name} MCP tool — it returns a native x402 v2 PaymentRequired challenge without spending.`,
          '7. After authorization, retry the same MCP tool call with the PaymentPayload',
          '   in _meta["x402/payment"]. Non-native clients may use the HTTP fallback.',
          '8. Expect settlement evidence in _meta["x402/payment-response"] and a result',
          '   with purchase and receipt references. Verify the receipt before treating it as final.'
    );
  } else {
    lines.push(
      `Public offer (${offer.name}).`,
      '',
      '1. requirements.check {item_id} — confirm prerequisites.',
      '2. cost.estimate {item_id} — confirm the price.',
      '3. Obtain HUMAN AUTHORIZATION before any purchase.',
      '4. Purchase via the advertised checkout; this MCP server never charges.'
    );
  }
  return lines.join('\n');
}

const COMMERCE_POLICY_TEXT = [
  'CrossingKey commerce policy.',
  '',
  'Free vs paid: discovery tools (provider.describe, offers.list,',
  'requirements.check, cost.estimate, result.preview, execution.preflight,',
  'credits.options, and the public marketplace discovery tools) are free and',
  'read-only. Paid tools return a native x402 v2 challenge; authorized retries',
  'carry _meta["x402/payment"] and return _meta["x402/payment-response"]. HTTP',
  'x402 v1/v2 remains a compatibility fallback. Legacy credit redemption is separately named and never charges x402.',
  '',
  'Receiver-only: CrossingKey never initiates spending. Payment happens only',
  'after explicit human authorization, via Stripe payment links or x402',
  'USDC on Base (Sepolia by',
  'default; mainnet only when the operator enables it).',
  '',
  'Human authorization: required before any purchase, signing, transfer,',
  'spending, entitlement creation, or paid execution. Marketplace purchases',
  'additionally require a prior buyer-bound human approval that names the',
  'exact capability, input, idempotency key, and quote.',
  '',
  'Idempotency and replay: every paid call needs a buyer-generated',
  'idempotency key (8-160 chars). Retrying with the same key returns the',
  'stored result instead of a new charge; conflicting reuse is rejected.',
  'Replayed payments are detected and rejected.',
  '',
  'Receipts and entitlements: every paid execution produces a verifiable',
  'receipt (receipt.verify) and a bounded entitlement (entitlement.inspect).',
  'Verify before treating a result as final; disputed or failed payments',
  'return error codes, never silent charges.'
].join('\n');

function makeMcpServer(authContext=null,marketplaceContext=()=>null,rateKey='anonymous'){
  const s=new McpServer({name:'crossingkey-mcp',version:MCP_RELEASE_VERSION},{instructions:MCP_SERVER_INSTRUCTIONS});


  // Marketplace tools are role-scoped inside registerMarketplaceTools:
  // anonymous sessions see only the public subset; privileged tools appear
  // only for matching authenticated principals. Approval minting remains a
  // local-operator CLI action; it is never exposed as an MCP tool.
  registerMarketplaceTools(s,{
    marketplace,
    principal:marketplaceContext,
    legacyCapabilities:X402_CAPABILITIES,
    core:machineCommerce,
    rate:name=>{
      marketplaceRate(rateKey);
      if(['provider.apply','provider.register','creator.apply','capability.register'].includes(name)){
        marketplaceIntakeRate(rateKey);
      }
    }
  });

  const discoveryAnnotations={readOnlyHint:true,destructiveHint:false,openWorldHint:false};
  const discoveryTool=(name,inputSchema,description,handler)=>s.registerTool(name,{title:name,description,inputSchema,outputSchema:DISCOVERY_OUTPUT_SCHEMAS[name],annotations:discoveryAnnotations},async input=>{
    try{
      const result=await handler(input);
      return {structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]};
    }catch(error){
      console.error(`discovery tool ${name} failed:`,error?.message||error);
      return mcpError('discovery_failed','Discovery failed unexpectedly.','Retry the same call; if this persists, the operator should check the server data files.');
    }
  });
  discoveryTool('provider.describe',z.object({}).strict(),'FREE read-only provider and commerce policy discovery. Use this before selecting an offer or capability.',()=>({provider:PROVIDER_PROFILE,sequence:FREE_DISCOVERY_TOOL_NAMES,manifest:MCP_TOOL_MANIFEST,stopBeforePayment:true}));
  discoveryTool('offers.list',discoveryQuerySchema,'FREE read-only public offer and capability discovery. This tool never starts payment or execution.',discoveryOfferList);
  discoveryTool('requirements.check',discoveryItemSchema,'FREE read-only requirements check. This tool never authorizes or starts payment or execution.',({item_id})=>discoveryRequirements(item_id));
  discoveryTool('cost.estimate',discoveryItemSchema,'FREE read-only cost estimate. This tool never creates checkout, reserves funds, or contacts a facilitator.',({item_id})=>discoveryCost(item_id));
  discoveryTool('result.preview',discoveryItemSchema,'FREE read-only result-shape preview. This tool never executes a capability or creates an entitlement or receipt.',({item_id})=>discoveryPreview(item_id));
  discoveryTool('execution.preflight',discoveryItemSchema,'FREE read-only execution preflight. Returns READY_FOR_HUMAN_AUTHORIZATION only; it never authorizes, purchases, settles, executes, or creates records.',({item_id})=>discoveryPreflight(item_id));

  discoveryTool('credits.options',z.object({}).strict(),'FREE read-only legacy credit compatibility status. New prepaid-credit sales are disabled in v4; historical paid credits remain redeemable through a separate compatibility path.',()=>({packs:[],legacy_redemption:'separate_compatibility_path',new_sales_enabled:false,free:true,payment_started:false}));

  // Free commercial discovery is registered first. All current paid capabilities use x402.

  // PAID X402 TOOL SURFACE
  // Generated from the canonical paid capability catalog.
  const paidX402Tools = X402_CAPABILITIES;

  function nativePaymentRequired(capability){
    const httpChallenge=machineCommerce.paymentRequired(capability.name,2);
    const decoded=JSON.parse(Buffer.from(httpChallenge.headers['PAYMENT-REQUIRED'],'base64').toString('utf8'));
    return {
      x402Version:2,
      error:'Payment required to access this resource',
      resource:{url:`mcp://tool/${capability.name}`,description:capability.description,mimeType:'application/json'},
      accepts:decoded.accepts,
      extensions:decoded.extensions
    };
  }

  function nativePaymentKey(capability,input,extra){
    const session=String(extra?.sessionId||'');
    if(!session) throw new Error('MCP session identity is required for paid retry');
    return `native-mcp-${session}-${sha256({capability:capability.name,input}).slice(-48)}`;
  }

  function nativePaymentFailure(capability,reason){
    const required=nativePaymentRequired(capability);
    const body={...required,error:reason};
    return {isError:true,structuredContent:body,content:[{type:'text',text:JSON.stringify(body)}]};
  }

  for (const paid of paidX402Tools) {
    const paidInputSchema = paid.inputSchema;
    s.registerTool(
      paid.name,
      {
        title:paid.title,
        description:paid.description,
        inputSchema:paidInputSchema,
        outputSchema:X402_CHALLENGE_OUTPUT_SCHEMA,
        annotations:{
          readOnlyHint:false,
          destructiveHint:false,
          openWorldHint:true
          ,idempotentHint:true
        }
      },
      async(input,extra)=>{
        if(!machineCommerce){
          return {
            isError:true,
            content:[{type:'text',text:'Machine commerce is not configured.'}]
          };
        }

        const paymentPayload=extra?._meta?.['x402/payment'];
        const paymentAttempt=ckBeginPaymentAttempt({
          requestId:crypto.randomUUID(),
          capability:paid.name,
          route:`mcp://tool/${paid.name}`,
          transport:'mcp',
          synthetic:extra?._meta?.['crossingkey/synthetic']===true,
          proofSubmitted:paymentPayload!==undefined
        });

        try{
          if(paymentPayload===undefined){
            const required=nativePaymentRequired(paid);
            paymentAttempt.challengeIssued=true;
            ckIncrement(CK_FUNNEL.commercial, 'payment_instruction_requests');
            ckIncrement(CK_FUNNEL.commercial, 'payment_challenges_issued');
            ckIncrement(CK_FUNNEL.commercial, 'unconverted_challenges');
            ckIncrement(ckCapability(paid.name), 'unconverted_challenges');
            ckFinalizePaymentAttempt(paymentAttempt,{status:200,classification:'EXPECTED_UNPAID_402',commercialState:'UNCONVERTED_CHALLENGE',actionable:false});
            return {isError:true,structuredContent:required,content:[{type:'text',text:JSON.stringify(required)}]};
          }
          if(!paymentPayload||typeof paymentPayload!=='object'||paymentPayload.x402Version!==2){
            ckFinalizePaymentAttempt(paymentAttempt,{status:200,classification:'INVALID_PAYMENT_PROOF',actionable:true});
            return nativePaymentFailure(paid,'Invalid x402 v2 payment payload');
          }
          const idempotencyKey=nativePaymentKey(paid,input,extra);
          const result=await machineCommerce.invoke({
            capabilityName:paid.name,
            input,
            idempotencyKey,
            paymentPayload,
            telemetryContext:{requestId:paymentAttempt.requestId,route:paymentAttempt.route,synthetic:paymentAttempt.synthetic}
          });
          ckConsumeDurableRevenueEvents();
          const response={success:true,transaction:result.settlement?.transaction||null,network:result.receipt?.payment?.network||null,payer:result.receipt?.holder||null};
          ckFinalizePaymentAttempt(paymentAttempt,{
            status:200,
            classification:result.duplicate?'REPLAY_OR_IDEMPOTENCY_CONFLICT':'SUCCESSFUL_PAID_EXECUTION',
            actionable:false,
            reference:result.receipt?.id||result.settlement?.transaction
          });
          return {
            structuredContent:result,
            content:[{type:'text',text:JSON.stringify(result)}],
            _meta:{'x402/payment-response':response}
          };
        }catch(e){
          const message=String(e?.message||'');
          const classification=paymentAttempt.failureKind||(
            /replay|idempotency/i.test(message)
              ? 'REPLAY_OR_IDEMPOTENCY_CONFLICT'
              : /verification|verify/i.test(message)
                ? 'VERIFICATION_FAILURE'
                : /settlement|reconciliation/i.test(message)
                  ? 'SETTLEMENT_FAILURE'
                  : /invalid|required|mismatch|unsupported|authorization|signature/i.test(message)
                    ? 'INVALID_PAYMENT_PROOF'
                    : 'UNEXPECTED_SERVER_EXCEPTION'
          );
          ckFinalizePaymentAttempt(paymentAttempt,{status:200,classification,actionable:classification!=='REPLAY_OR_IDEMPOTENCY_CONFLICT'});
          return nativePaymentFailure(paid,'Payment verification or settlement failed');
        }
      }
    );
  }

  // Explicit compatibility surface for customers who already purchased credits.
  // This path is never used by new x402 requests and never settles x402 payments.
  if(authContext) s.registerTool('xkey.validate.legacy',{
    title:'Legacy XKEY Credit Redemption',
    description:'Compatibility-only redemption of an existing paid request credit. New customers must use xkey.validate with direct x402 payment.',
    inputSchema:{idempotency_key:z.string().min(8).max(160),raw_intake:z.string().min(2).max(100000)},
    outputSchema:XKEY_VALIDATE_OUTPUT_SCHEMA,
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false,idempotentHint:true}
  },async({idempotency_key,raw_intake})=>{
    if(!authContext)return mcpError('authentication_required','A legacy credit credential is required.','Use xkey.validate for the current direct x402 payment path.');
    const acct=currentCreditAccount(authContext.principal_id);
    if(!acct)return mcpError('credential_revoked','The legacy credit credential is no longer valid.','No x402 payment was attempted.');
    const result=runXkeyBridge({action:'validate',principal_id:authContext.principal_id,session_id:acct.session_id,granted:Number(acct.granted||0),idempotency_key,raw_intake,max_input_chars:XKEY_MAX_INPUT_CHARS});
    if(!result.ok)return {isError:true,structuredContent:{error:result.error||'legacy_execution_failed'},content:[{type:'text',text:result.message||'Legacy execution failed safely.'}]};
    const payload={capability:'xkey.validate.legacy',state:result.state,success:result.success,credits_charged:result.credits,balance:result.balance,reservation_id:result.reservation_id,receipt_id:result.receipt_id,request_hash:result.request_hash,normalized:result.normalized||null};
    return {isError:!result.success,structuredContent:payload,content:[{type:'text',text:result.success?'Legacy validation succeeded; no x402 payment was attempted.':'Legacy validation failed safely; no x402 payment was attempted.'}]};
  });

  // Group F: public static resources plus per-capability instructions.
  s.registerResource('discovery-guide','crossingkey://discovery-guide',{
    title:'CrossingKey discovery guide',
    description:'Free read-only guide: how to discover offers and capabilities without spending.',
    mimeType:'text/plain'
  },async uri=>({contents:[{uri:uri.href,mimeType:'text/plain',text:DISCOVERY_GUIDE_TEXT}]}));

  s.registerResource('commerce-policy','crossingkey://commerce-policy',{
    title:'CrossingKey commerce policy',
    description:'Free read-only commerce policy: free/paid separation, receiver-only payments, authorization, idempotency, receipts.',
    mimeType:'text/plain'
  },async uri=>({contents:[{uri:uri.href,mimeType:'text/plain',text:COMMERCE_POLICY_TEXT}]}));

  s.registerResource('capability-instructions',new ResourceTemplate('crossingkey://capability/{name}',{list:undefined}),{
    title:'Per-capability instructions',
    description:'Free read-only instructions for one offer or paid capability: discovery sequence, authorization, payment, and confirmation.',
    mimeType:'text/plain'
  },async (uri,vars)=>{
    const text=capabilityInstructions(String(vars.name||''));
    if(!text) throw new Error(`Unknown capability or offer: ${vars.name}`);
    return {contents:[{uri:uri.href,mimeType:'text/plain',text}]};
  });

  return s;
}

const transports=new Map();
const sessionPrincipals=new Map();
const marketplaceSessionPrincipals=new Map();

function sessionAuthorizationMatches(sid,req){
  if(!sessionPrincipals.has(sid)) return false;
  if(marketplaceSessionPrincipals.get(sid)!==(marketplacePrincipal(req)?.credentialHash||null)) return false;

  const bound=sessionPrincipals.get(sid);

  // Anonymous discovery sessions remain anonymous.
  if(bound===null) return true;

  // Authenticated sessions require the same valid principal every request.
  const current=resolveCreditPrincipal(req);

  return Boolean(
    current &&
    current.principal_id===bound.principal_id
  );
}

function forgetMcpSession(sid){
  if(!sid) return;
  transports.delete(sid);
  sessionPrincipals.delete(sid);
  marketplaceSessionPrincipals.delete(sid);
}

app.post('/mcp',async(req,res)=>{
  try{
    // DNS-rebinding defense: browser-originated MCP traffic must be same-host.
    // Non-browser MCP clients normally send no Origin header.
    const origin=req.headers.origin;
    if(origin){
      let originHost=null;
      try{originHost=new URL(origin).hostname.toLowerCase();}catch{}
      const requestHost=String(req.headers.host||'').split(':')[0].toLowerCase();
      if(!originHost||originHost!==requestHost){
        return res.status(403).json({
          jsonrpc:'2.0',
          error:{code:-32000,message:'Forbidden: Origin not allowed'},
          id:null
        });
      }
    }
    const sid=req.headers['mcp-session-id'];
    let t;

    if(sid && transports.has(sid)){
      if(!sessionAuthorizationMatches(sid,req)){
        return res.status(401).json({
          jsonrpc:'2.0',
          error:{
            code:-32001,
            message:'Unauthorized MCP session'
          },
          id:null
        });
      }

      t=transports.get(sid);
    }
    else if(!sid && isInitializeRequest(req.body)){
      const authContext=resolveCreditPrincipal(req);

      t=new StreamableHTTPServerTransport({
        sessionIdGenerator:()=>randomUUID(),
        onsessioninitialized:id=>{
          transports.set(id,t);
          marketplaceSessionPrincipals.set(id,marketplacePrincipal(req)?.credentialHash||null);
          sessionPrincipals.set(
            id,
            authContext
              ? {principal_id:authContext.principal_id}
              : null
          );
        }
      });

      t.onclose=()=>{
        if(t.sessionId) forgetMcpSession(t.sessionId);
      };

      const authorization=req.headers.authorization;
      const rateKey=marketplacePrincipal(req)?.credentialHash||req.socket.remoteAddress||'anonymous';
      await makeMcpServer(authContext,()=>resolveMarketplacePrincipal(authorization,marketplaceAuthFile),rateKey).connect(t);
    }
    else{
      return res.status(400).json({
        jsonrpc:'2.0',
        error:{
          code:-32000,
          message:'Bad Request: missing or invalid MCP session'
        },
        id:null
      });
    }

    await t.handleRequest(req,res,req.body);
  }catch(err){
    console.error(err);

    if(!res.headersSent){
      res.status(500).json({
        error:'Internal MCP server error'
      });
    }
  }
});

app.get('/mcp',async(req,res)=>{
  const sid=req.headers['mcp-session-id'];
  const t=transports.get(sid);

  if(!t){
    return res.status(200).type('html').send("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>CrossingKey MCP v5</title>\n<style>:root{color-scheme:dark;--void:#050508;--text:#f4f1f7;--muted:#c7c2cf;--pink:#cc0155;--line:rgba(204,1,85,.35)}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,rgba(204,1,85,.16),transparent 36rem),var(--void);color:var(--text);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}main{max-width:920px;margin:0 auto;padding:clamp(2rem,7vw,6rem) 1.25rem}a{color:#ff4e9a}h1,h2{font-family:Georgia,serif;font-weight:500;line-height:1.05}h1{font-size:clamp(3rem,9vw,6.5rem);margin:.5rem 0 1rem}h2{font-size:2rem;margin-top:3rem}.eyebrow{color:#ff4e9a;letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;font-weight:700}.lede{max-width:680px;color:var(--muted);font-size:1.2rem}.panel{border:1px solid var(--line);background:rgba(16,16,24,.82);padding:1.2rem 1.3rem;margin:1rem 0;box-shadow:0 0 30px rgba(204,1,85,.08)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}code{color:#ff79b4}pre{overflow:auto;color:#f8d7e7;background:#08080d;border:1px solid rgba(255,255,255,.12);padding:1rem}.links{display:flex;flex-wrap:wrap;gap:.7rem}.links a{display:inline-block;border:1px solid rgba(204,1,85,.55);padding:.7rem 1rem;text-decoration:none}.links a:hover{background:rgba(204,1,85,.16);box-shadow:0 0 28px rgba(204,1,85,.45)}</style>\n</head><body><main><div class=\"eyebrow\">CrossingKey Intelligence / Machine Interface</div>\n<h1>CrossingKey MCP v5</h1><p class=\"lede\">A governed Streamable HTTP MCP for agent discovery, bounded capabilities, buyer-authorized machine commerce, x402 payments on Base, and verifiable results.</p>\n<section class=\"panel\"><strong>Candidate server release:</strong> <code>5.0.1</code><br><strong>Canonical identity:</strong> <code>com.crossingkeyintelligence/crossingkey-mcp</code><br><strong>Network:</strong> <code>eip155:8453</code> · Base mainnet · USDC<br><strong>Wallet policy:</strong> receiver-only</section>\n<h2>How it works</h2><p>Discovery is free. Evaluation is safe. Payment is explicit. Authority stays bounded. Execution is deterministic. Fulfillment is verifiable.</p>\n<pre>provider.describe\n→ offers.list\n→ requirements.check\n→ cost.estimate\n→ result.preview\n→ execution.preflight\n→ human authorization\n→ payment\n→ execute\n→ receipt</pre>\n<h2>Capabilities</h2><p>Free discovery covers provider identity, offers, requirements, cost estimates, result previews, execution preflight, and credit compatibility. Paid capabilities include schema audits, OpenAPI audits, machine-commerce readiness, artifact integrity, hashing, secret scanning, PII scanning, JSON repair, prompt audits, launch audits, purchase-path audits, and XKEY validation.</p>\n<h2>Connect</h2><div class=\"links\"><a href=\"https://mcp.crossingkeyintelligence.com/mcp\">MCP endpoint</a><a href=\"https://mcp.crossingkeyintelligence.com/.well-known/mcp.json\">MCP discovery</a><a href=\"https://mcp.crossingkeyintelligence.com/.well-known/x402\">x402 discovery</a><a href=\"https://github.com/crossingkey-holdings/crossingkey-mcp\">GitHub source</a><a href=\"https://www.crossingkeyintelligence.com\">CrossingKey Intelligence</a></div>\n<p style=\"color:var(--muted);margin-top:3rem\">Payment and execution remain separate governed stages. Discovery metadata does not prove live settlement.</p></main></body></html>");
  }

  if(!sessionAuthorizationMatches(sid,req)){
    return res.status(401).send(
      'Unauthorized MCP session'
    );
  }

  await t.handleRequest(req,res);
});

app.delete('/mcp',async(req,res)=>{
  const sid=req.headers['mcp-session-id'];
  const t=transports.get(sid);

  if(!t){
    return res.status(400).send(
      'Invalid or missing MCP session'
    );
  }

  if(!sessionAuthorizationMatches(sid,req)){
    return res.status(401).send(
      'Unauthorized MCP session'
    );
  }

  await t.handleRequest(req,res);
});

app.use((err,req,res,next)=>{
  if(res.headersSent) return next(err);
  const tooLarge=err?.type==='entity.too.large';
  res.status(tooLarge?413:500).json({error:tooLarge?'Request payload too large':'Internal server error'});
});


for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    try {
      ckSavePersistentFunnelNow();
      CK_FUNNEL_DB.close();
    } catch {}
    process.exit(0);
  });
}

export function createCrossingKeyApp() { return app; }

export async function startCrossingKeyServer({ host = '127.0.0.1', port = PORT, runRecovery = false } = {}) {
  if (runRecovery && machineCommerce) {
    await recoverInterruptedOperations({ dataFile: MACHINE_COMMERCE_FILE, finalizeLocalState: machineCommerce.finalizeRecoveredOperation, reconcileSettlement: async () => ({ outcome: 'unknown', reason: 'startup reconciliation requires capability-specific witness' }) });
  }
  return await new Promise(resolve => app.listen(port, host, () => resolve({ app, host, port })));
}

// Listener startup is owned by the explicit production entrypoint or test harness.
