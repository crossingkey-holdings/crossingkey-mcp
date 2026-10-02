// Group H — agent comprehension test.
// Boots a fresh server and walks it the way a new agent would: instructions,
// tools/list intelligibility, the full free discovery sequence, public
// resources, per-capability instructions, and a paid x402 challenge. Prints a
// PASS/FAIL summary. Exits non-zero on failure.
// Usage: node scripts/agent-comprehension-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const results=[];
function check(name,ok,detail=''){
  results.push({name,ok,detail});
  console.log(`${ok?'PASS':'FAIL'}  ${name}${detail?` — ${detail}`:''}`);
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-agent-comprehension-'));
fs.mkdirSync(path.join(dir,'data'));
const D=f=>path.join(dir,'data',f);
const files={catalog:D('stripe_catalog.json'),credits:D('credit_links.json'),fulfillment:D('fulfillment_map.json'),services:D('request_services.json'),state:D('state.json'),commerce:D('commerce.json'),marketplace:D('marketplace.json'),funnel:D('funnel.sqlite3')};
fs.writeFileSync(files.catalog,JSON.stringify({offers:[{id:'comp-offer',name:'Comprehension Offer',kind:'service',description:'Agent comprehension fixture offer',price_usd:25,checkout_url:'https://checkout.example/comp'}]}));
fs.writeFileSync(files.credits,JSON.stringify({packs:[]}));
fs.writeFileSync(files.fulfillment,JSON.stringify({products:{}}));
fs.writeFileSync(files.services,JSON.stringify({services:[]}));
fs.writeFileSync(files.state,JSON.stringify({credit_accounts:{},processed_sessions:{},service_orders:{}}));
fs.writeFileSync(files.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));

const port=await new Promise(resolve=>{const s=http.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const child=spawn(process.execPath,[path.join(ROOT,'server.mjs')],{cwd:dir,env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MACHINE_COMMERCE_FILE:files.commerce,MARKETPLACE_FILE:files.marketplace,CK_FUNNEL_DB:files.funnel,CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),CLAIM_SECRET:'local-only-test-secret'.repeat(4),STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
async function cleanup(){if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});}
process.on('exit',()=>{try{if(child.exitCode===null)child.kill();}catch{}});

let ready=false;
for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}
check('server boots for a fresh agent',ready);
if(!ready){await cleanup();process.exit(1);}

let session,id=0;
async function rpc(method,params={}){
  const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};
  if(session)headers['mcp-session-id']=session;
  const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});
  if(response.status!==200)return {httpStatus:response.status};
  session=response.headers.get('mcp-session-id')||session;
  const text=await response.text();
  const data=text.split('\n').find(l=>l.startsWith('data:'))?.slice(5);
  return JSON.parse(data||text);
}
async function call(name,args={}){
  const r=await rpc('tools/call',{name,arguments:args});
  return r.result;
}

const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'comprehension',version:'1'}});
await rpc('notifications/initialized');
const instructions=init.result?.instructions||'';
check('server advertises instructions',instructions.length>100,`${instructions.length} chars`);
check('instructions state the stop-before-payment rule',/HUMAN AUTHORIZATION|stop/i.test(instructions),instructions.slice(0,80));

const tools=(await rpc('tools/list')).result?.tools||[];
check('tools/list is non-empty',tools.length>0,`${tools.length} tools`);
const undescribed=tools.filter(t=>!t.description||t.description.length<20);
check('every tool has a useful description',undescribed.length===0,undescribed.map(t=>t.name).join(','));
const noOutputSchema=tools.filter(t=>!t.outputSchema);
check('every tool exposes an outputSchema',noOutputSchema.length===0,noOutputSchema.map(t=>t.name).join(','));
const names=tools.map(t=>t.name);
check('canonical discovery names are advertised', ['provider.describe','offers.list','requirements.check','cost.estimate','result.preview','execution.preflight','credits.options'].every(n=>names.includes(n)));
check('phantom names are not advertised', !['offer.list','requirement.check','credit.options','service.list'].some(n=>names.includes(n)));
check('paid tools are marked as challenges', names.some(n=>n.startsWith('x402.')));

const seq=[
  ['provider.describe',{}],
  ['offers.list',{}],
  ['requirements.check',{item_id:'comp-offer'}],
  ['cost.estimate',{item_id:'comp-offer'}],
  ['result.preview',{item_id:'comp-offer'}],
  ['execution.preflight',{item_id:'comp-offer'}]
];
let seqOk=true,seqDetail='';
for(const [name,args] of seq){
  const r=await call(name,args);
  if(!r||r.isError||!r.structuredContent){seqOk=false;seqDetail=`${name} failed`;break;}
}
check('free discovery sequence completes with structured output',seqOk,seqDetail);
const preview=await call('result.preview',{item_id:'comp-offer'});
const previewText=JSON.stringify(preview.structuredContent);
check('result.preview reveals shape only, no secret material',/shape/i.test(previewText)&&!/secret|api[_-]?key|token/i.test(previewText));

const resources=(await rpc('resources/list')).result?.resources||[];
const ruris=resources.map(r=>r.uri);
check('discovery guide resource is listed',ruris.includes('crossingkey://discovery-guide'));
check('commerce policy resource is listed',ruris.includes('crossingkey://commerce-policy'));
const guide=(await rpc('resources/read',{uri:'crossingkey://discovery-guide'})).result?.contents?.[0]?.text||'';
check('discovery guide is readable and names the sequence',guide.includes('offers.list')&&guide.includes('execution.preflight'));
const capInstr=(await rpc('resources/read',{uri:'crossingkey://capability/x402.compatibility_audit'})).result?.contents?.[0]?.text||'';
check('per-capability instructions exist for a paid capability',capInstr.includes('HUMAN AUTHORIZATION')&&capInstr.includes('idempotency_key'));

const challenge=await call('x402.compatibility_audit',{url:'https://example.com/pay'});
check('paid tool returns a challenge, not execution',challenge?.structuredContent?.payment_required===true);
check('challenge states settlement expectations',typeof challenge?.structuredContent?.settlement_expectations==='string'&&challenge.structuredContent.settlement_expectations.includes('facilitator'));
check('challenge states confirmation expectations',typeof challenge?.structuredContent?.confirmation_expectations==='string'&&challenge.structuredContent.confirmation_expectations.includes('idempotency_key'));

const bad=await call('idempotency.inspect',{idempotencyKey:'bad!'});
check('malformed input is rejected without a stack trace',bad?.isError===true&&!/node:internal|\n\s*at\s/.test(JSON.stringify(bad)));

const failed=results.filter(r=>!r.ok);
console.log(`\n${results.length-failed.length}/${results.length} comprehension checks passed.`);
await cleanup();
process.exit(failed.length?1:0);
