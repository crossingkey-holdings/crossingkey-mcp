import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyStripe,classifyStripeEvent} from '../stripe-event-policy.mjs';
const t=1793160000, secret='only-a-fixture-secret', enc=new TextEncoder();
const digest=async(raw,ts=t)=> {
 const k=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Buffer.from(await crypto.subtle.sign('HMAC',k,enc.encode(ts+'.'+raw))).toString('hex');
};
const fixture=()=>({id:'evt_abc',livemode:true,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_abc',payment_status:'paid',payment_link:'plink_test',payment_intent:'pi_test',amount_total:500,currency:'usd'}}});
test('valid Stripe HMAC signature verifies',async()=>{
 const raw=JSON.stringify(fixture());
 assert.equal(await verifyStripe(raw,'t='+t+',v1='+await digest(raw),secret,t),true);
});
test('valid second v1 signature handles key rotation',async()=>{
 const raw=JSON.stringify(fixture());
 assert.equal(await verifyStripe(raw,'t='+t+',v1='+('0'.repeat(64))+',v1='+await digest(raw),secret,t),true);
});
test('tampering, wrong secret, invalid header, and stale timestamp fail',async()=>{
 const raw=JSON.stringify(fixture()),header='t='+t+',v1='+await digest(raw);
 assert.equal(await verifyStripe(raw+' ',header,secret,t),false);
 assert.equal(await verifyStripe(raw,header,'wrong-secret',t),false);
 assert.equal(await verifyStripe(raw,'t=bad,v1='+await digest(raw),secret,t),false);
 assert.equal(await verifyStripe(raw,header,secret,t+301),false);
});
test('verified paid checkout accepted',()=>assert.equal(classifyStripeEvent(fixture()).accepted,true));
for(const [label,change] of [
 ['wrong event type',x=>x.type='payment_intent.succeeded'],
 ['wrong payload object',x=>x.data.object.object='payment_intent'],
 ['unpaid',x=>x.data.object.payment_status='unpaid'],
 ['missing checkout identifier',x=>delete x.data.object.id],
 ['missing payment intent',x=>delete x.data.object.payment_intent],
 ['missing price',x=>delete x.data.object.amount_total],
 ['invalid currency',x=>x.data.object.currency='USDC'],
 ['invalid event id',x=>x.id=''],
 ['wrong link',x=>x.data.object.payment_link='bad'],
])test('reject '+label,()=>{const x=fixture();change(x);assert.equal(classifyStripeEvent(x).accepted,false);});
test('full refund admitted, partial refund rejected',()=>{
 const x={id:'evt_refund',livemode:true,type:'charge.refunded',data:{object:{object:'charge',payment_intent:'pi_refund',amount:500,amount_refunded:500,refunded:true}}};
 assert.equal(classifyStripeEvent(x).accepted,true);
 x.data.object.amount_refunded=100;
 assert.equal(classifyStripeEvent(x).accepted,false);
});
test('refunded=false is rejected even if amounts match',()=>{
 const x={id:'evt_refund',livemode:true,type:'charge.refunded',data:{object:{object:'charge',payment_intent:'pi_refund',amount:500,amount_refunded:500,refunded:false}}};
 assert.equal(classifyStripeEvent(x).accepted,false);
});
