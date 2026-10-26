# CrossingKey MCP

Agent-native MCP for governed commerce, x402 payments, paid capabilities, and verifiable receipts.

## Production

**Endpoint**

`https://mcp.crossingkeyintelligence.com/mcp`

**Canonical identity**

`com.crossingkeyintelligence/crossingkey-mcp`

**Stable source target**

`5.0.1` — the exact dependency-hardening source being prepared for promotion.

**Current public runtime before host cutover**

`5.0.0` — the current public runtime before the v5.0.1 host cutover.

**Promotion state**

The source is being prepared as patch release `5.0.1`. The host-side restart and GitHub release/tag are performed only after the running process is verified against this exact source.

**Public verification**

- Cloudflare Tunnel `crossingkey-mcp` is healthy.
- `mcp.crossingkeyintelligence.com` routes to the V4 origin on `127.0.0.1:3401`.
- Public discovery reports V4, Streamable HTTP, and Base mainnet `eip155:8453`.
- No live payment or Base settlement is implied by discovery metadata alone.

This repository is the source of truth for the V4 candidate. Runtime deployment and release tagging are tracked separately.

**Public documentation**

- [MCP protocol and capability guide](docs/MCP.md)
- [Live machine discovery](https://mcp.crossingkeyintelligence.com/.well-known/mcp.json)
- [Live health](https://mcp.crossingkeyintelligence.com/health)
- [Public human-facing documentation](https://www.crossingkeyintelligence.com/mcp/)
- [GitHub source](https://github.com/crossingkey-holdings/crossingkey-mcp)

**Transport**

MCP Streamable HTTP

## CrossingKey MCP v5.0.1

CrossingKey MCP is a governed machine-commerce interface for AI agents and authorized software clients.

The stable source preserves the existing anonymous MCP surface and adds the two authorized v4 paid audits. The exact live/public tool count remains a deployment-time verification item.

- **7 free discovery and commercial-navigation tools**
- **8 public marketplace tools**
- **13 direct x402 paid tools** plus a separately named legacy credit-redemption compatibility tool for existing customers

Authenticated sessions additionally expose verification and role-gated marketplace operations.

The operating principle is:

> Discovery is free. Evaluation is safe. Payment is explicit. Authority stays bounded. Execution is deterministic. Fulfillment is verifiable.

## Free discovery

These seven tools can be used anonymously to understand the provider, available offers, requirements, price, expected result, authorization state, and prepaid-credit options without spending money:

- `provider.describe`
- `offers.list`
- `requirements.check`
- `cost.estimate`
- `result.preview`
- `execution.preflight`
- `credits.options` (legacy compatibility status; new credit sales are disabled)

The normal discovery sequence is:

```text
provider.describe
→ offers.list
→ requirements.check
→ cost.estimate
→ result.preview
→ execution.preflight
→ credits.options (legacy compatibility status; new credit sales are disabled)
```

A valid commercial flow may reach:

```text
READY_FOR_HUMAN_AUTHORIZATION
```

and then stop at:

```text
STOPPED_BEFORE_PAYMENT
```

until the required buyer authorization and payment conditions are satisfied.


## Public marketplace discovery

The preserved anonymous marketplace surface also exposes:

- `marketplace.describe`
- `provider.register`
- `provider.get`
- `capability.get`
- `capability.search`
- `catalog.list`
- `commerce.quote`
- `creator.apply`

Discovery, catalog browsing, capability inspection, and quoting do not themselves authorize paid execution.

`provider.register` and `creator.apply` are public write surfaces for application and intake workflows. They do not grant unrestricted commercial authority.

## Paid and gated execution

These 13 tools perform valuable computation, validation, or artifact generation and use direct x402 payment:

- `x402.compatibility_audit`
- `mcp.schema_audit`
- `openapi.quality_audit`
- `machine_commerce.readiness_audit`
- `artifact.integrity_manifest`
- `xkey.validate`

Current v4 paid capabilities use exact x402 Base USDC payments. Historical prepaid credit balances remain redeemable only through the separately named legacy compatibility path; v4 does not sell new credit packs.

Free discovery does not consume paid execution credits.


## Authenticated verification

Authenticated sessions can expose read-only verification tools including:

- `approval.verify`
- `idempotency.inspect`
- `receipt.verify`
- `entitlement.inspect`

Marketplace sessions may additionally expose role-gated job, receipt, purchase, provider, capability, and settlement operations.

Approval minting remains a local operator action and is not exposed over MCP.

## Commercial flow

The governed machine-commerce path is:

```text
discover
→ inspect requirements
→ estimate cost
→ preview result
→ preflight
→ authorize
→ pay
→ verify settlement
→ execute
→ issue result
→ bind entitlement
→ issue verifiable receipt
```

Payment alone does not create unrestricted authority.

Authorization, payment verification, execution, fulfillment, entitlement creation, and receipt generation remain separate governed stages.

## Human authorization

CrossingKey does not treat an LLM-supplied boolean such as `approved: true` as buyer authorization.

Where human authorization is required, approval is bound to the relevant commercial context, including the buyer, capability, inputs, quote, idempotency state, and expiration conditions.

Paid execution does not occur merely because an agent asks for it.


## MCP resources

The candidate preserves the public MCP resources for agent comprehension:

- `crossingkey://discovery-guide`
- `crossingkey://commerce-policy`
- `crossingkey://capability/{name}`

These describe the free discovery sequence, commerce policy, and per-capability instructions.

## Machine commerce

CrossingKey supports governed machine-payment infrastructure including:

- x402 v1
- x402 v2
- Base USDC
- historical prepaid request credits through a separately named compatibility path only
- settlement verification
- entitlements
- result-bound receipts
- idempotent execution
- replay protection

The CrossingKey seller wallet boundary is **receiver-only**.

Agents are not granted unrestricted wallet signing, sending, swapping, bridging, or autonomous seller-spend authority.

## Security properties

The production design includes:

- bounded input validation
- strict capability schemas
- SSRF protections
- DNS and address validation
- response-size controls
- authorization boundaries
- approval binding
- idempotency protection
- payment replay protection
- duplicate-settlement protection
- deterministic result hashing
- entitlement binding
- receipt verification
- receiver-only seller wallet policy
- explicit uncertain-settlement handling

No private keys, wallet secrets, Stripe secrets, API keys, seed phrases, mnemonics, or private customer information belong in this repository.

## Agent discovery

Recommended entry point:

`provider.describe`

Canonical MCP endpoint:

`https://mcp.crossingkeyintelligence.com/mcp`

Canonical identity:

`com.crossingkeyintelligence/crossingkey-mcp`

Official MCP Registry identity:

`com.crossingkeyintelligence/crossingkey-mcp`

Website:

`https://www.crossingkeyintelligence.com`

## CrossingKey Intelligence

Operating online under the handle `crossingkey_`.

**intelligence is the standard.**
