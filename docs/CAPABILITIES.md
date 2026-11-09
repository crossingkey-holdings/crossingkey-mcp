# CrossingKey MCP — Capabilities

Canonical identity: `com.crossingkeyintelligence/crossingkey-mcp`  
Source version: `5.0.1`  
MCP protocol: `2025-11-25`

CrossingKey's current paid computation path is direct x402 exact payment. Prepaid request-credit pack sales are disabled. Historical paid balances remain protected through a separately named authenticated compatibility path.

## Free discovery tools (7, anonymous)

| Tool | What it does | Cost |
|---|---|---:|
| `provider.describe` | CrossingKey identity, commerce model, rails and discovery sequence | Free |
| `offers.list` | Public offer and paid capability metadata | Free |
| `requirements.check` | Prerequisites for one item | Free |
| `cost.estimate` | Known price, estimate only | Free |
| `result.preview` | Result shape only, never paid output | Free |
| `execution.preflight` | Final no-charge authorization checkpoint | Free |
| `credits.options` | Legacy compatibility status; returns an empty pack list | Free |

The discovery sequence never starts payment or execution. A successful preflight stops at `READY_FOR_HUMAN_AUTHORIZATION`. The legacy status tool does not sell or provision credits.

## Direct x402 paid capabilities (13)

| Tool | Price | Purpose |
|---|---:|---|
| `x402.compatibility_audit` | $1.00 USDC | Check x402 v1/v2 compatibility |
| `mcp.schema_audit` | $1.00 USDC | Review MCP tool schemas and input contracts |
| `openapi.quality_audit` | $1.00 USDC | Evaluate OpenAPI structure |
| `machine_commerce.readiness_audit` | $2.00 USDC | Check machine-commerce discovery and health surfaces |
| `artifact.integrity_manifest` | $0.10 USDC | Build a SHA-256 artifact manifest |
| `hash.encode` | $0.01 USDC | SHA-256 text digest |
| `secret.scan` | $0.01 USDC | Heuristic credential-pattern scan |
| `pii.scan` | $0.01 USDC | Heuristic personal-data-pattern scan |
| `json.repair` | $0.01 USDC | Conservative JSON validation and repair |
| `prompt.audit` | $0.01 USDC | Heuristic prompt-structure audit |
| `mcp.launch_audit` | $9.00 USDC | Bounded MCP endpoint launch audit |
| `x402.purchase_path_audit` | $19.00 USDC | Bounded x402 purchase-challenge audit |
| `xkey.validate` | $0.10 USDC | Bounded XKEY intake validation |

Calling a paid MCP tool returns a payment challenge. The challenge call itself does not charge or execute. Authorized signing and payment occur outside ordinary MCP computation, followed by the bounded paid HTTP execution path. Base mainnet is configured in the current source candidate; live settlement must be verified separately.

## Public marketplace discovery (8, anonymous)

- `marketplace.describe`
- `provider.apply`
- `provider.get`
- `capability.get`
- `capability.search`
- `catalog.list`
- `commerce.quote`
- `creator.apply`

These tools expose marketplace metadata and applications. They do not authorize paid execution. The current marketplace has no active providers or active public capabilities, so the marketplace catalog is not currently a source of purchasable offers.

## Authenticated verification and role-gated tools

Authenticated sessions may expose read-only verification tools:

- `approval.verify`
- `idempotency.inspect`
- `receipt.verify`
- `entitlement.inspect`

Marketplace buyers, providers and administrators receive only the operations allowed by their bound role. Human purchase approval is minted by the local operator and is not exposed as an agent-controlled MCP action.

## Legacy compatibility

`xkey.validate.legacy` remains available only to authenticated customers with an existing paid-credit credential. It does not create a new credit purchase and does not settle an x402 payment. The legacy credit-priced XKEY descriptor remains in compatibility metadata, but new XKEY executions should use the direct x402 `xkey.validate` route.

New prepaid-credit pack sales are disabled. Existing customer balances are retained for compatibility; they are not a current product or recommended purchase path.

## Payment and authority boundaries

- Seller wallet is receiver-only.
- Discovery, estimates, previews and preflight are no-charge.
- Paid execution requires explicit human authorization and verified payment.
- Idempotency and replay protection prevent duplicate settlement.
- Receipts and entitlements are buyer-bound and inspectable.
- Unknown settlement outcomes require reconciliation; the server must not blindly retry settlement.
