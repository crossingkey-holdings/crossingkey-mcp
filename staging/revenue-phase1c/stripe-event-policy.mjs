// Runtime-neutral, dependency-free Stripe verification policy for staging.
// Critical: only call the service-role RPC after a verified signature AND a
// recognized, fully qualified event. This module never accesses secrets itself.
const utf8 = new TextEncoder();
const toHex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('');
export async function verifyStripe(raw, header, secret, nowSeconds = Math.floor(Date.now()/1000)) {
  if(typeof raw !== 'string' || typeof header !== 'string' || !secret) return false;
  const fields = header.split(',').map(x=>x.trim());
  const ts = fields.find(x=>/^t=/.test(x))?.slice(2);
  const signatures = fields.filter(x=>/^v1=/.test(x)).map(x=>x.slice(3));
  if(!/^\d{9,12}$/.test(ts||'') || !signatures.length) return false;
  if(Math.abs(nowSeconds-Number(ts))>300) return false;
  const key=await crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=toHex(await crypto.subtle.sign('HMAC',key,utf8.encode(ts+'.'+raw)));
  // Fixed-length comparison, even for invalid signature encodings.
  let matches=0;
  for(const sig of signatures){
    if(!/^[a-f0-9]{64}$/i.test(sig)) continue;
    let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^sig.toLowerCase().charCodeAt(i);
    matches|=Number(diff===0);
  }
  return matches===1;
}
export function classifyStripeEvent(event) {
  if(!event || typeof event.id!=='string' || !event.id.startsWith('evt_') ||
    typeof event.livemode!=='boolean' || !event.data?.object) return {accepted:false,reason:'invalid_event'};
  const obj=event.data.object;
  if(event.type==='checkout.session.completed' || event.type==='checkout.session.async_payment_succeeded'){
    if(obj.object!=='checkout.session' || typeof obj.id!=='string' ||
       !obj.id.startsWith('cs_') || obj.payment_status!=='paid' ||
       typeof obj.payment_link!=='string' || !obj.payment_link.startsWith('plink_') ||
       typeof obj.payment_intent!=='string' || !obj.payment_intent.startsWith('pi_') ||
       !Number.isSafeInteger(obj.amount_total) || obj.amount_total<=0 ||
       typeof obj.currency!=='string' || !/^[a-z]{3}$/.test(obj.currency))
      return {accepted:false,reason:'not_verified_paid_checkout'};
    return {accepted:true,kind:'checkout'};
  }
  // Only full refunds are automatically revoked. Partial refunds need manual
  // entitlement policy review and cannot grant or revoke silently.
  if(event.type==='charge.refunded'){
    if(obj.object!=='charge' || obj.refunded!==true ||
       !Number.isSafeInteger(obj.amount) || obj.amount<=0 ||
       !Number.isSafeInteger(obj.amount_refunded) || obj.amount_refunded<obj.amount ||
       typeof obj.payment_intent!=='string' || !obj.payment_intent.startsWith('pi_'))
      return {accepted:false,reason:'partial_or_unverified_refund'};
    return {accepted:true,kind:'full_refund'};
  }
  return {accepted:false,reason:'unsupported_event_type'};
}
