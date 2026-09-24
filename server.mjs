import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import express from 'express';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CAPABILITIES as MACHINE_CAPABILITIES, RECEIVER as LOCKED_RECEIVER, createMachineCommerce } from './lib/machine-commerce.mjs';
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
import { DatabaseSync } from 'node:sqlite';

const HERE = process.cwd();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/,'');
const DELIVERY_ROOT = path.resolve(HERE, process.env.DELIVERY_ROOT || './delivery');
const STATE_FILE = path.join(HERE,'data','state.json');
const CATALOG_FILE = path.join(HERE,'data','stripe_catalog.json');
const CREDITS_FILE = path.join(HERE,'data','credit_links.json');
const FULFILL_FILE = path.join(HERE,'data','fulfillment_map.json');
const SERVICES_FILE = path.join(HERE,'data','request_services.json');

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
const DISCOVERY_PROFILE_VERSION = 'mcp-v3-2026-09-21';

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
  kennekarteSecret:KENNEKARTE_SECRET
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
const creditPacks = () => readJson(CREDITS_FILE).packs;
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
  currency:'USD',payment_rails:['stripe_payment_links','prepaid_request_credits','x402_base_usdc'],
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

    ['offer.list','Offer discovery','Searches public CrossingKey offers before payment.'],

    ['cost.estimate','Cost estimation','Returns known purchase price or credit cost without executing.'],

    ['result.preview','Result preview','Shows result shape without revealing paid output.'],

    ['requirement.check','Requirements check','Explains prerequisites before purchase or execution.'],

    ['execution.preflight','Execution preflight','Final no-charge decision point before payment/execution.'],

    ['credit.options','Request-credit purchase options','Returns prepaid request-credit packs.'],

    ['service.list','Approved request services','Lists explicitly approved request services.'],
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
async function resolveOfferFromSession(session){
  const c = catalog().offers;
  const direct = session.metadata?.offer_id;
  if (direct) {
    const found = c.find(x=>x.id===direct) || creditPacks().find(x=>x.id===direct);
    if(found) return found;
  }
  if(session.payment_link && stripe){
    const pl = await stripe.paymentLinks.retrieve(session.payment_link);
    const metaOffer = pl.metadata?.offer_id;
    if(metaOffer){
      const found = c.find(x=>x.id===metaOffer) || creditPacks().find(x=>x.id===metaOffer);
      if(found) return found;
    }
    const byUrl = c.find(x=>x.checkout_url===pl.url) || creditPacks().find(x=>x.checkout_url===pl.url);
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
    const pack=creditPacks().find(x=>x.id===offer.id);
    const token=requestToken(session.id);
    const tokenHash=sha256Text(token);
    s.credit_accounts[tokenHash]={
      session_id:session.id,email,balance:pack.credits,granted:pack.credits,
      offer_id:pack.id,created_at:new Date().toISOString()
    };
    result={...result,fulfillment:'credits',credits:pack.credits};
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
    version:"3.0.0",
    status: "operational",
    description:
      "CrossingKey MCP v3 marketplace and machine-commerce endpoint for discovery, qualification, buyer-authorized purchase, fulfillment, receipts, provider intake, and bounded paid capabilities.",
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
    human_site: "https://www.crossingkeyintelligence.com"
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
`);

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

  console.log(
    `[funnel] restored persistent counters updated=${CK_FUNNEL_PERSISTED.updated_at}`
  );
}



const CK_PAID_TOOL_NAMES = new Set([
  'x402.compatibility_audit',
  'mcp.schema_audit',
  'openapi.quality_audit',
  'machine_commerce.readiness_audit',
  'artifact.integrity_manifest'
]);

function ckCapability(name) {
  if (!CK_FUNNEL.capabilities[name]) {
    CK_FUNNEL.capabilities[name] = {
      requests: 0,
      challenges_402: 0,
      payment_returns: 0,
      fulfilled: 0,
      settlements: 0,
      atomic_usdc: 0
    };
  }
  return CK_FUNNEL.capabilities[name];
}

ckConsumeDurableRevenueEvents();

app.use((req,res,next)=>{
  CK_FUNNEL.requests++;

  res.once('finish', () => {
    ckSchedulePersistentFunnelSave();
  });

  const path = req.path || '';

  if (path === '/mcp') CK_FUNNEL.mcp_requests++;

  if (path.startsWith('/.well-known/')) {
    CK_FUNNEL.discovery_requests++;
  }

  const incoming =
    String(req.headers['x-request-id'] || '').trim();

  const cfRay =
    String(req.headers['cf-ray'] || '').trim();

  const correlationId =
    incoming ||
    cfRay ||
    crypto.randomUUID();

  req.ckCorrelationId = correlationId;
  res.setHeader('X-CrossingKey-Request-ID', correlationId);

  if (path === '/mcp' && req.method === 'POST') {
    const method = req.body?.method;

    if (method === 'initialize') CK_FUNNEL.mcp.initialize++;
    if (method === 'tools/list') CK_FUNNEL.mcp.tools_list++;

    if (method === 'tools/call') {
      CK_FUNNEL.mcp.tools_call++;

      const name = req.body?.params?.name;

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
    version: '3.0.0',

    description:
      'Machine-commerce MCP provider offering deterministic paid capabilities with buyer-authorized x402 settlement.',

    mcp: {
      endpoint: `${PUBLIC_BASE_URL}/mcp`,
      transport: 'streamable-http',
      protocolVersion: '2025-11-25',
      recommendedEntryTool: 'artifact.integrity_manifest'
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
    version:'3.0.0'
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
  version:'3.0.0',
  endpoint:`${PUBLIC_BASE_URL}/mcp`,
  transport:'streamable-http',
  protocolVersion:'2025-11-25',
  machineCommerce:true,
  categories:['Payments & Billing','Autonomous Agents'],
  discoveryProfile:`${DISCOVERY_PROFILE_VERSION}-marketplace`,
  walletMode:'receiver-only',
  paymentRails:['stripe_payment_links','prepaid_request_credits','x402_base_usdc'],
  recommendedEntryTool:'artifact.integrity_manifest',
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
    freeMcpTools:0,
    paidMcpTools:X402_CAPABILITIES.length,
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

  try{
    if(!machineCommerce) return res.status(503).json({error:'machine_commerce_not_configured'});
    const capabilityName=String(req.params.capability||'');
    if(!MACHINE_CAPABILITIES.some(x=>x.name===capabilityName)) return res.status(404).json({error:'unknown_capability'});
    const v1Header=req.headers['x-payment'];
    const v2Header=req.headers['payment-signature'];
    if(!v1Header&&!v2Header){
      const requested=String(req.query.x402Version||req.headers['x402-version']||'2');
      const version=requested==='1'?1:2;
      const challenge=machineCommerce.paymentRequired(capabilityName,version);
      for(const [name,value] of Object.entries(challenge.headers)) res.set(name,value);
      CK_FUNNEL.x402.challenges_402++; ckCap.challenges_402++; return res.status(402).json(challenge.body);
    }
    if(v1Header&&v2Header) return res.status(400).json({error:'ambiguous_payment_headers'});
    const input=req.body?.input;
    const idempotencyKey=String(req.body?.idempotency_key||req.headers['idempotency-key']||'');
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) return res.status(400).json({error:'bounded_idempotency_key_required'});
    const inputValidation=validatePaidCapabilityInput(capabilityName,input);
    if(!inputValidation.ok) return res.status(400).json({error:inputValidation.code});
    const paymentPayload=decodeBase64Json(v1Header||v2Header);
    const expectedVersion=v1Header?1:2;

    console.error(
      `[x402] paid_ingress capability=${capabilityName} version=${expectedVersion} idempotency=${idempotencyKey}`
    );

    if(paymentPayload.x402Version!==expectedVersion) return res.status(400).json({error:'payment_header_version_mismatch'});

    console.error(`[x402] invoke_start capability=${capabilityName}`);

    const result=await machineCommerce.invoke({
      capabilityName,
      input,
      idempotencyKey,
      paymentPayload
    });

    console.error(
      `[x402] invoke_ok capability=${capabilityName} purchase=${result.purchaseId||'duplicate'}`
    );

    ckConsumeDurableRevenueEvents();

    console.error(
      `[funnel] fulfilled capability=${capabilityName} request=${req.ckCorrelationId || 'unknown'}`

    );

    const settlementHeader=Buffer.from(JSON.stringify(result.settlement)).toString('base64');
    res.set(expectedVersion===1?'X-PAYMENT-RESPONSE':'PAYMENT-RESPONSE',settlementHeader);
    return res.json(result);
  }catch(err){
    const message=String(err?.message||'x402 execution failed');

    console.error(
      `[x402] route_error name=${String(err?.name||'Error')} message=${message.slice(0,240)}`
    );

    const client=/required|mismatch|unsupported|invalid|conflict|replay|disabled/i.test(message);
    return res.status(client?400:502).json({
      error:client?'invalid_payment_or_request':'settlement_or_execution_failed',
      message
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

function makeMcpServer(authContext=null,marketplaceContext=()=>null,rateKey='anonymous'){
  const s=new McpServer({name:'crossingkey-mcp',version:'3.0.0'});

  // CK_PAID_ONLY_SURFACE_V2
  // No free MCP utilities are registered.
  // Public discovery remains on /.well-known/* and /health.
  // Paid x402 products and prepaid xkey.validate remain available.

  // PAID X402 TOOL SURFACE
  // Generated from the canonical paid capability catalog.
  const paidX402Tools = X402_CAPABILITIES;

  for (const paid of paidX402Tools) {
    s.registerTool(
      paid.name,
      {
        title:paid.title,
        description:paid.description,
        inputSchema:paid.inputSchema,
        annotations:{
          readOnlyHint:false,
          destructiveHint:false,
          openWorldHint:true
        }
      },
      async(input)=>{
        if(!machineCommerce){
          return {
            isError:true,
            content:[{type:'text',text:'Machine commerce is not configured.'}]
          };
        }

        try{
          const challenge =
            machineCommerce.paymentRequired(paid.name,2);

          const decoded =
            JSON.parse(
              Buffer.from(
                challenge.headers['PAYMENT-REQUIRED'],
                'base64'
              ).toString('utf8')
            );

          return {
            structuredContent:{
              payment_required:true,
              execution_mode:'x402_http',
              capability:paid.name,
              input,
              price:decoded.accepts?.[0]?.amount || null,
              asset:decoded.accepts?.[0]?.asset || null,
              network:decoded.accepts?.[0]?.network || null,
              pay_to:decoded.accepts?.[0]?.payTo || null,
              execution_url:decoded.resource?.url || null,
              payment_required_header:
                challenge.headers['PAYMENT-REQUIRED'],
              instruction:
                'Obtain authorized x402 payment signing outside ordinary MCP computation, then POST the same input with a unique idempotency_key and PAYMENT-SIGNATURE to execution_url.'
            },
            content:[{
              type:'text',
              text:`Payment required for ${paid.name}. Exact x402 challenge and execution endpoint returned. No funds were spent by this MCP call.`
            }]
          };
        }catch(e){
          return {
            isError:true,
            content:[{
              type:'text',
              text:`Unable to create x402 purchase challenge: ${e.message}`
            }]
          };
        }
      }
    );
  }

  // CK_FREE_MCP_TOOLS_DISABLED_V1
  // Anonymous MCP exposes paid capabilities only.
  // Free discovery remains available over HTTP well-known surfaces.

  // PAID PREPAID-CREDIT TOOL
  // Visible in tools/list, but execution requires an authenticated ck_ principal.
  s.registerTool('xkey.validate',{
    title:'Validate structured XKEY intake',
    description:'PAID prepaid-credit XKEY intake validation. Requires an authenticated ck_ principal and commits one credit only on verified success. Discovery is free; execution is not.',
    inputSchema:PREPAID_CAPABILITIES[0].inputSchema,
    annotations:{
      readOnlyHint:false,
      destructiveHint:false,
      openWorldHint:false
    }
  },async({idempotency_key,raw_intake})=>{
    if(!authContext){
      return {
        isError:true,
        structuredContent:{error:'authentication_required'},
        content:[{
          type:'text',
          text:'Authenticate the MCP session with a valid Bearer ck_ credential.'
        }]
      };
    }

    const acct=currentCreditAccount(authContext.principal_id);

    if(!acct){
      return {
        isError:true,
        structuredContent:{error:'credential_revoked'},
        content:[{
          type:'text',
          text:'Credit credential is no longer valid.'
        }]
      };
    }

    const result=runXkeyBridge({
      action:'validate',
      principal_id:authContext.principal_id,
      session_id:acct.session_id,
      granted:Number(acct.granted||0),
      idempotency_key,
      raw_intake,
      max_input_chars:XKEY_MAX_INPUT_CHARS
    });

    if(!result.ok){
      return {
        isError:true,
        structuredContent:{
          error:result.error || 'paid_execution_failed'
        },
        content:[{
          type:'text',
          text:result.message || 'Paid execution failed safely.'
        }]
      };
    }

    const payload={
      capability:'xkey.validate',
      state:result.state,
      success:result.success,
      credits_charged:result.credits,
      balance:result.balance,
      reservation_id:result.reservation_id,
      receipt_id:result.receipt_id,
      request_hash:result.request_hash,
      normalized:result.normalized || null
    };

    return {
      isError:!result.success,
      structuredContent:payload,
      content:[{
        type:'text',
        text:result.success
          ? `Validated successfully. 1 credit committed. Balance: ${result.balance}. Receipt: ${result.receipt_id}.`
          : `Validation failed safely. No credit committed. Balance: ${result.balance}. Receipt: ${result.receipt_id}.`
      }]
    };
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

app.listen(PORT,'127.0.0.1',()=>console.log(`CrossingKey MCP v3.0.0: ${PUBLIC_BASE_URL}/mcp`));
