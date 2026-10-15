#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { X402_CAPABILITIES } from '../lib/paid-capability-catalog.mjs';
import { getDiscoveryContract } from '../lib/discovery.mjs';

const STAGING_BASE = String(process.env.CK_STAGING_BASE || 'http://127.0.0.1:3401').replace(/\/+$/, '');
const PUBLIC_BASE = String(process.env.CK_PUBLIC_BASE || 'https://mcp.crossingkeyintelligence.com').replace(/\/+$/, '');
const LEGACY_ROOT = path.resolve(process.env.CK_LEGACY_ROOT || '/home/founder/Downloads/crossingkey_developer_revenue_app');
const OUTPUT_JSON = path.resolve(process.env.CK_ENDPOINT_INVENTORY_JSON || 'release-evidence/v4-public-endpoint-inventory.json');
const OUTPUT_MD = path.resolve(process.env.CK_ENDPOINT_MARKETPLACE_MD || 'release-evidence/v4-public-endpoint-marketplace.md');
const EXPECTED_RECEIVER = '0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B';
const EXPECTED_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXPECTED_NETWORK = 'eip155:8453';
const NAMED_LEGACY_ENDPOINTS = new Set(['hash.encode','secret.scan','pii.scan','json.repair','prompt.audit']);

const legacyCatalogPath = path.join(LEGACY_ROOT, 'lib', 'paid-capability-catalog.mjs');
const legacyRuntimePath = path.join(LEGACY_ROOT, 'server-runtime.mjs');
if (!fs.existsSync(legacyCatalogPath) || !fs.existsSync(legacyRuntimePath)) {
  throw new Error(`Legacy source unavailable at ${LEGACY_ROOT}`);
}
const legacySource = fs.readFileSync(legacyRuntimePath, 'utf8');
if (!legacySource.includes("app.post('/api/x402/:capability'")) {
  throw new Error('Legacy direct HTTP x402 route was not found');
}
const { X402_CAPABILITIES: LEGACY_CAPABILITIES } = await import(pathToFileURL(legacyCatalogPath).href);
const legacyByName = new Map(LEGACY_CAPABILITIES.map(capability => [capability.name, capability]));

async function getJson(url) {
  const response = await fetch(url, {
    headers:{'x-crossingkey-synthetic':'1', 'user-agent':'CrossingKey-Continuity-Audit/1.0'},
    signal:AbortSignal.timeout(10_000)
  });
  return {status:response.status, body:await response.json()};
}

async function challenge(url, input) {
  try {
    const response = await fetch(url, {
      method:'POST',
      headers:{
        'content-type':'application/json',
        'x-crossingkey-synthetic':'1',
        'user-agent':'CrossingKey-Continuity-Audit/1.0'
      },
      body:JSON.stringify({input}),
      signal:AbortSignal.timeout(10_000)
    });
    const encoded = response.headers.get('payment-required');
    let paymentRequired = null;
    try { paymentRequired = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : null; } catch {}
    return {
      reached:true,
      status:response.status,
      challenge_present:Boolean(paymentRequired),
      challenge:paymentRequired ? {
        x402Version:paymentRequired.x402Version ?? null,
        resource_url:paymentRequired.resource?.url ?? null,
        requirement:paymentRequired.accepts?.[0] ? {
          scheme:paymentRequired.accepts[0].scheme ?? null,
          network:paymentRequired.accepts[0].network ?? null,
          asset:paymentRequired.accepts[0].asset ?? null,
          amount:paymentRequired.accepts[0].amount ?? null,
          payTo:paymentRequired.accepts[0].payTo ?? null,
          maxTimeoutSeconds:paymentRequired.accepts[0].maxTimeoutSeconds ?? null
        } : null
      } : null
    };
  } catch (error) {
    return {reached:false, status:null, challenge_present:false, error_code:error?.name || 'REQUEST_FAILED'};
  }
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function matchingContract(observation, capability) {
  const requirement = observation?.challenge?.requirement;
  return observation?.status === 402 &&
    observation?.challenge?.x402Version === 2 &&
    requirement?.scheme === 'exact' &&
    requirement?.network === EXPECTED_NETWORK &&
    requirement?.asset === EXPECTED_ASSET &&
    requirement?.payTo === EXPECTED_RECEIVER &&
    requirement?.amount === capability.amount;
}

const [stagingDiscovery, publicHealth, publicDiscovery] = await Promise.all([
  getJson(`${STAGING_BASE}/.well-known/mcp.json`),
  getJson(`${PUBLIC_BASE}/health`),
  getJson(`${PUBLIC_BASE}/.well-known/mcp.json`)
]);

const stagedDescriptorByName = new Map(
  (stagingDiscovery.body.paidCapabilities || []).map(capability => [capability.name, capability])
);
const publicDescriptorByName = new Map(
  (publicDiscovery.body.paidCapabilities || []).map(capability => [capability.name, capability])
);

const endpoints = [];
for (const capability of X402_CAPABILITIES) {
  const stagedDescriptor = stagedDescriptorByName.get(capability.name);
  const legacyCapability = legacyByName.get(capability.name) || null;
  const publicDescriptor = publicDescriptorByName.get(capability.name) || null;
  const routePath = capability.executionPath;
  if (!stagedDescriptor || new URL(stagedDescriptor.execution).pathname !== routePath) {
    endpoints.push({
      capability:capability.name,
      classification:'UNVERIFIED_ENDPOINT',
      reason:'staged discovery route missing or inconsistent'
    });
    continue;
  }

  const validInput = getDiscoveryContract(capability.name).input;
  const [stagedObservation, publicObservation] = await Promise.all([
    challenge(`${STAGING_BASE}${routePath}`, validInput),
    challenge(stagedDescriptor.execution, validInput)
  ]);
  const stagedContractMatches = matchingContract(stagedObservation, capability);
  const publicContractMatches = matchingContract(publicObservation, capability);
  const schemaCompatible = !legacyCapability || (
    same(legacyCapability.inputJsonSchema, stagedDescriptor.inputSchema) &&
    same(legacyCapability.output, stagedDescriptor.output)
  );
  const priceCompatible = !legacyCapability || (
    legacyCapability.amount === capability.amount &&
    legacyCapability.priceUsd === capability.priceUsd &&
    legacyCapability.asset === capability.asset
  );

  let classification = 'UNVERIFIED_ENDPOINT';
  let backwardCompatibility = 'UNVERIFIED';
  if (legacyCapability) {
    if (stagedContractMatches && publicContractMatches && schemaCompatible && priceCompatible) {
      classification = 'LEGACY_ENDPOINT_PRESERVED';
      backwardCompatibility = 'VERIFIED_COMPATIBLE_WITH_V3_0_1';
    } else if (stagedObservation.reached && publicObservation.reached) {
      classification = 'CHANGED_ENDPOINT';
      backwardCompatibility = 'INCOMPATIBLE_OR_CHANGED';
    }
  } else if (stagedContractMatches && publicObservation.status === 404) {
    classification = 'NEW_PUBLIC_ENDPOINT';
    backwardCompatibility = 'ADDITIVE_NOT_PRESENT_IN_V3';
  }

  endpoints.push({
    capability:capability.name,
    method:'POST',
    public_url:stagedDescriptor.execution,
    source_route:routePath,
    route_exists_in_staging:stagedObservation.status === 402,
    directly_callable_over_http:true,
    mcp_only:false,
    classification,
    current_price:{amount_usd:capability.priceUsd, amount_atomic:capability.amount, currency:'USDC'},
    x402_protocol_version:2,
    payment_chain:EXPECTED_NETWORK,
    payment_asset:{symbol:'USDC', address:EXPECTED_ASSET},
    receiving_wallet:EXPECTED_RECEIVER,
    request_schema:stagedDescriptor.inputSchema,
    success_response_schema:stagedDescriptor.output,
    unpaid_response_contract:{
      http_status:402,
      header:'PAYMENT-REQUIRED',
      header_encoding:'base64 JSON',
      schema:{
        type:'object',
        required:['x402Version','resource','accepts'],
        properties:{
          x402Version:{const:2},
          resource:{type:'object'},
          accepts:{type:'array', minItems:1},
          extensions:{type:'object'}
        }
      }
    },
    legacy_v3:{
      in_source_catalog:Boolean(legacyCapability),
      in_public_discovery:Boolean(publicDescriptor),
      named_continuity_requirement:NAMED_LEGACY_ENDPOINTS.has(capability.name),
      schema_compatible:schemaCompatible,
      price_compatible:priceCompatible,
      backward_compatibility:backwardCompatibility,
      unpaid_observation:publicObservation
    },
    staged_unpaid_observation:stagedObservation,
    unpaid_challenge_verification:stagedContractMatches ? 'VERIFIED' : 'FAILED',
    public_hostname_verification:publicContractMatches
      ? 'VERIFIED_CURRENT_V3_0_1'
      : publicObservation.status === 404 && !legacyCapability
        ? 'NOT_YET_PUBLIC_V4'
        : 'UNVERIFIED_OR_CHANGED'
  });
}

const namedLegacyPassed = endpoints
  .filter(endpoint => endpoint.legacy_v3?.named_continuity_requirement)
  .every(endpoint => endpoint.classification === 'LEGACY_ENDPOINT_PRESERVED');
const allLegacyPassed = endpoints
  .filter(endpoint => endpoint.legacy_v3?.in_source_catalog)
  .every(endpoint => endpoint.classification === 'LEGACY_ENDPOINT_PRESERVED');
const stagingPassed = endpoints.length === 13 && endpoints.every(endpoint => endpoint.route_exists_in_staging && endpoint.unpaid_challenge_verification === 'VERIFIED');
const timestamp = new Date().toISOString();
const inventory = {
  schema_version:'crossingkey/public-endpoint-inventory/1',
  generated_at:timestamp,
  release_version:stagingDiscovery.body.version,
  staging_base:STAGING_BASE,
  public_base:PUBLIC_BASE,
  current_public_version:publicHealth.body.version,
  method_source:{
    v4:"server-runtime.mjs app.post('/api/x402/:capability')",
    v3:`${legacyRuntimePath} app.post('/api/x402/:capability')`
  },
  no_payment_proof_submitted:true,
  live_settlement_attempted:false,
  summary:{
    endpoint_count:endpoints.length,
    legacy_endpoint_count:endpoints.filter(endpoint => endpoint.classification === 'LEGACY_ENDPOINT_PRESERVED').length,
    new_public_endpoint_count:endpoints.filter(endpoint => endpoint.classification === 'NEW_PUBLIC_ENDPOINT').length,
    mcp_only_count:endpoints.filter(endpoint => endpoint.classification === 'MCP_ONLY_CAPABILITY').length,
    changed_endpoint_count:endpoints.filter(endpoint => endpoint.classification === 'CHANGED_ENDPOINT').length,
    unverified_endpoint_count:endpoints.filter(endpoint => endpoint.classification === 'UNVERIFIED_ENDPOINT').length,
    named_legacy_continuity_gate:namedLegacyPassed ? 'PASS' : 'FAIL',
    all_legacy_continuity_gate:allLegacyPassed ? 'PASS' : 'FAIL',
    staged_endpoint_gate:stagingPassed ? 'PASS' : 'FAIL',
    promotion_gate:namedLegacyPassed && allLegacyPassed && stagingPassed ? 'PASS' : 'FAIL'
  },
  endpoints
};

const marketplaceLines = [
  '# CrossingKey MCP v4 public paid endpoint marketplace listing',
  '',
  `Generated: ${timestamp}`,
  '',
  `Release: \`${inventory.release_version}\``,
  '',
  'All URLs below come from v4 published discovery metadata and are implemented by the explicit POST `/api/x402/:capability` route. They accept JSON bodies shaped as `{ "input": <request schema> }`. An unpaid valid request returns HTTP 402 plus the x402 v2 `PAYMENT-REQUIRED` header. No endpoint listed here is MCP-only.',
  '',
  '| Classification | Capability | Method | Marketplace URL | Price | Current public state |',
  '| --- | --- | --- | --- | ---: | --- |',
  ...endpoints.map(endpoint => `| ${endpoint.classification} | \`${endpoint.capability}\` | ${endpoint.method} | ${endpoint.public_url} | $${endpoint.current_price?.amount_usd ?? 'UNKNOWN'} USDC | ${endpoint.public_hostname_verification ?? 'UNVERIFIED'} |`),
  '',
  'Shared payment contract: x402 v2; Base mainnet `eip155:8453`; Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; receiver `0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B`.',
  '',
  'The current public hostname still serves v3.0.1. Therefore new v4 endpoints may be locally verified at staging but are not independently public-v4 verified until an approved cutover and readback. A valid unpaid 402 is a challenge, not a payment failure or buyer abandonment.',
  '',
  `Continuity decision: **${inventory.summary.promotion_gate}**.`,
  '',
  '`LIVE_PAYMENT_AND_SETTLEMENT_UNVERIFIED`',
  ''
];

fs.mkdirSync(path.dirname(OUTPUT_JSON), {recursive:true});
fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(inventory, null, 2)}\n`, {mode:0o644});
fs.writeFileSync(OUTPUT_MD, `${marketplaceLines.join('\n')}\n`, {mode:0o644});
process.stdout.write(`${JSON.stringify({
  generated_at:timestamp,
  inventory:OUTPUT_JSON,
  marketplace_listing:OUTPUT_MD,
  summary:inventory.summary
}, null, 2)}\n`);
if (inventory.summary.promotion_gate !== 'PASS') process.exitCode = 1;
