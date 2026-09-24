import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const machine=fs.readFileSync(new URL('../lib/machine-commerce.mjs',import.meta.url),'utf8');

test('marketplace control plane is intentionally included',()=>{
  for(const marker of [
    "from './lib/marketplace.mjs'",
    "from './lib/marketplace-adapters.mjs'",
    "from './lib/marketplace-storage.mjs'",
    "from './lib/marketplace-tools.mjs'",
    "createMarketplace({core:machineCommerce",
    "app.post('/api/marketplace/purchase'",
    "app.get('/api/marketplace/delivery/:id'",
    'marketplaceSessionPrincipals'
  ]) assert.ok(source.includes(marker),`missing marketplace marker: ${marker}`);
});
test('marketplace-aware machine commerce remains coupled and locked',()=>{
  assert.ok(machine.includes("marketplace-storage.mjs"));
  assert.ok(machine.includes("export async function facilitatorCall"));
  assert.ok(machine.includes("createProductionGate1B({dataFile:config.dataFile"));
});
test('canonical core public names survive marketplace ownership resolution',()=>{
  const ownership=JSON.parse(fs.readFileSync(new URL('../release/tool-registration-ownership-v2.4-marketplace.json',import.meta.url),'utf8'));
  const required=[
    'provider.describe','offers.list','capabilities.list','capability.get','capability.quote',
    'cost.estimate','result.preview','requirements.check','execution.preflight',
    'payment.methods','purchase.status','entitlement.inspect','receipt.verify','payment.verify'
  ];
  for(const name of required){
    assert.ok(ownership.public_tool_union.includes(name),`missing canonical public name ${name}`);
  }
  assert.ok(ownership.marketplace_owned_overlaps.includes('capability.get'),'diagnosed capability.get ownership overlap missing');
  const direct=new Set(ownership.canonical_direct_tool_names);
  for(const name of ownership.marketplace_tool_names){
    assert.ok(!direct.has(name),`duplicate registration ownership remains for ${name}`);
  }
});
