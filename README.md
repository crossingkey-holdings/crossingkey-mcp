# crossingkey-mcp

Public source and discovery metadata for the CrossingKey MCP server.

Production MCP endpoint:

https://mcp.crossingkeyintelligence.com/mcp

Canonical MCP Registry identity:

`com.crossingkeyintelligence/revenue-mcp`

Current public discovery version:

`2.2.0`

## What CrossingKey MCP is

CrossingKey MCP is a machine-commerce MCP endpoint designed for AI agents and other authorized software clients to discover capabilities, inspect pricing, authorize bounded purchases, receive entitlements, execute deterministic paid capabilities, and verify fulfillment through machine-readable receipts.

Directories, registries, agents, crawlers, and integrations should prefer the canonical identity:

`com.crossingkeyintelligence/revenue-mcp`

rather than the ambiguous short name `revenue-mcp`.

## Transport

- Model Context Protocol
- Streamable HTTP
- Production endpoint: `https://mcp.crossingkeyintelligence.com/mcp`

## Core capabilities

- Offer discovery
- Capability discovery
- Pricing discovery
- Stripe checkout discovery
- Prepaid-credit commerce
- Native x402 payment flows
- Payment preflight
- Signed payment authorization
- Payment verification and settlement
- Purchase creation
- Entitlement issuance
- Entitlement redemption
- Deterministic XKEY execution
- Result hashing
- Receipt binding
- Fulfillment status
- Machine-readable fulfillment evidence
- Idempotent purchase handling
- Replay resistance
- Authenticated bounded paid execution

## x402 support

CrossingKey MCP supports native x402 machine-commerce flows.

Current validated test-network profile:

- x402 generation: v2
- Scheme: `exact`
- Network: `eip155:84532`
- Chain: Base Sepolia
- Asset: Base Sepolia USDC
- Receiver: locked by server configuration
- Payment challenge: HTTP 402
- Signed authorization: supported
- Verification: supported
- Settlement handling: supported
- Purchase creation: supported
- Entitlement issuance: supported
- Receipt binding: supported
- Replay protection: supported
- Logical-request idempotency: supported

Base mainnet is not enabled by this public metadata.

No agent is granted unrestricted spending authority by CrossingKey MCP.

## Execution model

A typical paid machine-commerce flow is:

Agent discovers capability
→ agent evaluates price and requirements
→ MCP returns payment requirements
→ authorized payer signs payment authorization
→ payment rail verifies and settles
→ CrossingKey creates or resolves purchase
→ entitlement is issued
→ deterministic capability executes
→ result hash is generated
→ receipt binds payment, purchase, entitlement, execution, and result
→ response is returned to the authorized client

Logical retries using the same idempotency key should resolve to the original purchase/result rather than creating duplicate settlement or duplicate fulfillment.

Replayed signed payment authorizations should be rejected.

## XKEY

CrossingKey XKEY execution is designed to be bounded and deterministic.

The public surface may expose validation or execution capabilities, but it does not expose arbitrary shell access or unrestricted filesystem access.

Deterministic result handling may include:

- normalized input
- bounded execution
- result hashing
- entitlement binding
- receipt generation
- fulfillment verification

## Stripe and prepaid credits

CrossingKey also supports separate commerce paths using Stripe-hosted checkout and prepaid credits.

These are distinct from native x402 payment authorization and settlement.

Discovery remains free unless a capability explicitly declares otherwise.

Paid execution requires authorization.

## Fulfillment integrity

Digital fulfillment readiness requires expected artifacts and machine-readable integrity evidence.

Where applicable, SHA-256 digests are used to verify artifact integrity against fulfillment manifests.

Paid/private artifacts are not stored in this public repository unless intentionally published.

## Security model

The system is designed around:

- bounded capabilities
- explicit authorization
- locked payment receiver configuration
- idempotency
- replay resistance
- entitlement checks
- deterministic execution
- result hashing
- receipt binding
- sanitized responses
- separation of public metadata from private credentials

No private keys, wallet secrets, Stripe secrets, API keys, seed phrases, or mnemonics belong in this repository.

The deployment follows an NSA-aligned hardening approach where practical. This does not imply NSA certification, endorsement, or formal compliance.

## Agent-discovery metadata

Recommended discovery terms:

- MCP
- agent commerce
- machine commerce
- x402
- x402 v2
- Base
- Base Sepolia
- USDC
- payments
- paid execution
- prepaid credits
- entitlements
- deterministic execution
- XKEY
- receipts
- fulfillment
- replay protection
- idempotency
- machine-readable verification

Canonical endpoint:

`https://mcp.crossingkeyintelligence.com/mcp`

Canonical registry identity:

`com.crossingkeyintelligence/revenue-mcp`

## CrossingKey Intelligence

Operating online under the handle `crossingkey_`.

**intelligence is the standard.**
