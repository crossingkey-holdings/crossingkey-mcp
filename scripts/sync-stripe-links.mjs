import fs from 'node:fs';
import Stripe from 'stripe';
if(!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const out=[];
let starting_after;
while(true){
  const page=await stripe.paymentLinks.list({limit:100,...(starting_after?{starting_after}:{})});
  for(const p of page.data) if(p.active) out.push({id:p.id,url:p.url,metadata:p.metadata,active:p.active});
  if(!page.has_more) break;
  starting_after=page.data.at(-1)?.id;
}
fs.writeFileSync('data/stripe_live_sync.json',JSON.stringify({synced_at:new Date().toISOString(),payment_links:out},null,2));
console.log(`Synced ${out.length} active Stripe Payment Links.`);
