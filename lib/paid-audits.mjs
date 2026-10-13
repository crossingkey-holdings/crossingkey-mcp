import dns from 'node:dns/promises';
import net from 'node:net';

const MAX_BYTES = 256 * 1024;
const MAX_TOOLS = 100;
const timeout = 8000;

function privateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
  }
  const value = ip.toLowerCase();
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
}

async function safeUrl(raw) {
  const url = new URL(String(raw));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only credential-free HTTP(S) URLs are allowed');
  const addresses = net.isIP(url.hostname) ? [url.hostname] : (await dns.lookup(url.hostname, {all: true})).map(item => item.address);
  if (addresses.some(privateIp)) throw new Error('Private/internal destinations are forbidden');
  return url;
}

async function fetchJson(fetchImpl, raw, options = {}) {
  const url = await safeUrl(raw);
  const response = await fetchImpl(url, {...options, redirect: 'error', signal: AbortSignal.timeout(timeout), headers: {'accept': 'application/json, text/event-stream', 'user-agent': 'CrossingKey-MCP-Audit/4.0', ...(options.headers || {})}});
  const reader = response.body?.getReader?.();
  let text = '';
  if (reader) {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8');
      if (Buffer.byteLength(text) > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new Error('Audit response exceeds 256KB'); }
    }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('Audit response exceeds 256KB');
  }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON is an auditable finding */ }
  return {url: url.toString(), response, body, text};
}

function finding(code, severity, detail) { return {code, severity, detail}; }
function score(findings) { return Math.max(0, 100 - findings.reduce((total, item) => total + (item.severity === 'high' ? 25 : item.severity === 'medium' ? 12 : 4), 0)); }

export async function mcpLaunchAudit(input, fetchImpl = fetch) {
  const target = String(input?.url || '');
  if (!target) throw new TypeError('url is required');
  const base = await safeUrl(target);
  const findings = [];
  const checks = [];
  const probe = async (path, method = 'GET', body = null) => {
    try {
      const result = await fetchJson(fetchImpl, new URL(path, base).toString(), {method, body});
      const check = {path, status: result.response.status, ok: result.response.ok, contentType: result.response.headers.get('content-type') || null};
      checks.push(check);
      return result;
    } catch (error) {
      checks.push({path, status: null, ok: false, error: String(error.message || error)});
      return null;
    }
  };
  const health = await probe('/health');
  if (!health?.response.ok) findings.push(finding('HEALTH_UNAVAILABLE', 'high', 'The service health endpoint did not return 2xx.'));
  const manifest = await probe('/.well-known/mcp.json');
  if (!manifest?.body || typeof manifest.body !== 'object') findings.push(finding('MCP_MANIFEST_INVALID', 'high', 'The MCP discovery manifest is missing or not valid JSON.'));
  else if (!manifest.body.version) findings.push(finding('MCP_VERSION_MISSING', 'medium', 'The MCP manifest does not expose a version.'));
  const x402 = await probe('/.well-known/x402');
  if (!x402?.body || typeof x402.body !== 'object') findings.push(finding('X402_DISCOVERY_MISSING', 'medium', 'The x402 discovery document is missing or not valid JSON.'));
  else if (x402.body.walletMode !== 'receiver-only') findings.push(finding('RECEIVER_ONLY_UNCONFIRMED', 'high', 'The x402 discovery document does not declare receiver-only wallet behavior.'));
  const mcp = await probe('/mcp', 'POST', JSON.stringify({jsonrpc: '2.0', id: 'launch-audit', method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'crossingkey-launch-audit', version: '4.0.0'}}}));
  if (!mcp?.response.ok) findings.push(finding('MCP_TRANSPORT_UNAVAILABLE', 'high', 'The MCP transport did not accept the initialize probe.'));
  const tools = Array.isArray(mcp?.body?.result?.tools) ? mcp.body.result.tools : [];
  if (tools.length > MAX_TOOLS) findings.push(finding('TOOL_COUNT_UNBOUNDED', 'medium', `The advertised tool count exceeds ${MAX_TOOLS}.`));
  for (const tool of tools.slice(0, MAX_TOOLS)) {
    if (!tool?.name || typeof tool.name !== 'string') findings.push(finding('TOOL_NAME_MISSING', 'medium', 'A tool is missing a string name.'));
    if (!tool?.description || String(tool.description).length < 20) findings.push(finding('TOOL_DESCRIPTION_WEAK', 'low', `Tool ${tool?.name || '<unknown>'} has a weak description.`));
    if (!tool?.inputSchema || tool.inputSchema.type !== 'object') findings.push(finding('TOOL_SCHEMA_MISSING', 'medium', `Tool ${tool?.name || '<unknown>'} has no bounded object input schema.`));
  }
  return {capability: 'mcp.launch_audit', target: base.toString(), score: score(findings), passed: findings.every(item => item.severity !== 'high'), checks, findings, method: 'crossingkey_mcp_launch_audit_v1'};
}

export async function x402PurchasePathAudit(input, fetchImpl = fetch) {
  const target = String(input?.url || '');
  const capability = String(input?.capability || '');
  if (!target) throw new TypeError('url is required');
  if (!capability || capability.length > 160) throw new TypeError('capability is required and must be bounded');
  const base = await safeUrl(target);
  const findings = [];
  const checks = [];
  const challengeUrl = new URL(`/api/x402/${encodeURIComponent(capability)}`, base).toString();
  let challenge;
  try {
    const result = await fetchJson(fetchImpl, challengeUrl, {method: 'POST', body: '{}'});
    const decoded = result.response.headers.get('payment-required');
    challenge = decoded ? JSON.parse(Buffer.from(decoded, 'base64').toString('utf8')) : result.body;
    checks.push({name: 'challenge', status: result.response.status, hasHeader: Boolean(decoded), ok: result.response.status === 402});
    if (result.response.status !== 402) findings.push(finding('CHALLENGE_STATUS_INVALID', 'high', 'The purchase endpoint did not return HTTP 402 without a payment.'));
  } catch (error) {
    checks.push({name: 'challenge', status: null, ok: false, error: String(error.message || error)});
    findings.push(finding('CHALLENGE_UNAVAILABLE', 'high', 'The purchase challenge could not be retrieved.'));
  }
  const accepts = challenge?.accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) findings.push(finding('PAYMENT_REQUIREMENTS_MISSING', 'high', 'The challenge does not contain payment requirements.'));
  else {
    const requirement = accepts[0];
    for (const key of ['scheme', 'network', 'asset', 'payTo']) if (!requirement[key]) findings.push(finding(`PAYMENT_${key.toUpperCase()}_MISSING`, 'high', `The payment requirement is missing ${key}.`));
    if (!/^0x[a-fA-F0-9]{40}$/.test(String(requirement.payTo || ''))) findings.push(finding('PAY_TO_INVALID', 'high', 'The payment destination is not a canonical EVM address.'));
    if (!/^\d+$/.test(String(requirement.amount || requirement.maxAmountRequired || ''))) findings.push(finding('AMOUNT_INVALID', 'high', 'The payment amount is not a positive atomic integer.'));
  }
  if (challenge?.walletMode && challenge.walletMode !== 'receiver-only') findings.push(finding('WALLET_MODE_UNSAFE', 'high', 'The target does not advertise receiver-only behavior.'));
  return {capability: 'x402.purchase_path_audit', target: base.toString(), auditedCapability: capability, score: score(findings), passed: findings.every(item => item.severity !== 'high'), checks, findings, paymentAttempted: false, settlementAttempted: false, method: 'crossingkey_x402_purchase_path_audit_v1'};
}

export const PAID_AUDIT_EXECUTORS = Object.freeze({'mcp.launch_audit': mcpLaunchAudit, 'x402.purchase_path_audit': x402PurchasePathAudit});
