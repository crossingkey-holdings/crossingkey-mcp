import fs from 'node:fs';
import Stripe from 'stripe';
if(!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');
if(!process.env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL.includes('localhost')) throw new Error('Set PUBLIC_BASE_URL to public HTTPS first.');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const packs=JSON.parse(fs.readFileSync('data/credit_links.json','utf8')).packs;
const url=`${process.env.PUBLIC_BASE_URL.replace(/\/+$/,'')}/claim?session_id={CHECKOUT_SESSION_ID}`;
for(const p of packs){
  await stripe.paymentLinks.update(p.payment_link_id,{after_completion:{type:'redirect',redirect:{url}}});
  console.log(`Updated ${p.id} -> ${url}`);
}
