#!/usr/bin/env node
import { X402_CAPABILITIES } from '../lib/paid-capability-catalog.mjs';
import { getDiscoveryContract } from '../lib/discovery.mjs';
import { BASE_USDC, RECEIVER } from '../lib/machine-commerce.mjs';

const base = String(process.argv[2] || process.env.CK_MONITOR_BASE_URL || '')
  .replace(/\/+$/, '');

if (!/^https?:\/\//.test(base)) {
  console.error('Usage: synthetic-commercial-monitor.mjs https://host');
  process.exit(2);
}

const EXPECTED_VERSION = '5.0.0';
const EXPECTED_NETWORK = 'eip155:8453';
const failures = [];
const checks = [];

function check(ok, name, detail = null) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(name);
}

async function json(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'x-crossingkey-synthetic': '1',
      'user-agent': 'CrossingKey-Synthetic-Monitor/1.0',
      ...(options?.headers || {})
    },
    signal: AbortSignal.timeout(8000)
  });
  let body = null;
  try { body = await response.json(); } catch {}
  return { response, body };
}

async function mcpRpc(method, params, sessionId = null, id = 1) {
  const response = await fetch(`${base}/mcp`, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      accept:'application/json, text/event-stream',
      'x-crossingkey-synthetic':'1',
      'user-agent':'CrossingKey-Synthetic-Monitor/1.0',
      ...(sessionId ? {'mcp-session-id':sessionId} : {})
    },
    body:JSON.stringify({jsonrpc:'2.0', id, method, params}),
    signal:AbortSignal.timeout(8000)
  });
  const text = await response.text();
  const sse = text.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim();
  let body = null;
  try { body = JSON.parse(sse || text || 'null'); } catch {}
  return {response, body, sessionId:response.headers.get('mcp-session-id') || sessionId};
}

try {
  const health = await json(`${base}/health`);
  check(health.response.status === 200, 'health_status', health.response.status);
  check(health.body?.version === EXPECTED_VERSION, 'health_version', health.body?.version);

  const discovery = await json(`${base}/.well-known/mcp.json`);
  check(discovery.response.status === 200, 'mcp_discovery_status', discovery.response.status);
  check(discovery.body?.canonicalId === 'com.crossingkeyintelligence/crossingkey-mcp', 'canonical_identity', discovery.body?.canonicalId);
  check(discovery.body?.protocolVersion === '2025-11-25', 'protocol_version', discovery.body?.protocolVersion);
  check(discovery.body?.paidCapabilities?.length === 13, 'paid_capability_count', discovery.body?.paidCapabilities?.length);

  const initialized = await mcpRpc('initialize', {
    protocolVersion:'2025-11-25',
    capabilities:{},
    clientInfo:{name:'crossingkey-synthetic-monitor', version:'1'}
  });
  check(initialized.response.status === 200, 'mcp_initialize_status', initialized.response.status);
  check(initialized.body?.result?.protocolVersion === '2025-11-25', 'mcp_initialize_protocol', initialized.body?.result?.protocolVersion);
  check(initialized.body?.result?.serverInfo?.version === EXPECTED_VERSION, 'mcp_initialize_version', initialized.body?.result?.serverInfo?.version);
  check(Boolean(initialized.sessionId), 'mcp_session_created', Boolean(initialized.sessionId));

  if (initialized.sessionId) {
    await mcpRpc('notifications/initialized', {}, initialized.sessionId, 2);
    const listed = await mcpRpc('tools/list', {}, initialized.sessionId, 3);
    const tools = listed.body?.result?.tools || [];
    const names = new Set(tools.map(tool => tool.name));
    check(listed.response.status === 200, 'mcp_tools_list_status', listed.response.status);
    check(tools.length === 28, 'mcp_tool_count', tools.length);
    check(X402_CAPABILITIES.every(capability => names.has(capability.name)), 'mcp_paid_tool_matrix', tools.filter(tool => X402_CAPABILITIES.some(capability => capability.name === tool.name)).length);
  }

  for (const capability of X402_CAPABILITIES) {
    const result = await json(`${base}${capability.executionPath}`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({input:getDiscoveryContract(capability.name).input})
    });
    const encoded = result.response.headers.get('payment-required');
    let challenge = null;
    try { challenge = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : null; } catch {}
    const requirement = challenge?.accepts?.[0];
    check(result.response.status === 402, `${capability.name}:status`, result.response.status);
    check(challenge?.x402Version === 2, `${capability.name}:x402_version`, challenge?.x402Version);
    check(requirement?.network === EXPECTED_NETWORK, `${capability.name}:network`, requirement?.network);
    check(requirement?.asset === BASE_USDC, `${capability.name}:asset`, requirement?.asset);
    check(requirement?.payTo === RECEIVER, `${capability.name}:receiver`, requirement?.payTo);
    check(requirement?.amount === capability.amount, `${capability.name}:amount`, requirement?.amount);
  }
} catch (error) {
  failures.push('monitor_transport');
  checks.push({name:'monitor_transport',ok:false,detail:String(error?.name||'Error')});
}

process.stdout.write(`${JSON.stringify({
  timestamp:new Date().toISOString(),
  base,
  synthetic:true,
  chargeable_operation_attempted:false,
  payment_proof_submitted:false,
  live_settlement_attempted:false,
  checks,
  failures,
  ok:failures.length===0
}, null, 2)}\n`);

process.exitCode = failures.length === 0 ? 0 : 1;
