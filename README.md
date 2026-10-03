# CrossingKey MCP

Agent-native MCP for governed commerce, x402 payments, paid capabilities, and verifiable receipts.

## Production

**Endpoint**

`https://mcp.crossingkeyintelligence.com/mcp`

**Canonical identity**

`com.crossingkeyintelligence/crossingkey-mcp`

**Published source release**

`3.0.1`

**Current production release**

`3.0.0`

The v3.0.1 source release is published and qualified. Production remains on the separately certified v3.0.0 runtime.

Source publication does not imply production deployment.

**Transport**

MCP Streamable HTTP

## CrossingKey MCP v3.0.1 source

CrossingKey MCP is a governed machine-commerce interface for AI agents and authorized software clients.

The v3.0.1 anonymous MCP source surface contains **21 tools**:

- **7 free discovery and commercial-navigation tools**
- **8 public marketplace tools**
- **6 paid or credit-gated tools**

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
- `credits.options`

The normal discovery sequence is:

```text
provider.describe
→ offers.list
→ requirements.check
→ cost.estimate
→ result.preview
→ execution.preflight
→ credits.options (when prepaid request credits are relevant)
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

The anonymous v3.0.1 source surface also exposes:

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

These six tools perform valuable computation, validation, or artifact generation and are payment- or credit-gated:

- `x402.compatibility_audit`
- `mcp.schema_audit`
- `openapi.quality_audit`
- `machine_commerce.readiness_audit`
- `artifact.integrity_manifest`
- `xkey.validate`

Current payment models include x402 Base USDC exact-payment flows and prepaid request credits where applicable.

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

The v3.0.1 source exposes public MCP resources for agent comprehension:

- `crossingkey://discovery-guide`
- `crossingkey://commerce-policy`
- `crossingkey://capability/{name}`

These describe the free discovery sequence, commerce policy, and per-capability instructions.

## Machine commerce

CrossingKey supports governed machine-payment infrastructure including:

- x402 v1
- x402 v2
- Base USDC
- prepaid request credits where supported
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

## Related public architecture

- HAAR research: https://github.com/crossingkey-holdings/crossingkey-public-research/blob/main/research/HAAR.md
- Professional evidence: https://github.com/crossingkey-holdings/experience
- Developer documentation: https://github.com/crossingkey-holdings/crossingkey-developer-documentation
- Open specifications: https://github.com/crossingkey-holdings/crossingkey-open-specifications

HAAR and CrossingKey MCP share concerns such as bounded authority, idempotency, state verification, reconciliation, receipts, and entitlements. HAAR remains a research architecture; this repository and its releases remain authoritative for what CrossingKey MCP actually implements.

## CrossingKey Intelligence

Operating online under the handle `crossingkey_`.

**intelligence is the standard.**
