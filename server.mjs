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
  id:'xkey.validate_intake',tool:'xkey_validate_intake',name:'xkey Intake Validation',
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
    ['discover_provider','Provider discovery','Returns provider identity, commerce policy, payment rails, and discovery sequence.'],
    ['list_capabilities','Capability catalog','Lists free and paid machine capabilities with access and charging metadata.'],
    ['list_offers','Offer discovery','Searches public CrossingKey offers before payment.'],
    ['get_offer','Offer detail','Returns one public offer descriptor with price, fulfillment state, requirements, and next action.'],
    ['estimate_cost','Cost estimation','Returns known purchase price or credit cost without executing.'],
    ['preview_result_schema','Result preview','Shows result shape without revealing paid output.'],
    ['check_requirements','Requirements check','Explains prerequisites before purchase or execution.'],
    ['execution_preflight','Execution preflight','Final no-charge decision point before payment/execution.'],
    ['list_stripe_offers','Legacy Stripe offer list','Lists current Stripe offers.'],
    ['get_stripe_checkout_link','Legacy checkout lookup','Returns exact known checkout URL.'],
    ['get_request_credit_links','Request-credit purchase options','Returns prepaid request-credit packs.'],
    ['get_fulfillment_status','Fulfillment readiness','Checks verified delivery binding.'],
    ['list_request_services','Approved request services','Lists explicitly approved request services.']
  ].map(([tool,name,summary])=>({id:`tool.${tool}`,tool,name,summary,access:'free',price:{amount_usd:0}}));
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
    version: "2.2.0",
    status: "operational",
    description:
      "Public MCP endpoint for agent commerce, digital products, prepaid execution credits, fulfillment, and bounded paid capabilities.",
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

app.get('/health',(_req,res)=>res.json({
  ok:true,service:'crossingkey-mcp',version:'2.2.0',
  stripe_configured:Boolean(stripe),webhook_configured:Boolean(STRIPE_WEBHOOK_SECRET),
  claim_secret_configured:Boolean(CLAIM_SECRET),
  machine_commerce_configured:Boolean(machineCommerce),
  machine_commerce:machineCommerce?machineCommerce.status():{walletMode:'receiver-only',receiver:CK_RECEIVER_ADDRESS,mainnetEnabled:false,aiRequired:false,x402Versions:[1,2]}
}));

app.get('/.well-known/x402',(_req,res)=>res.json({
  x402Version:2,
  ingress:[{version:1,requestHeader:'X-PAYMENT',responseHeader:'X-PAYMENT-RESPONSE'},{version:2,requestHeader:'PAYMENT-SIGNATURE',challengeHeader:'PAYMENT-REQUIRED',responseHeader:'PAYMENT-RESPONSE'}],
  networks:['eip155:84532'],
  mainnetEnabled:CK_ENABLE_MAINNET,
  receiver:CK_RECEIVER_ADDRESS,
  walletMode:'receiver-only',
  capabilities:MACHINE_CAPABILITIES.map(({name,priceUsd})=>({name,priceUsd}))
}));

app.get('/.well-known/mcp.json',(_req,res)=>res.json({name:'CrossingKey MCP',version:'2.2.0',endpoint:`${PUBLIC_BASE_URL}/mcp`,transport:'streamable-http',machineCommerce:true}));

app.get('/api/machine-commerce/status',(_req,res)=>res.json(machineCommerce?machineCommerce.status():{configured:false,receiver:CK_RECEIVER_ADDRESS,mainnetEnabled:false}));

app.post('/api/x402/:capability',async(req,res)=>{
  try{
    if(!machineCommerce) return res.status(503).json({error:'machine_commerce_not_configured'});
    const capabilityName=String(req.params.capability||'');
    if(!MACHINE_CAPABILITIES.some(x=>x.name===capabilityName)) return res.status(404).json({error:'unknown_capability'});
    const input=req.body?.input;
    const idempotencyKey=String(req.body?.idempotency_key||req.headers['idempotency-key']||'');
    if(!input||typeof input!=='object'||Array.isArray(input)) return res.status(400).json({error:'input_object_required'});
    if(!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) return res.status(400).json({error:'bounded_idempotency_key_required'});
    const v1Header=req.headers['x-payment'];
    const v2Header=req.headers['payment-signature'];
    if(!v1Header&&!v2Header){
      const requested=String(req.query.x402Version||req.headers['x402-version']||'2');
      const version=requested==='1'?1:2;
      const challenge=machineCommerce.paymentRequired(capabilityName,version);
      for(const [name,value] of Object.entries(challenge.headers)) res.set(name,value);
      return res.status(402).json(challenge.body);
    }
    if(v1Header&&v2Header) return res.status(400).json({error:'ambiguous_payment_headers'});
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

function makeMcpServer(authContext=null){
  const s=new McpServer({name:'crossingkey-mcp',version:'2.2.0'});

  s.registerTool('discover_provider',{title:'Discover CrossingKey Intelligence',description:'FREE DISCOVERY. Returns provider identity, commerce model, payment rails, policy, and next actions before payment.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>{
    const data={...PROVIDER_PROFILE,agent_commerce_version:AGENT_COMMERCE_VERSION,authority_boundary:{money:'human_or_predelegated_authority',identity:'external_authority',credentials:'external_authority',payment_execution:'outside_ordinary_mcp_computation',raw_payment_credentials_accepted:false,agent_may_discover:true,agent_may_evaluate:true,agent_may_estimate:true,agent_may_prepare:true,agent_may_spend_without_authority:false},counts:{offers:catalog().offers.length,request_credit_packs:creditPacks().length,request_services:requestServices().length,capabilities:publicCapabilityList().length},recommended_sequence:['discover_provider','list_capabilities','list_offers','get_offer','check_requirements','estimate_cost','preview_result_schema','execution_preflight','get_stripe_checkout_link']};
    return {structuredContent:data,content:[{type:'text',text:'CrossingKey Intelligence machine-commerce provider discovered. Metadata is free before payment.'}]};
  });
  s.registerTool('list_capabilities',{title:'List machine capabilities',description:'FREE DISCOVERY. Lists free and paid capabilities with access and charging metadata.',inputSchema:{access:z.enum(['all','free','paid']).optional()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({access='all'}={})=>{
    const all=publicCapabilityList(); const items=access==='all'?all:all.filter(x=>access==='free'?x.access==='free':x.access!=='free');
    return {structuredContent:{items,count:items.length},content:[{type:'text',text:`${items.length} capabilities visible. No payment consumed.`}]};
  });
  s.registerTool('list_offers',{title:'Discover CrossingKey offers',description:'FREE DISCOVERY. Searches public offer metadata before payment.',inputSchema:{query:z.string().min(1).max(160).optional(),kind:z.enum(['all','digital','service']).optional(),max_price_usd:z.number().nonnegative().max(1000000).optional()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({query,kind='all',max_price_usd}={})=>{
    let items=catalog().offers.map(offerDescriptor); if(kind!=='all') items=items.filter(x=>x.kind===kind); if(max_price_usd!==undefined) items=items.filter(x=>x.price.amount_usd<=max_price_usd); if(query) items=items.filter(x=>matchesQuery(x,query));
    return {structuredContent:{items,count:items.length,query:query||null},content:[{type:'text',text:`${items.length} matching offers found. Discovery is free.`}]};
  });
  s.registerTool('get_offer',{title:'Get offer details',description:'FREE QUALIFICATION. Returns enough information to evaluate one offer before paying.',inputSchema:{id:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const found=findPublicItem(id); if(!found)return {isError:true,content:[{type:'text',text:'Unknown CrossingKey offer or capability.'}]}; return {structuredContent:{type:found.type,item:found.value},content:[{type:'text',text:`Pre-payment metadata loaded for ${found.value.name}.`}]};});
  s.registerTool('estimate_cost',{title:'Estimate exact known cost',description:'FREE QUALIFICATION. Returns advertised USD price or request-credit cost without charging.',inputSchema:{id:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const found=findPublicItem(id); if(!found)return {isError:true,content:[{type:'text',text:'Unknown CrossingKey offer or capability.'}]}; return {structuredContent:{id,cost:found.value.price,estimated:false,creates_payment:false,consumes_credit:false},content:[{type:'text',text:'Known advertised cost returned. No payment or credit consumed.'}]};});
  s.registerTool('preview_result_schema',{title:'Preview result or fulfillment schema',description:'FREE QUALIFICATION. Shows expected result shape without revealing paid content.',inputSchema:{id:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const found=findPublicItem(id); if(!found)return {isError:true,content:[{type:'text',text:'Unknown CrossingKey offer or capability.'}]}; const preview=found.type==='capability'?{id,output_schema:found.value.output_preview,paid_output_included:false}:{id,kind:found.value.kind,fulfillment:found.value.fulfillment,delivery_ready:found.value.delivery_ready,paid_output_included:false,expected_result:found.value.kind==='digital'?{type:'digital_entitlement',fields:['offer_id','download_authorization_or_delivery_state']}:{type:'service_order',fields:['offer_id','order_state','session_reference']}}; return {structuredContent:preview,content:[{type:'text',text:'Result shape previewed. Paid content not disclosed.'}]};});
  s.registerTool('check_requirements',{title:'Check purchase or execution requirements',description:'FREE QUALIFICATION. Explains payment, authorization, fulfillment, and idempotency prerequisites.',inputSchema:{id:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const found=findPublicItem(id); if(!found)return {isError:true,content:[{type:'text',text:'Unknown CrossingKey offer or capability.'}]}; const requirements=found.type==='offer'?found.value.requirements:['A valid prepaid request-credit principal is required.',`${found.value.price.credits} request credit is required for verified success.`,'A unique idempotency key is required.','Do not invoke speculatively; inspect metadata first.',found.value.failure_policy]; return {structuredContent:{id,requirements,ready_for_evaluation:true},content:[{type:'text',text:'Requirements returned. No paid action taken.'}]};});
  s.registerTool('execution_preflight',{title:'Preflight an agent purchase or execution',description:'FREE QUALIFICATION. Final machine-readable no-charge decision point before payment or credit-consuming execution.',inputSchema:{id:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>{const found=findPublicItem(id); if(!found)return {isError:true,content:[{type:'text',text:'Unknown CrossingKey offer or capability.'}]}; let decision; if(found.type==='offer'){const x=found.value; decision={id,can_execute_now:false,can_purchase_now:!(x.kind==='digital'&&!x.delivery_ready),payment_required:true,payment_method:'stripe_payment_link',checkout_url:x.checkout_url,price:x.price,warning:x.kind==='digital'&&!x.delivery_ready?'Immediate digital fulfillment is not verified. Autonomous purchase is not recommended yet.':null,next_action:x.kind==='digital'&&!x.delivery_ready?'wait_or_choose_another_offer':'obtain_payment_authorization_then_open_checkout'};}else if(found.value?.charging_model==='x402_exact'){
  decision={
    id,
    can_execute_now:false,
    can_purchase_now:true,
    payment_required:true,
    payment_method:'x402',
    price:found.value.price,
    scheme:'exact',
    network:CK_ENABLE_MAINNET?'eip155:8453':'eip155:84532',
    asset:'USDC',
    receiver:CK_RECEIVER_ADDRESS,
    x402_versions:[1,2],
    quote_tool:'capability.quote',
    speculative_call_safe:false,
    idempotency_required:true,
    next_action:'request_x402_quote_then_obtain_payment_authorization'
  };
}else{
  decision={
    id,
    can_execute_now:'depends_on_credit_balance',
    payment_required:true,
    payment_method:'prepaid_request_credit',
    price:found.value.price,
    speculative_call_safe:false,
    idempotency_required:true,
    next_action:'ensure_credit_balance_and_authorization_then_call_paid_tool'
  };
} return {structuredContent:decision,content:[{type:'text',text:'Preflight complete. No payment or paid execution occurred.'}]};});

  s.registerTool('list_stripe_offers',{
    title:'List CrossingKey Stripe offers',
    description:'Lists the known CrossingKey Stripe Payment Links. Digital offers report whether the exact fulfillment file has been verified on this server.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },async()=>{
    const items=catalog().offers.map(publicOffer);
    return {structuredContent:{items},content:[{type:'text',text:`${items.length} Stripe offers loaded.`}]};
  });

  s.registerTool('get_stripe_checkout_link',{
    title:'Get Stripe checkout link',
    description:'Returns the exact Stripe Payment Link for a known CrossingKey offer. Never invents a checkout URL.',
    inputSchema:{id:z.string().min(1).max(160)},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },async({id})=>{
    const x=catalog().offers.find(v=>v.id===id);
    if(!x) return {isError:true,content:[{type:'text',text:'Unknown Stripe offer.'}]};
    return {structuredContent:publicOffer(x),content:[{type:'text',text:`${x.name}: ${x.checkout_url}`}]};
  });

  s.registerTool('get_request_credit_links',{
    title:'Get request-credit payment links',
    description:'Returns the live Stripe Payment Links for prepaid CrossingKey request credits.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },async()=>{
    const packs=creditPacks();
    return {structuredContent:{packs},content:[{type:'text',text:`${packs.length} prepaid credit packs are live in Stripe.`}]};
  });

  s.registerTool('get_fulfillment_status',{
    title:'Check fulfillment readiness',
    description:'Checks whether a Stripe offer has a verified delivery file bound to this server.',
    inputSchema:{id:z.string().min(1).max(160)},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },async({id})=>{
    const x=catalog().offers.find(v=>v.id===id);
    if(!x) return {isError:true,content:[{type:'text',text:'Unknown offer.'}]};
    const m=fulfillment()[id]||null;
    const ready=x.kind==='digital' && isDeliveryReady(id);
    return {structuredContent:{id,kind:x.kind,ready,mapping:m?{sha256:m.sha256,max_downloads:m.max_downloads||5}:null},content:[{type:'text',text:ready?'Fulfillment is ready.':'Fulfillment is not yet verified on this server.'}]};
  });

  s.registerTool('list_request_services',{
    title:'List paid request services',
    description:'Lists request services approved after the safe-file scan. Empty until services are explicitly approved.',
    inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}
  },async()=>{
    const services=requestServices();
    return {structuredContent:{services},content:[{type:'text',text:services.length?`${services.length} request services available.`:'No request services have been approved yet.'}]};
  });

  const freeResult=(data,text)=>({structuredContent:data,content:[{type:'text',text}]});
  s.registerTool('crossingkey.describe',{description:'FREE. Describes the receiver-only CrossingKey machine-commerce service and its safety boundaries.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>freeResult({provider:PROVIDER_PROFILE,wallet_mode:'receiver-only',receiver:CK_RECEIVER_ADDRESS,mainnet_enabled:CK_ENABLE_MAINNET,ai_required:false,x402_versions:[1,2]},'CrossingKey machine-commerce metadata returned. No payment consumed.'));
  s.registerTool('capabilities.list',{description:'FREE. Lists deterministic paid machine-commerce capabilities without executing them.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>freeResult({items:MACHINE_CAPABILITIES,count:MACHINE_CAPABILITIES.length},`${MACHINE_CAPABILITIES.length} deterministic capabilities listed. No payment consumed.`));
  s.registerTool('capability.get',{description:'FREE. Returns one deterministic capability definition and exact advertised price.',inputSchema:{name:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({name})=>{const item=MACHINE_CAPABILITIES.find(x=>x.name===name); return item?freeResult({item},'Capability metadata returned. No payment consumed.'):{isError:true,content:[{type:'text',text:'Unknown capability.'}]};});
  s.registerTool('capability.quote',{description:'FREE. Returns x402 v1 and v2 challenge requirements for one capability without executing or settling payment.',inputSchema:{name:z.string().min(1).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({name})=>{if(!machineCommerce)return {isError:true,content:[{type:'text',text:'Machine commerce is not configured.'}]}; try{return freeResult({v1:machineCommerce.paymentRequired(name,1).body,v2:JSON.parse(Buffer.from(machineCommerce.paymentRequired(name,2).headers['PAYMENT-REQUIRED'],'base64').toString('utf8'))},'Bilingual x402 quote returned. No payment consumed.');}catch{return {isError:true,content:[{type:'text',text:'Unknown capability.'}]};}});
  s.registerTool('payment.methods',{description:'FREE. Lists supported payment methods and explicitly reports the receiver-only wallet boundary.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>freeResult({methods:[{rail:'stripe_payment_links',mode:'existing'},{rail:'prepaid_request_credits',mode:'existing'},{rail:'x402',versions:[1,2],network:CK_ENABLE_MAINNET?'eip155:8453':'eip155:84532',asset:'USDC',receiver:CK_RECEIVER_ADDRESS}],wallet_authority:{receive:true,sign:false,send:false,swap:false,bridge:false,agent_spend:false}},'Payment methods returned. No payment consumed.'));
  s.registerTool('purchase.status',{description:'FREE STATUS. Returns the state of a machine-commerce purchase by its idempotency key without revealing paid result content.',inputSchema:{idempotency_key:z.string().min(8).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({idempotency_key})=>{const p=machineCommerce?.getPurchase(idempotency_key); return freeResult(p?{found:true,status:p.response.status,purchaseId:p.response.purchaseId,entitlementId:p.response.entitlementId,resultHash:p.response.receipt.resultHash}:{found:false},p?'Purchase status returned.':'Purchase not found.');});
  s.registerTool('entitlement.inspect',{description:'FREE STATUS. Inspects entitlement state by identifier without granting execution or result access.',inputSchema:{id:z.string().min(1).max(200)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({id})=>freeResult({entitlement:machineCommerce?.inspectEntitlement(id)||null},'Entitlement status returned.'));
  s.registerTool('fulfillment.status',{description:'FREE STATUS. Returns fulfillment state and result hash by purchase idempotency key.',inputSchema:{idempotency_key:z.string().min(8).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({idempotency_key})=>{const p=machineCommerce?.getPurchase(idempotency_key); return freeResult(p?{found:true,status:p.response.status,resultHash:p.response.receipt.resultHash}:{found:false},'Fulfillment status returned.');});
  s.registerTool('fulfillment.get',{description:'FREE STATUS. Returns fulfillment identifiers and integrity binding but does not disclose paid result content.',inputSchema:{idempotency_key:z.string().min(8).max(160)},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({idempotency_key})=>{const p=machineCommerce?.getPurchase(idempotency_key); return freeResult(p?{found:true,purchaseId:p.response.purchaseId,entitlementId:p.response.entitlementId,resultHash:p.response.receipt.resultHash,receiptId:p.response.receipt.id}:{found:false},'Fulfillment binding returned.');});
  s.registerTool('receipt.verify',{description:'FREE. Recomputes the deterministic result hash embedded in a CrossingKey receipt.',inputSchema:{receipt:z.record(z.unknown())},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async({receipt})=>freeResult({valid:Boolean(machineCommerce?.verifyReceipt(receipt)),receiptId:receipt?.id||null},'Receipt integrity checked.'));
  s.registerTool('health',{description:'FREE. Returns local service readiness flags and the mainnet safety-gate state.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async()=>freeResult({ok:true,stripeConfigured:Boolean(stripe),machineCommerceConfigured:Boolean(machineCommerce),mainnetEnabled:CK_ENABLE_MAINNET,walletMode:'receiver-only'},'Health status returned.'));

  s.registerTool('xkey_validate_intake',{
    title:'Validate structured XKEY intake',
    description:'Paid bounded intake validation. Costs 1 prepaid credit on verified success. Safe validation failures release the reserved credit.',
    inputSchema:{
      idempotency_key:z.string().min(8).max(160),
      raw_intake:z.string().min(2).max(XKEY_MAX_INPUT_CHARS)
    },
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
        content:[{type:'text',text:'Authenticate the MCP session with a valid Bearer ck_ credential.'}]
      };
    }

    const acct=currentCreditAccount(authContext.principal_id);

    if(!acct){
      return {
        isError:true,
        structuredContent:{error:'credential_revoked'},
        content:[{type:'text',text:'Credit credential is no longer valid.'}]
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
      capability:'xkey.validate_intake',
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

function sessionAuthorizationMatches(sid,req){
  if(!sessionPrincipals.has(sid)) return false;

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

      await makeMcpServer(authContext).connect(t);
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

app.listen(PORT,'0.0.0.0',()=>console.log(`CrossingKey MCP v2: ${PUBLIC_BASE_URL}/mcp`));
