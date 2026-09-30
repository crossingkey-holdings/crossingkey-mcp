export const MCP_RELEASE_VERSION = '3.0.0';
export const MCP_PROTOCOL_VERSION = '2025-11-25';

export const FREE_DISCOVERY_TOOL_NAMES = Object.freeze([
  'provider.describe',
  'offers.list',
  'requirements.check',
  'cost.estimate',
  'result.preview',
  'execution.preflight'
]);

export const PAID_TOOL_NAMES = Object.freeze([
  'x402.compatibility_audit',
  'mcp.schema_audit',
  'openapi.quality_audit',
  'machine_commerce.readiness_audit',
  'artifact.integrity_manifest',
  'xkey.validate'
]);

export const MCP_TOOL_MANIFEST = Object.freeze({
  version: MCP_RELEASE_VERSION,
  protocolVersion: MCP_PROTOCOL_VERSION,
  freeTools: FREE_DISCOVERY_TOOL_NAMES,
  paidTools: PAID_TOOL_NAMES,
  authenticatedTools: Object.freeze(['xkey.validate']),
  annotations: Object.freeze({
    discovery: Object.freeze({readOnlyHint: true, destructiveHint: false}),
    paid: Object.freeze({readOnlyHint: false, destructiveHint: false})
  }),
  approvalRequirements: Object.freeze({
    discovery: 'none',
    paid: 'explicit_human_authorization_before_payment_or_execution'
  }),
  paymentRails: Object.freeze(['stripe_payment_links', 'prepaid_request_credits', 'x402_base_usdc']),
  taskSupport: 'forbidden',
  authenticationModes: Object.freeze(['anonymous_discovery', 'bearer_ck_credit', 'bearer_marketplace_principal']),
  discoveryUrls: Object.freeze([
    '/.well-known/mcp.json',
    '/.well-known/agent.json',
    '/.well-known/agent-card.json',
    '/.well-known/x402'
  ])
});

export const MCP_SERVER_INSTRUCTIONS = [
  'Discover capabilities and requirements first.',
  'Obtain a cost estimate and result preview.',
  'Run execution preflight.',
  'Stop before payment or execution.',
  'Explicit human authorization is required before any purchase, signing, transfer, spending, entitlement creation, or paid execution.',
  '',
  'Required sequence: provider.describe -> offers.list -> requirements.check -> cost.estimate -> result.preview -> execution.preflight -> HUMAN AUTHORIZATION -> payment/entitlement -> execution -> receipt.',
  'These instructions are guidance only. Existing server-side authorization, payment, entitlement, receipt, replay, idempotency, and receiver-only controls remain authoritative.'
].join('\n');
