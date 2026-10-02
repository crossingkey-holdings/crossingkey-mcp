# CrossingKey MCP — Security Model

## Principles

- **Receiver-only payments.** The server never initiates spending. Money moves
  only after explicit human authorization, via Stripe payment links, prepaid
  `ck_` request credits, or x402 USDC on Base.
- **Human authorization is enforced server-side.** Prose or model compliance
  is not a security boundary. Marketplace purchases require a prior
  buyer-bound human approval naming the exact capability, input, idempotency
  key, and quote. Approval minting is local-operator/CLI only and is never
  exposed over MCP.
- **Fail closed.** Unknown capabilities, ambiguous payment headers, replayed
  payments, conflicting idempotency keys, and unverifiable payments are
  rejected with error codes — never silent charges.

## Transport

- The MCP endpoint listens on `127.0.0.1` (behind the operator's reverse
  proxy in production).
- **Origin validation on `POST /mcp`:** requests carrying an `Origin` header
  whose host does not match the request host are rejected with `403`
  (`-32000`). This is DNS-rebinding defense. Non-browser MCP clients send no
  `Origin` header and are unaffected.
- Sessions are memory-resident and bound to the identity presented at
  initialization (`mcp-session-id`). A session cannot be adopted by a
  different credential.
- Rate limiting is applied per session key; anonymous discovery is bounded.

## Input and execution safety

- All tool input is Zod-validated at the protocol layer. Malformed input is
  rejected before any handler runs.
- Tool errors return `{error_code, message, hint}` with `isError: true`.
  Stack traces, key material, payment payloads, and request bodies never
  leave the server.
- Server-side logging is structured (`{tag, error, message}` truncated to
  240 chars). No stacks, tokens, or payment payloads are logged.
- `safeFetch` (used by audit capabilities that fetch agent-supplied URLs):
  credential-free HTTP(S) only, DNS resolution with private/internal IP
  rejection (SSRF defense), redirects refused, 8s timeout, and a **256KB
  response cap** enforced while streaming.

## Payment safety (x402)

- Payment headers are base64url JSON decoded and strictly validated: version,
  scheme (`exact` only), network, asset, amount, pay-to/receiver, and nonce
  format.
- Base Sepolia is the default network. Base mainnet settles only when the
  operator sets `CK_ENABLE_MAINNET=true`.
- **Idempotency:** every paid call requires a buyer-generated idempotency key
  (8–160 chars, `[A-Za-z0-9._:-]`). Retrying with the same key returns the
  stored result (`duplicate: true`) instead of a new charge; reuse with a
  different request or payment hash is rejected as a conflict.
- **Replay protection:** payment replay keys are recorded; replayed payments
  are rejected.
- **Journal-before-settlement:** the purchase intent is durably recorded
  before any external settlement. If settlement or execution outcome is
  unknown, the record enters reconciliation (`RECONCILIATION_REQUIRED`) —
  settlement is never retried blindly, and an arbitrary external side effect
  is never repeated merely because its owner died.

## Receipts, entitlements, approvals

- Every paid execution produces a verifiable receipt (hash-chained;
  `receipt.verify`) and a bounded entitlement (`entitlement.inspect`).
- Receipt/entitlement/approval/idempotency inspection tools are read-only and
  visible only to authenticated sessions. `idempotency.inspect` never creates
  state. Cross-buyer access is denied: buyers can only inspect their own
  records.
- Approval verification is buyer-bound: an approval only authorizes the buyer
  it was minted for.

## What is NOT in scope of this server

- The server does not hold or spend user funds, does not sign on behalf of
  users, and does not initiate checkout. Payment signing happens outside
  ordinary MCP computation under human authorization.
- No real-payment tests are run in development; payment paths are verified
  against fixtures and protocol contracts only.

## Operational notes

- `data/` holds durable state (SQLite funnel DB, commerce/marketplace JSON).
  Back it up; the server treats it as the source of truth for reconciliation.
- Stripe webhook processing is fail-closed: unverifiable signatures are
  rejected and logged without details.
