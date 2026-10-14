import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {X402_CAPABILITIES,PREPAID_CAPABILITIES,assertPaidCatalog} from '../lib/paid-capability-catalog.mjs';

const source=fs.readFileSync(new URL('../server-runtime.mjs',import.meta.url),'utf8');

test('canonical v3 identity and streamable HTTP transport remain configured',()=>{
  assert.match(source,/name:'crossingkey-mcp',version:MCP_RELEASE_VERSION/);
  assert.match(source,/StreamableHTTPServerTransport/);
  assert.match(source,/host\s*=\s*'127\.0\.0\.1'/); assert.match(source,/port\s*=\s*PORT/);
});

test('paid catalog is complete and exposes exact x402 pricing',()=>{
  assert.equal(assertPaidCatalog(),true);
  assert.equal(X402_CAPABILITIES.length,13);
  for(const name of ['hash.encode','secret.scan','pii.scan','json.repair','prompt.audit']){
    const capability=X402_CAPABILITIES.find(x=>x.name===name);
    assert.ok(capability,`missing paid capability: ${name}`);
    assert.equal(capability.priceUsd,'0.01');
    assert.equal(capability.amount,'10000');
  }
  assert.equal(X402_CAPABILITIES.find(x=>x.name==='mcp.launch_audit')?.priceUsd,'9.00');
  assert.equal(X402_CAPABILITIES.find(x=>x.name==='x402.purchase_path_audit')?.priceUsd,'19.00');
  assert.equal(PREPAID_CAPABILITIES.length,0);
  assert.equal(X402_CAPABILITIES.find(x=>x.name==='xkey.validate')?.amount,'100000');
  assert.match(source,/const paidX402Tools = X402_CAPABILITIES/);
  assert.match(source,/nativePaymentRequired\(paid\)/);
  assert.match(source,/x402\/payment/);
});

test('free discovery and health remain bounded while paid computation stays protected',()=>{
  for(const endpoint of ['/.well-known/mcp.json','/.well-known/x402','/health'])assert.ok(source.includes(`app.get('${endpoint}'`));
  assert.match(source,/freeMcpTools:FREE_DISCOVERY_TOOL_NAMES\.length/);
  assert.match(source,/walletMode:'receiver-only'/);
  assert.match(source,/autonomousSellerSpend: false/);
  assert.ok(!source.includes("registerTool('payment.verify'"));
});

test('marketplace HTTP purchase and delivery remain wired',()=>{
  assert.match(source,/createMarketplace\(\{core:machineCommerce/);
  assert.match(source,/app\.post\('\/api\/marketplace\/purchase'/);
  assert.match(source,/app\.get\('\/api\/marketplace\/delivery\/:id'/);
  assert.match(source,/marketplaceSessionPrincipals/);
});

test('retired aliases are not advertised as paid tools',()=>{
  const names=new Set([...X402_CAPABILITIES,...PREPAID_CAPABILITIES].map(x=>x.name));
  for(const name of ['list_capabilities','get_offer','get_stripe_checkout_link','crossingkey.describe'])assert.equal(names.has(name),false);
});
