import Stripe from 'stripe';
if(!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required');
if(!process.env.PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL.includes('localhost')) throw new Error('Set PUBLIC_BASE_URL to the public HTTPS server first.');
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY);
const target=`${process.env.PUBLIC_BASE_URL.replace(/\/+$/,'')}/stripe/webhook`;
const existing=await stripe.webhookEndpoints.list({limit:100});
let ep=existing.data.find(x=>x.url===target && x.status==='enabled');
if(!ep){
  ep=await stripe.webhookEndpoints.create({
    url:target,
    enabled_events:['checkout.session.completed','checkout.session.async_payment_succeeded'],
    description:'CrossingKey Revenue MCP v2 fulfillment webhook'
  });
  console.log('Created webhook endpoint:',ep.url);
  console.log('Webhook signing secret (store in STRIPE_WEBHOOK_SECRET; it is shown only now):');
  console.log(ep.secret);
}else{
  console.log('Webhook endpoint already exists:',ep.url);
}
