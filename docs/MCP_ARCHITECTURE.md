# CrossingKey MCP — Architecture

## Process layout

Single Node.js ESM process (`server.mjs`). Express serves:

| Route | Purpose |
|---|---|
| `POST /mcp` | MCP Streamable HTTP endpoint (initialize, tools, resources) |
| `GET /health` | Liveness probe |
| `POST /api/x402/:capability` | Out-of-band paid execution (signed payment header required) |
| Stripe webhook, checkout, delivery, download routes | Credit packs and offer fulfillment (HTTP, not MCP) |

The MCP endpoint listens on `127.0.0.1`; production terminates TLS at the
operator's reverse proxy.

## MCP server construction

`makeMcpServer(authContext, marketplaceContext, rateKey)` builds a per-session
`McpServer` with:

- **Server instructions** — the free/paid separation and stop-before-payment
  rule, delivered in the `initialize` result.
- **21 anonymous tools** — 7 free discovery, 5 paid x402 challenge tools,
  `xkey.validate`, 8 public marketplace tools.
- **Role-filtered marketplace tools** — authenticated sessions additionally
  see verification tools (`approval.verify`, `idempotency.inspect`,
  `receipt.verify`, `entitlement.inspect`) and role-gated management tools.
- **3 resources** — `crossingkey://discovery-guide`,
  `crossingkey://commerce-policy` (static), and the
  `crossingkey://capability/{name}` template (per-capability instructions).
- **Tool annotations** — `readOnlyHint`, `destructiveHint`, `openWorldHint`
  set per tool; paid and credit-gated tools carry `idempotentHint: true`.

Every tool registers an `outputSchema` (Zod → JSON Schema) and returns
`structuredContent`; paid challenges return challenge-shaped structured
content rather than executing.

## Sessions and state

- Sessions are memory-resident, keyed by `mcp-session-id`, and bound to the
  identity resolved at initialization (anonymous, `ck_` credit principal, or
  marketplace role). Credential/session mismatch is rejected (`-32001`).
- Durable state lives in `data/`: the funnel SQLite DB, commerce JSON,
  marketplace JSON, credit accounts, and catalog files.
- **Journal-before-settlement:** paid intents are durably recorded before any
  external settlement; reconciliation records track unknown outcomes.

## Request lifecycle (paid x402)

1. MCP tool call → input validation → returns the x402 challenge (no spend).
2. Out-of-band `POST /api/x402/:capability` with payment header →
   header presence check → `402` challenge if absent.
3. Payment decode + strict validation → idempotency lookup → replay check.
4. Journal intent → verify → settle via facilitator → execute → finalize
   (receipt + entitlement + revenue event) → return result with settlement
   header.
5. Any unknown outcome → reconciliation state; errors are client/server
   classified (`invalid_payment_or_request` vs `settlement_or_execution_failed`).

## Module map

- `server.mjs` — HTTP routes, MCP server construction, tool/resource
  registration, session management.
- `lib/machine-commerce.mjs` — x402 payment validation, settlement,
  `safeFetch` (SSRF defense + 256KB cap), paid capability catalog wiring.
- `lib/marketplace.mjs` — marketplace state: approvals, purchases, receipts,
  entitlements, idempotency, quotes, verification helpers.
- `lib/marketplace-tools.mjs` — MCP registration for marketplace tools with
  role-based visibility.
- `lib/mcp-manifest.mjs` — canonical tool-name lists and the MCP manifest.
- `lib/discovery.mjs` — free discovery handlers (describe/list/estimate/
  preview/preflight/credits).
- `lib/paid-capability-catalog.mjs` — the 5 paid x402 capabilities + pricing.
- `lib/onchain-verifier.mjs`, `lib/gate1b-*.mjs` — settlement verification
  and the Gate1B production adapter.

## Tests

`npm test` runs the full suite (92 tests as of v3.0.0 upgrade): protocol
contracts, discovery naming, verification surfaces, transport security,
marketplace, machine commerce, and regression tests. Targeted suites live in
`tests/`. `scripts/agent-comprehension-test.mjs` walks the server the way a
new agent would (19 checks).
