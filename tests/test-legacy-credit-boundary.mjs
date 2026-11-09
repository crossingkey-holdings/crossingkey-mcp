import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MCP_TOOL_MANIFEST } from '../lib/mcp-manifest.mjs';

const runtime = fs.readFileSync(new URL('../server-runtime.mjs', import.meta.url), 'utf8');

test('prepaid credit packs are disabled while historical redemption remains available', () => {
  assert.ok(MCP_TOOL_MANIFEST.freeTools.includes('credits.options'));
  assert.match(runtime, /discoveryTool\('credits\.options'/);
  assert.match(runtime, /packs:\[\],legacy_redemption:'separate_compatibility_path',new_sales_enabled:false/);
  assert.match(runtime, /status:'credit_sales_disabled',fulfillment:'legacy_credits_not_issued'/);
  assert.match(runtime, /registerTool\('xkey\.validate\.legacy'/);
  assert.match(runtime, /Compatibility-only redemption of an existing paid request credit/);
  assert.match(runtime, /New customers must use xkey\.validate with direct x402 payment/);
});
