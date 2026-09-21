import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ownership=JSON.parse(
  fs.readFileSync(new URL('../release/tool-registration-ownership-v2.4-marketplace.json',import.meta.url),'utf8')
);

test('marketplace and canonical direct registrations are disjoint',()=>{
  const market=new Set(ownership.marketplace_tool_names);
  const direct=new Set(ownership.canonical_direct_tool_names);
  assert.equal(market.size,ownership.marketplace_tool_names.length);
  assert.equal(direct.size,ownership.canonical_direct_tool_names.length);
  for(const name of direct) assert.ok(!market.has(name),`duplicate public registration owner: ${name}`);
});

test('every canonical public name has exactly one selected owner',()=>{
  const market=new Set(ownership.marketplace_tool_names);
  const direct=new Set(ownership.canonical_direct_tool_names);
  for(const name of ownership.canonical_tool_names){
    const owners=Number(market.has(name))+Number(direct.has(name));
    assert.equal(owners,1,`${name} has ${owners} selected registration owners`);
  }
});

test('diagnosed capability.get collision is marketplace-owned',()=>{
  assert.ok(ownership.marketplace_owned_overlaps.includes('capability.get'));
  assert.ok(ownership.marketplace_tool_names.includes('capability.get'));
  assert.ok(!ownership.canonical_direct_tool_names.includes('capability.get'));
});
