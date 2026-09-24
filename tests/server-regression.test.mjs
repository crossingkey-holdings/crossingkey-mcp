import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {X402_CAPABILITIES,PREPAID_CAPABILITIES,assertPaidCatalog} from '../lib/paid-capability-catalog.mjs';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');

test('canonical v3 identity and streamable HTTP transport remain configured',()=>{
  assert.match(source,/name:'crossingkey-mcp',version:'3\.0\.0'/);
  assert.match(source,/StreamableHTTPServerTransport/);
  assert.match(source,/app\.listen\(PORT,'127\.0\.0\.1'/);
});

test('paid catalog is complete and exposes exact x402 pricing',()=>{
  assert.equal(assertPaidCatalog(),true);
  assert.equal(X402_CAPABILITIES.length,5);
  assert.equal(PREPAID_CAPABILITIES[0].name,'xkey.validate');
  assert.match(source,/const paidX402Tools = X402_CAPABILITIES/);
  assert.match(source,/machineCommerce\.paymentRequired\(paid\.name,2\)/);
});

test('free discovery and health do not expose free MCP computation',()=>{
  for(const endpoint of ['/.well-known/mcp.json','/.well-known/x402','/health'])assert.ok(source.includes(`app.get('${endpoint}'`));
  assert.match(source,/freeMcpTools:0/);
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
