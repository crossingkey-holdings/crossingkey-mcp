import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');

test('server registers canonical v2.4 MCP initialize identity',()=>{
  assert.match(source,/name:'crossingkey-mcp',version:'2\.4\.0'/);
});
test('server registers canonical payment.verify tool',()=>{
  assert.match(source,/registerTool\('payment\.verify'/);
});
test('payment.verify registration is free and read-only',()=>{
  const start=source.indexOf("registerTool('payment.verify'");
  const end=source.indexOf("});",start);
  assert.ok(start>=0 && end>start);
  assert.match(source.slice(start,end+3),/readOnlyHint:true/);
});
test('server exposes provider.describe as canonical discovery entry',()=>assert.match(source,/registerTool\('provider\.describe'/));
test('server exposes payment.methods',()=>assert.match(source,/registerTool\('payment\.methods'/));
test('server exposes health tool',()=>assert.match(source,/registerTool\('health'/));
test('server exposes capability.quote',()=>assert.match(source,/registerTool\('capability\.quote'/));
test('server exposes canonical execution.preflight',()=>assert.match(source,/registerTool\('execution\.preflight'/));
test('legacy aliases are not registered as canonical tools',()=>{
  for(const name of ['discover_provider','list_capabilities','list_offers','get_offer','estimate_cost','preview_result_schema','check_requirements','execution_preflight','crossingkey.describe','payment.verify_onchain']){
    assert.ok(!source.includes(`registerTool('${name}'`),`legacy registration present: ${name}`);
  }
});
test('server preserves receiver-only authority',()=>assert.match(source,/agent_spend:false/));
test('server HTTP discovery surfaces report 2.4.0',()=>{
  assert.match(source,/version:'2\.4\.0'/);
});
test('marketplace integration remains active',()=>{
  assert.match(source,/registerMarketplaceTools\(/);
  assert.match(source,/app\.post\('\/api\/marketplace\/purchase'/);
  assert.match(source,/app\.get\('\/api\/marketplace\/delivery\/:id'/);
  assert.match(source,/marketplaceSessionPrincipals/);
});
test('marketplace registration precedes canonical direct tool registrations',()=>{
  const marketplace=source.indexOf('registerMarketplaceTools(s,{');
  const canonical=source.indexOf("s.registerTool('provider.describe'");
  assert.ok(marketplace>=0 && canonical>marketplace);
});
test('server binds only to loopback',()=>{
  assert.match(source,/app\.listen\(PORT,'127\.0\.0\.1'/);
  assert.doesNotMatch(source,/app\.listen\(PORT,'0\.0\.0\.0'/);
});
test('server MCP endpoint remains streamable HTTP',()=>assert.match(source,/StreamableHTTPServerTransport/));
