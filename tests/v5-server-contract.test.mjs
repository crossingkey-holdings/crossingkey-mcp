import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MCP_RELEASE_VERSION, MCP_PROTOCOL_VERSION, MCP_TOOL_MANIFEST } from '../lib/mcp-manifest.mjs';
import { BASE_USDC, RECEIVER, paymentRequired } from '../lib/machine-commerce.mjs';

test('v5 release metadata is consistent', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  const packageLock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
  const serverJson = JSON.parse(fs.readFileSync(new URL('../server.json', import.meta.url)));
  const liveStatus = JSON.parse(fs.readFileSync(new URL('../live-status.json', import.meta.url)));
  assert.equal(packageJson.version, '5.0.0');
  assert.equal(packageLock.version, '5.0.0');
  assert.equal(packageLock.packages[''].version, '5.0.0');
  assert.equal(MCP_RELEASE_VERSION, '5.0.0');
  assert.equal(MCP_PROTOCOL_VERSION, '2025-11-25');
  assert.equal(MCP_TOOL_MANIFEST.version, '5.0.0');
  assert.equal(serverJson.version, '5.0.0');
  assert.equal(liveStatus.version, '5.0.0');
  assert.equal(liveStatus.operatorHostVersionObserved, '4.0.0');
});

test('v5 preserves receiver-only Base mainnet x402 v1/v2 boundaries', () => {
  const config = { network: 'eip155:8453', receiver: RECEIVER, publicBaseUrl: 'https://mcp.crossingkeyintelligence.com' };
  const v2 = paymentRequired('hash.encode', 2, config);
  const v2Body = JSON.parse(Buffer.from(v2.headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.equal(v2Body.x402Version, 2);
  assert.equal(v2Body.accepts[0].network, 'eip155:8453');
  assert.equal(v2Body.accepts[0].asset, BASE_USDC);
  assert.equal(v2Body.accepts[0].payTo, RECEIVER);
  assert.equal(v2Body.accepts[0].amount, '10000');
  const v1 = paymentRequired('hash.encode', 1, config);
  assert.equal(v1.body.x402Version, 1);
  assert.equal(v1.body.accepts[0].network, 'base');
  assert.equal(v1.body.accepts[0].asset, BASE_USDC);
  assert.equal(v1.body.accepts[0].payTo, RECEIVER);
  assert.equal(v1.body.accepts[0].maxAmountRequired, '10000');
});
