# crossingkey-mcp

Public source, protocol metadata, and release record for the CrossingKey MCP machine-commerce server.

**Production endpoint**

`https://mcp.crossingkeyintelligence.com/mcp`

**Canonical identity**

`com.crossingkeyintelligence/crossingkey-mcp`

**Current production release**

`3.0.0`

**Protocol**

MCP Streamable HTTP  
Protocol version `2025-11-25`

## CrossingKey MCP v3

CrossingKey MCP is a machine-commerce control plane for AI agents and authorized software clients.

It allows agents to discover offers and capabilities, inspect pricing and requirements, obtain bounded authorization, purchase approved capabilities, receive entitlements, verify receipts, and interact with creator/provider marketplace infrastructure through one machine-readable interface.

The design principle is:

> Discovery is free. Evaluation is safe. Payment is explicit. Authority stays bounded. Execution is deterministic. Fulfillment is verifiable.

## v3 public surface

The anonymous MCP surface contains 25 public tools using the canonical `resource.action` naming convention.

Public discovery includes:

- `provider.describe`
- `marketplace.describe`
- `provider.register`
- `provider.get`
- `capability.get`
- `capability.search`
- `catalog.list`
- `commerce.quote`
- `creator.apply`
- `offer.list`
- `cost.estimate`
- `result.preview`
- `requirement.check`
- `execution.preflight`
- `credit.options`
- `service.list`
- `machine_capability.list`
- `machine_capability.quote`
- `payment.methods`
- `purchase.status`
- `entitlement.inspect`
- `receipt.verify`
- `system.health`
- `payment.verify`
- `xkey.validate`

Buyer, provider, and administrator controls are role-scoped and are not advertised in anonymous `tools/list`.

Examples include:

- `capability.purchase`
- `capability.register`
- `provider.set_status`
- `capability.set_status`
- `job.status`
- `receipt.get`
- `settlement.get_balance`
- `settlement.list_allocations`
- `settlement.mark_settled`

## Machine commerce

CrossingKey supports multiple commerce paths:

- Stripe-hosted payment links
- prepaid request credits
- x402 v1
- x402 v2
- Base USDC machine payments

The CrossingKey wallet boundary is receiver-only.

The MCP does not grant agents unrestricted wallet signing, sending, swapping, bridging, or spending authority.

Paid actions require appropriate authorization.

## Marketplace

The v3 marketplace supports:

- provider intake
- creator intake
- capability registration
- rights and provenance records
- public capability search
- exact machine-readable quotes
- buyer-authorized purchases
- x402 payment settlement
- deterministic jobs
- receipts
- entitlements
- provider revenue allocation
- settlement accounting

Creator ownership remains with the creator/provider unless separately agreed.

AI-training permission defaults to false.

## Role-scoped authority

Anonymous agents can discover and evaluate public inventory.

Authenticated buyers can access purchase, receipt, and job functions appropriate to their identity.

Authenticated providers can register capabilities and inspect their authorized accounting records.

Authenticated administrators can approve provider/capability state and record externally authorized settlement evidence.

Administrative MCP tools do not themselves move treasury funds.

## Security properties

The system includes:

- bounded JSON input validation
- strict capability schemas
- SSRF protections
- DNS/address validation
- response-size limits
- role-scoped credentials
- credential expiry and revocation
- idempotent purchase handling
- signed-payment replay protection
- deterministic result hashing
- entitlement binding
- receipt verification
- digital-asset hash verification
- receiver-only wallet policy

No private keys, wallet secrets, Stripe secrets, API keys, seed phrases, mnemonics, or private customer data belong in this repository.

## x402

CrossingKey supports both x402 v1 and v2 payment requirements.

The machine-commerce flow is:

```text
discover
→ evaluate
→ quote
→ authorize
→ pay
→ verify
→ settle
→ execute
→ issue entitlement
→ bind receipt
→ return verified result
```

Logical retries use idempotency keys to avoid duplicate purchases.

Signed payment replays are rejected.

## Verification

The v3 release test suite contains 84 tests covering the server, marketplace, x402 flows, authorization boundaries, replay protection, receipt/entitlement behavior, SSRF protection, digital delivery, settlement accounting, and MCP transport.

Release verification:

```text
tests 84
pass 84
fail 0
```

## Agent discovery

Recommended entry tool:

`provider.describe`

Canonical endpoint:

`https://mcp.crossingkeyintelligence.com/mcp`

Canonical identity:

`com.crossingkeyintelligence/crossingkey-mcp`

Well-known MCP metadata:

`https://mcp.crossingkeyintelligence.com/.well-known/mcp.json`

## CrossingKey Intelligence

Operating online under the handle `crossingkey_`.

**intelligence is the standard.**
