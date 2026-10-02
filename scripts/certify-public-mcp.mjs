import {
  FREE_DISCOVERY_TOOL_NAMES,
  MARKETPLACE_PUBLIC_TOOL_NAMES,
  MARKETPLACE_PUBLIC_WRITE_TOOL_NAMES,
  PAID_TOOL_NAMES,
  MCP_RELEASE_VERSION,
  MCP_PROTOCOL_VERSION
} from '../lib/mcp-manifest.mjs';

const PUBLIC_URL =
  process.argv[2] ||
  process.env.CROSSINGKEY_PUBLIC_MCP_URL ||
  'https://mcp.crossingkeyintelligence.com/mcp';

const expected = new Set([
  ...FREE_DISCOVERY_TOOL_NAMES,
  ...MARKETPLACE_PUBLIC_TOOL_NAMES,
  ...PAID_TOOL_NAMES
]);

const publicReadOnly = new Set([
  ...FREE_DISCOVERY_TOOL_NAMES,
  ...MARKETPLACE_PUBLIC_TOOL_NAMES.filter(
    name => !MARKETPLACE_PUBLIC_WRITE_TOOL_NAMES.includes(name)
  )
]);

const publicWrites = new Set(MARKETPLACE_PUBLIC_WRITE_TOOL_NAMES);

function parseSse(text) {
  const line = text.split(/\r?\n/).find(value => value.startsWith('data:'));
  if (!line) throw new Error('MCP response did not contain an SSE data event');
  return JSON.parse(line.slice(5).trim());
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return {response, body};
}

async function main() {
  const base = PUBLIC_URL.replace(/\/mcp\/?$/, '');

  const health = await fetchJson(`${base}/health`);
  const metadata = await fetchJson(`${base}/.well-known/mcp.json`);

  const initResponse = await fetch(PUBLIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'crossingkey-live-certification',
          version: '1.0.0'
        }
      }
    })
  });

  if (!initResponse.ok)
    throw new Error(`MCP initialize HTTP ${initResponse.status}`);

  const session = initResponse.headers.get('mcp-session-id');
  if (!session)
    throw new Error('MCP initialize did not return a session');

  const init = parseSse(await initResponse.text());

  const rpc = async (id, method, params = {}) => {
    const response = await fetch(PUBLIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': session
      },
      body: JSON.stringify({jsonrpc: '2.0', id, method, params})
    });

    if (!response.ok)
      throw new Error(`MCP ${method} HTTP ${response.status}`);

    return parseSse(await response.text());
  };

  const listed = (await rpc(2, 'tools/list')).result?.tools || [];
  const names = listed.map(tool => tool.name).sort();
  const expectedNames = [...expected].sort();

  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `Unexpected live MCP tools: actual=[${names.join(',')}] expected=[${expectedNames.join(',')}]`
    );
  }

  const byName = new Map(listed.map(tool => [tool.name, tool]));

  for (const name of publicReadOnly) {
    const tool = byName.get(name);

    if (
      !tool ||
      tool.annotations?.readOnlyHint !== true ||
      tool.annotations?.destructiveHint !== false
    ) {
      throw new Error(`Unsafe or missing read-only annotation: ${name}`);
    }

    if (tool.inputSchema?.additionalProperties !== false) {
      throw new Error(`Public read-only tool schema is not strict: ${name}`);
    }
  }

  for (const name of publicWrites) {
    const tool = byName.get(name);

    if (
      !tool ||
      tool.annotations?.readOnlyHint !== false ||
      tool.annotations?.destructiveHint !== true
    ) {
      throw new Error(`Unsafe or missing public-write annotation: ${name}`);
    }

    if (tool.inputSchema?.additionalProperties !== false) {
      throw new Error(`Public write tool schema is not strict: ${name}`);
    }
  }

  for (const name of PAID_TOOL_NAMES) {
    if (!byName.has(name))
      throw new Error(`Missing paid tool: ${name}`);
  }

  const call = async (id, name, arguments_) => {
    if (!FREE_DISCOVERY_TOOL_NAMES.includes(name))
      throw new Error(`Certification attempted non-discovery tool: ${name}`);

    const result = await rpc(id, 'tools/call', {
      name,
      arguments: arguments_
    });

    if (result.error || result.result?.isError)
      throw new Error(`Free discovery tool failed: ${name}`);

    return result.result?.structuredContent;
  };

  const provider = await call(3, 'provider.describe', {});
  const offers = await call(4, 'offers.list', {limit: 50});

  const selected = offers?.offers?.find(
    value => value.kind === 'capability' || value.delivery_ready !== false
  );

  const item = selected?.id;

  if (!item)
    throw new Error(
      'Live offers.list returned no item suitable for no-charge preflight certification'
    );

  const requirements = await call(5, 'requirements.check', {item_id: item});
  const cost = await call(6, 'cost.estimate', {item_id: item});
  const preview = await call(7, 'result.preview', {item_id: item});
  const preflight = await call(8, 'execution.preflight', {item_id: item});

  if (preflight?.state !== 'READY_FOR_HUMAN_AUTHORIZATION')
    throw new Error(`Unexpected preflight state: ${preflight?.state}`);

  const evidence = {
    status: 'PASS',
    stopState: 'STOPPED_BEFORE_PAYMENT',
    publicUrl: PUBLIC_URL,
    health: health.body,
    metadata: {
      version: metadata.body.version,
      protocolVersion: metadata.body.protocolVersion,
      recommendedEntryTool: metadata.body.recommendedEntryTool,
      freeMcpTools: metadata.body.storefront?.freeMcpTools,
      paidMcpTools: metadata.body.storefront?.paidMcpTools,
      freeTools: metadata.body.storefront?.freeTools,
      paidTools: metadata.body.storefront?.paidTools
    },
    initialize: {
      protocolVersion: init.result?.protocolVersion,
      serverInfo: init.result?.serverInfo,
      instructionsPresent:
        typeof init.result?.instructions === 'string' &&
        init.result.instructions.length > 0,
      sessionEstablished: true
    },
    tools: {
      count: names.length,
      names,
      discoveryReadOnly: FREE_DISCOVERY_TOOL_NAMES,
      marketplacePublic: MARKETPLACE_PUBLIC_TOOL_NAMES,
      marketplacePublicWrites: MARKETPLACE_PUBLIC_WRITE_TOOL_NAMES,
      paid: PAID_TOOL_NAMES
    },
    sequence: {
      item,
      provider,
      offers,
      requirements,
      cost,
      preview,
      preflight
    },
    zeroSpend: {
      paidToolCalls: 0,
      publicWriteToolCalls: 0,
      paymentHeadersSubmitted: 0,
      paymentSignaturesSubmitted: 0,
      checkoutSessionsCreated: 0,
      creditsConsumed: 0,
      facilitatorCalls: 0,
      entitlementsCreated: 0,
      receiptsCreated: 0,
      paidExecutions: 0
    }
  };

  console.log(JSON.stringify(evidence, null, 2));

  console.error(
    `LIVE_CERTIFICATION_PASS tools=${names.length} discovery=${FREE_DISCOVERY_TOOL_NAMES.length} marketplacePublic=${MARKETPLACE_PUBLIC_TOOL_NAMES.length} paid=${PAID_TOOL_NAMES.length} stop=${evidence.stopState}`
  );
}

main().catch(error => {
  console.error(JSON.stringify({status: 'FAIL', error: error.message}));
  process.exitCode = 1;
});
