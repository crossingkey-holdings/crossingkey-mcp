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
      env:{...process.env,PYTHONUNBUFFERED:'1'}
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
  const s=state();
  if(s.processed_sessions[session.id]) return s.processed_sessions[session.id];

  const offer=await resolveOfferFromSession(session);
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

app.post('/stripe/webhook', express.raw({type:'application/json'}), async (req,res)=>{
  try{
    if(!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook not configured');
    const sig=req.headers['stripe-signature'];
    const event=stripe.webhooks.constructEvent(req.body,sig,STRIPE_WEBHOOK_SECRET);
    if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded'){
      await processPaidSession(event.data.object);
    }
    res.json({received:true});
  }catch(err){
    console.error('stripe webhook error',err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});

app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));

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
  ok:true,service:'crossingkey-revenue-mcp',version:'2.1.0',
  stripe_configured:Boolean(stripe),webhook_configured:Boolean(STRIPE_WEBHOOK_SECRET),
  claim_secret_configured:Boolean(CLAIM_SECRET)
}));

app.get('/claim',async(req,res)=>{
  try{
    if(!stripe) return res.status(503).send('Stripe is not configured');
    const sessionId=String(req.query.session_id||'');
    if(!sessionId.startsWith('cs_')) return res.status(400).send('Invalid Checkout Session');
    const session=await stripe.checkout.sessions.retrieve(sessionId);
    const result=await processPaidSession(session);
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
  const s=new McpServer({name:'crossingkey-revenue',version:'2.1.0'});

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
    return {structuredContent:{id,kind:x.kind,ready,mapping:m},content:[{type:'text',text:ready?'Fulfillment is ready.':'Fulfillment is not yet verified on this server.'}]};
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

app.listen(PORT,'0.0.0.0',()=>console.log(`CrossingKey Revenue MCP v2: ${PUBLIC_BASE_URL}/mcp`));
