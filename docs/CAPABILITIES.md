# CrossingKey MCP — Capabilities

Canonical identity: `com.crossingkeyintelligence/crossingkey-mcp`
Package: `crossingkey-mcp` v3.0.0 (ESM). MCP protocol `2025-11-25`.

All tools use the `resource.action` naming convention. Every tool exposes an
`outputSchema` and `structuredContent`; tool errors use the
`{error_code, message, hint}` shape.

## Free discovery tools (7, anonymous)

| Tool | What it does | Cost |
|---|---|---|
| `provider.describe` | CrossingKey identity, commerce model, rails | free |
| `offers.list` | Public offers and paid capabilities, metadata only | free |
| `requirements.check` | Prerequisites for one `item_id` | free |
| `cost.estimate` | Known price; ESTIMATE_ONLY, never a charge | free |
| `result.preview` | Result shape only; paid output never revealed | free |
| `execution.preflight` | Final no-charge decision point | free |
| `credits.options` | Prepaid request-credit packs | free |

## Paid x402 challenge tools (5, anonymous)

Calling these spends nothing. Each returns an x402 **challenge**
(`payment_required: true`, price, asset, network, pay-to address,
`execution_url`, `PAYMENT-REQUIRED` header, `settlement_expectations`,
`confirmation_expectations`, and an instruction to obtain authorized signing
outside ordinary MCP computation). Execution is an out-of-band HTTP POST to
`/api/x402/:capability` with a signed payment header and a unique
`idempotency_key`.

| Tool | Price (USDC, Base) | What it does after payment |
|---|---|---|
| `x402.compatibility_audit` | $1.00 | Audits an x402 endpoint for v1/v2 compatibility defects |
| `mcp.schema_audit` | $1.00 | Audits MCP tool schemas for agent-readiness defects |
| `openapi.quality_audit` | $1.00 | Scores an OpenAPI spec for machine-readability |
| `machine_commerce.readiness_audit` | $2.00 | Probes a base URL for commerce-readiness signals |
| `artifact.integrity_manifest` | $0.10 | Builds a SHA-256 manifest for supplied artifacts |

Default network is Base Sepolia. Base mainnet settles only when the operator
sets `CK_ENABLE_MAINNET=true`.

## Credit-gated tool (1)

| Tool | What it does |
|---|---|
| `xkey.validate` | Validates one `ck_` request credit; commits 1 credit on success, 0 on failure. Idempotent (`idempotentHint: true`). Never reveals key material. |

## Marketplace tools — public (8, anonymous)

| Tool | What it does |
|---|---|
| `marketplace.describe` | How the marketplace works |
| `provider.register` | Register as a provider (application) |
| `provider.get` | One provider's public profile |
| `capability.get` | One capability's detail |
| `capability.search` | Search active public capabilities |
| `catalog.list` | List the active public catalog |
| `commerce.quote` | Authoritative price breakdown for a capability (includes a quote hash) |
| `creator.apply` | Apply as a creator |

## Marketplace tools — authenticated

Visible only to authenticated sessions; some are role-restricted:

| Tool | Role | What it does |
|---|---|---|
| `approval.verify` | any authenticated | Inspect a human approval (buyer-bound) |
| `idempotency.inspect` | any authenticated | Inspect an idempotency record; **never creates state** |
| `receipt.verify` | any authenticated | Verify a receipt's integrity (hash chain) |
| `entitlement.inspect` | any authenticated | Inspect an entitlement (bounded uses) |
| `capability.purchase` | buyer | Execute a paid marketplace purchase: requires prior human approval naming the exact capability, input, idempotency key, and quote, plus verified x402 payment |
| `job.status`, `receipt.get` | authenticated | Purchase job and receipt lookup |
| `capability.register`, `settlement.get_balance`, `settlement.list_allocations` | provider/admin | Provider-side management |
| `provider.set_status`, `capability.set_status`, `settlement.mark_settled` | admin | Admin-only controls |

Approval **minting** is local-operator/CLI only — it is never exposed over MCP.

## Resources

| URI | Access | Content |
|---|---|---|
| `crossingkey://discovery-guide` | public | The free discovery sequence |
| `crossingkey://commerce-policy` | public | Free/paid separation, receiver-only payments, authorization, idempotency, receipts |
| `crossingkey://capability/{name}` | public | Per-capability instructions for one offer or paid capability |

No MCP prompts are registered.
