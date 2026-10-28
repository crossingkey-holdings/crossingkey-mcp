import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Synthetic contract tests, NOT the deployed Supabase RPC or real Stripe deliveries.
const plan={link:'plink_fixture',amount:500,currency:'usd',fulfillment:'credits_100'};
const fixture=(id='evt_fixture',checkoutId='cs_fixture')=>({id,livemode:true,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:checkoutId,payment_status:'paid',payment_link:plan.link,amount_total:plan.amount,currency:plan.currency}}});
const signingSecret='test-only-not-production';
const sign=(body,t)=>'t='+t+',v1='+crypto.createHmac('sha256',signingSecret).update(t+'.'+body).digest('hex');
function signatureValid(raw,header,now){
  const h=Object.fromEntries(header.split(',').map(x=>x.trim().split('=')));
  if(!/^\d+$/.test(h.t||'') || Math.abs(now-Number(h.t))>300 || !/^[a-f\d]{64}$/i.test(h.v1||''))return false;
  const expected=crypto.createHmac('sha256',signingSecret).update(h.t+'.'+raw).digest();
  return crypto.timingSafeEqual(expected,Buffer.from(h.v1,'hex'));
}
function valid(e){
  const x=e?.data?.object;
  return e?.livemode===true && ['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(e.type)
    && x?.object==='checkout.session' && x.payment_status==='paid' && x.payment_link===plan.link
    && x.amount_total===plan.amount && x.currency===plan.currency && typeof x.id==='string' && x.id.length>0;
}
class MockLedger{
 constructor(){this.events=new Set();this.entitlements=new Map();this.receipts=[];}
 async accept(e){
  // Models atomic serial transactions and a unique checkout constraint.
  if(!valid(e))return {accepted:false};
  if(this.events.has(e.id))return {duplicate:true};
  const x=e.data.object.id;
  if(this.entitlements.has(x)){this.events.add(e.id);return {duplicate:true};}
  this.events.add(e.id);this.entitlements.set(x,e.id);this.receipts.push({event:e.id,checkout:x});return {accepted:true};
 }
}
const now=1793160000;
test('good HMAC',()=>{const body=JSON.stringify(fixture());assert.equal(signatureValid(body,sign(body,now),now),true);});
test('tampered body rejected',()=>{const body=JSON.stringify(fixture());assert.equal(signatureValid(body+' ',sign(body,now),now),false);});
test('expired HMAC rejected',()=>{const body=JSON.stringify(fixture());assert.equal(signatureValid(body,sign(body,now-301),now),false);});
test('malformed HMAC rejected',()=>assert.equal(signatureValid('{}','t=100,v1=bad',now),false));
for(const [name,change] of [
 ['sandbox',e=>e.livemode=false],
 ['unpaid',e=>e.data.object.payment_status='unpaid'],
 ['wrong amount',e=>e.data.object.amount_total=1],
 ['wrong currency',e=>e.data.object.currency='usdc'],
 ['wrong payment link',e=>e.data.object.payment_link='plink_other'],
 ['wrong event type',e=>e.type='payment_intent.succeeded'],
 ['missing checkout',e=>delete e.data.object.id]
])test('reject '+name,async()=>{const ledger=new MockLedger();const e=fixture();change(e);assert.equal((await ledger.accept(e)).accepted,false);assert.equal(ledger.entitlements.size,0);});
test('same event replay grants once',async()=>{const ledger=new MockLedger();await ledger.accept(fixture());assert.equal((await ledger.accept(fixture())).duplicate,true);assert.equal(ledger.entitlements.size,1);assert.equal(ledger.receipts.length,1);});
test('distinct events for same checkout grant once',async()=>{const ledger=new MockLedger();await ledger.accept(fixture());assert.equal((await ledger.accept(fixture('evt_two'))).duplicate,true);assert.equal(ledger.entitlements.size,1);assert.equal(ledger.receipts.length,1);});
test('distinct paid checkouts can each grant',async()=>{const ledger=new MockLedger();await ledger.accept(fixture());await ledger.accept(fixture('evt_two','cs_two'));assert.equal(ledger.entitlements.size,2);});
test('50 simulated concurrent deliveries grant once',async()=>{const ledger=new MockLedger();await Promise.all(Array.from({length:50},()=>ledger.accept(fixture())));assert.equal(ledger.entitlements.size,1);assert.equal(ledger.receipts.length,1);});
