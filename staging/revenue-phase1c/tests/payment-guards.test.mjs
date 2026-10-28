import test from 'node:test';
import assert from 'node:assert/strict';

const receiver = '0x2381A81818E0FdCBe36c901e52dD87472ceE6a32';
const legacy = '0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B';
const baseUsdc = '0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913';

function checkChallenge(challenge) {
  if (challenge.x402Version !== 2 || !Array.isArray(challenge.accepts) || challenge.accepts.length !== 1) return false;
  const a = challenge.accepts[0];
  return a.scheme === 'exact' && a.network === 'eip155:8453'
    && a.asset?.toLowerCase() === baseUsdc.toLowerCase()
    && a.payTo?.toLowerCase() === receiver.toLowerCase() && a.amount === '10000';
}

function eligibleForFulfillment(event, plan) {
  return event.livemode === true
    && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)
    && event.payment_status === 'paid'
    && event.payment_link === plan.link
    && event.amount_total === plan.amount
    && event.currency === plan.currency
    && !!event.session_id;
}

const challenge = {x402Version:2,accepts:[{scheme:'exact',network:'eip155:8453',asset:baseUsdc,payTo:receiver,amount:'10000'}]};
const plan={link:'plink_fixture',amount:500,currency:'usd'};
const checkout={livemode:true,type:'checkout.session.completed',payment_status:'paid',payment_link:plan.link,amount_total:500,currency:'usd',session_id:'cs_fixture'};
test('canonical challenge passes',()=> assert.equal(checkChallenge(challenge),true));
for (const [name,field,value] of [['legacy receiver','payTo',legacy],['wrong token','asset','0x0000000000000000000000000000000000000000'],['wrong network','network','eip155:84532'],['wrong amount','amount','100000']]) {
  test('reject '+name,()=>assert.equal(checkChallenge({...challenge,accepts:[{...challenge.accepts[0],[field]:value}]}),false));
}
test('paid live checkout passes',()=>assert.equal(eligibleForFulfillment(checkout,plan),true));
for (const [name,field,value] of [['sandbox','livemode',false],['unpaid','payment_status','unpaid'],['wrong link','payment_link','plink_other'],['wrong amount','amount_total',1],['wrong currency','currency','usdc'],['payment-intent event','type','payment_intent.succeeded'],['missing session','session_id',null]]) {
  test('reject '+name,()=>assert.equal(eligibleForFulfillment({...checkout,[field]:value},plan),false));
}
test('different events for same checkout must share an idempotency key',()=> {
  const a={...checkout,id:'evt_one'}, b={...checkout,id:'evt_two'};
  assert.notEqual(a.id,b.id); assert.equal(a.session_id,b.session_id);
});
