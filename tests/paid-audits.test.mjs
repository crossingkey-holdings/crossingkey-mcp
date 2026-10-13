import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpLaunchAudit, x402PurchasePathAudit} from '../lib/paid-audits.mjs';

function response(body, {status = 200, headers = {'content-type': 'application/json'}} = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {status, headers});
}

test('MCP launch audit executes bounded discovery checks with deterministic findings', async () => {
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (path === '/health') return response({ok: true, version: '4.0.0'});
    if (path === '/.well-known/mcp.json') return response({version: '4.0.0'});
    if (path === '/.well-known/x402') return response({walletMode: 'receiver-only'});
    if (path === '/mcp' && options.method === 'POST') return response({result: {tools: [{name: 'example', description: 'A sufficiently descriptive tool.', inputSchema: {type: 'object', properties: {}}}]}});
    return response({error: 'not found'}, {status: 404});
  };
  const result = await mcpLaunchAudit({url: 'https://192.0.2.1'}, fetchImpl);
  assert.equal(result.capability, 'mcp.launch_audit');
  assert.equal(result.passed, true);
  assert.equal(result.score, 100);
  assert.equal(result.checks.length, 4);
});

test('x402 purchase-path audit validates a challenge without attempting payment', async () => {
  const fetchImpl = async () => response(null, {status: 402, headers: {'payment-required': Buffer.from(JSON.stringify({x402Version: 2, accepts: [{scheme: 'exact', network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: '0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28', amount: '9000000'}]})).toString('base64')}});
  const result = await x402PurchasePathAudit({url: 'https://192.0.2.1', capability: 'mcp.launch_audit'}, fetchImpl);
  assert.equal(result.passed, true);
  assert.equal(result.paymentAttempted, false);
  assert.equal(result.settlementAttempted, false);
  assert.equal(result.findings.length, 0);
});

test('paid audit fetches reject private destinations before network access', async () => {
  let called = false;
  await assert.rejects(() => mcpLaunchAudit({url: 'http://127.0.0.1:9'}, async () => { called = true; }), /Private\/internal/);
  assert.equal(called, false);
});
