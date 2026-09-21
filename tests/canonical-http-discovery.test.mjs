import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');

test('marketplace-inclusive v2.4 discovery advertises canonical identity',()=>{
  assert.ok(source.includes("canonicalId:'com.crossingkeyintelligence/crossingkey-mcp'"));
  assert.ok(source.includes("version:'2.4.0'"));
  assert.ok(source.includes("recommendedEntryTool:'provider.describe'"));
  assert.ok(source.includes("marketplace:marketplace.describe()"));
});
test('marketplace-inclusive v2.4 discovery preserves receiver-only x402 policy',()=>{
  assert.ok(source.includes("walletMode:'receiver-only'"));
  assert.ok(source.includes("networks:CK_ENABLE_MAINNET?['eip155:8453']:['eip155:84532']"));
  assert.ok(source.includes("x402Version:2"));
});
test('public health remains minimal despite marketplace integration',()=>{
  const start=source.indexOf("app.get('/health'");
  const end=source.indexOf("app.get('/.well-known/x402'",start);
  assert.ok(start>=0 && end>start);
  const block=source.slice(start,end);
  for(const forbidden of ['stripe_configured','webhook_configured','claim_secret_configured','machine_commerce_configured','machineCommerce.status()']){
    assert.ok(!block.includes(forbidden),`health leaked ${forbidden}`);
  }
});
test('free verification tool remains payment.verify',()=>{
  assert.ok(source.includes("registerTool('payment.verify'"));
  assert.ok(!source.includes("registerTool('payment.verify_onchain'"));
});
