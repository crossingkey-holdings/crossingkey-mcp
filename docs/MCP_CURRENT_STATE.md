# MCP Current State — CrossingKey MCP 3.0.0

**Status:** inspect-only audit complete. This document is a factual baseline, not a
proposal. Every claim below was verified against the source snapshot on 2026-10-01
(see *Provenance*). Claims that could not be verified are marked
`NOT TESTED` / `UNKNOWN`. Nothing in this document authorizes a change.

## 1. Provenance

- **Authoritative source:** `crossingkey-mcp-for-muse.tar_0_cq79.gz`,
  SHA-256 `0529183c380d56967375c2ff7d4bf75edc74c75d894581b36c3509a3c97ecb24`
  (verified 2026-10-01). Exported by the owner from
  `/home/founder/Downloads/crossingkey-mcp`. Secrets, `.env*`, top-level
  `node_modules`, and part of Git object storage were intentionally excluded.
- **Extraction root:** `~/workspace/crossingkey-mcp/crossingkey-mcp`
  (`CROSSINGKEY_MCP_ROOT`).
- **Identity:** `package.json` name `crossingkey-mcp`, version `3.0.0`, `type:
  module`. Canonical identity `com.crossingkeyintelligence/crossingkey-mcp`
  appears in `server.mjs`, `server.json`, README, tests, and discovery metadata.
- **Git state:** degraded — `.git/HEAD` points at
  `refs/heads/fix/crossingkey-openai-agent-commercial-discovery`
  (`07ed7c25…`), remote `https://github.com/crossingkey-holdings/crossingkey-mcp.git`;
  `.git/objects` was excluded, so `git status` / `git rev-parse HEAD` fail.
  Do not initialize a replacement history; use a pristine-copy diff for change
  tracking.
- **Runtime baseline:** Node `v24.20.0`, npm `10.9.4`. `npm ci` succeeded
  (124 packages; MCP SDK installed at **1.30.0** vs declared `^1.25.0`).
  `node --check server.mjs` PASS. `tests/discovery.test.mjs` 4/4 PASS.
  **Full baseline `npm test`: 76/76 PASS, 0 fail (2026-10-01).**
- **Public-behavior comparison:** `GET /health` and `/.well-known/mcp.json` on
  `https://mcp.crossingkeyintelligence.com` were fetched read-only on 2026-10-01
  for behavioral comparison only. Used only to confirm live/public shape, never to
  reconstruct source.

## 2. Architecture

- **Entry point:** `server.mjs`. Express 5.1.0 app + MCP `McpServer` +
  `StreamableHTTPServerTransport` (SDK 1.30.0).
- **MCP endpoint:** `POST /mcp` (initialize / session messages), `GET /mcp`
  (SSE stream), `DELETE /mcp` (session termination). `server.mjs:1298`.
- **Session model:** stateful. A fresh `McpServer` instance is built per
  `initialize` (`makeMcpServer()`, `server.mjs:1099`). Sessions are held in
  in-memory maps (`transports`, `sessionPrincipals`, `marketplaceSessionPrincipals`)
  keyed by `mcp-session-id`. Auth identity is bound at initialize: a Bearer
  `ck_` principal resolved once and pinned for the session's lifetime; anonymous
  sessions stay anonymous. Session/auth mismatch → `401` JSON-RPC `-32001`;
  non-initialize POST without session → `400` `-32000`.
- **Bind:** `app.listen(PORT,'127.0.0.1')` (`server.mjs:1415`, default `PORT
  3000`). The service expects a reverse proxy (Cloudflare tunnel) in front.
- **Releases:** `MCP_RELEASE_VERSION='3.0.0'`, `MCP_PROTOCOL_VERSION='2025-11-25'`
  (`lib/mcp-manifest.mjs`). Protocol negotiation itself is SDK-handled; SDK 1.30
  supports the declared version.
- **Request hygiene:** `express.json({limit:'1mb'})` (`server.mjs:441`);
  correlation-ID middleware honoring `x-request-id`/`cf-ray`, emitting
  `X-CrossingKey-Request-ID` (`server.mjs:640-686`); funnel counters for
  `initialize` / `tools/list` / `tools/call`.
- **DNS rebinding protection:** ABSENT. Zero `origin` handling in `server.mjs`;
  transport created without `allowedOrigins`. Mitigated only by the 127.0.0.1
  bind. Verdict: **PARTIAL** (relies on deployment posture, not code).
- **Server instructions:** `MCP_SERVER_INSTRUCTIONS` (`lib/mcp-manifest.mjs`,
  ~7 lines): discover → estimate → preview → preflight → **stop before payment
  or execution**; explicit human authorization required before any purchase,
  signing, transfer, spending, entitlement creation, or paid execution;
  canonical sequence `provider.describe → offers.list → requirements.check →
  cost.estimate → result.preview → execution.preflight → HUMAN AUTHORIZATION →
  payment/entitlement → execution → receipt`; closes with "guidance only…
  server-side controls remain authoritative." Honest about being guidance-only.
  Gap: names neither the paid tools nor the x402 off-MCP execution mode, nor
  receipt/entitlement retrieval.

## 3. MCP tool surface — the live surface is 12 tools

Registrations happen only in `makeMcpServer()` (`server.mjs:1102-1265`).
No tool passes `outputSchema` or `idempotentHint`; structured output is
delivered via `structuredContent` + `content:[{type:'text'…}]`.

### 3.1 Free discovery tools (6) — `server.mjs:1102-1108`
All with `annotations: {readOnlyHint:true, destructiveHint:false, openWorldHint:false}`.

| Tool | Input schema (zod, strict) | Effect guarantee in description |
|---|---|---|
| `provider.describe` | `{}` | "FREE read-only… Use this before selecting an offer or capability." Returns `{provider, sequence, manifest, stopBeforePayment:true}` |
| `offers.list` | `{query? (≤160), limit? 1–50 default 20}` | "This tool never starts payment or execution." |
| `requirements.check` | `{item_id: string 1–160}` | "This tool never authorizes or starts payment or execution." |
| `cost.estimate` | `{item_id: string 1–160}` | "This tool never creates checkout, reserves funds, or contacts a facilitator." |
| `result.preview` | `{item_id: string 1–160}` | "This tool never executes a capability or creates an entitlement or receipt." |
| `execution.preflight` | `{item_id: string 1–160}` | "Returns READY_FOR_HUMAN_AUTHORIZATION only; it never authorizes, purchases, settles, executes, or creates records." |

Descriptions are good on side-effect denial, thin on selection criteria (when to
use `offers.list` vs `provider.describe`; what `item_id` refers to).

### 3.2 Paid x402 tools (5) — `server.mjs:1115-1183`, from `X402_CAPABILITIES`
(`lib/paid-capability-catalog.mjs:31-190`). All
`{readOnlyHint:false, destructiveHint:false, openWorldHint:true}`. Each handler
returns a **PAYMENT-REQUIRED challenge envelope** (structuredContent:
`payment_required:true, execution_mode:'x402_http', capability, input, price,
asset, network, pay_to, execution_url, payment_required_header, instruction`).
**Calling the tool spends nothing**; execution is an HTTP POST with
`PAYMENT-SIGNATURE` to `execution_url` (`/api/x402/<capability>`).

| Tool | Price | Input |
|---|---|---|
| `x402.compatibility_audit` | $1.00 USDC (1,000,000 atomic) | `{url}` |
| `mcp.schema_audit` | $1.00 USDC | `{tools: [...]}` |
| `openapi.quality_audit` | $1.00 USDC | `{spec: {...}}` |
| `machine_commerce.readiness_audit` | $2.00 USDC | `{url}` |
| `artifact.integrity_manifest` | $0.10 USDC (100,000 atomic) | `{artifacts: [{name, content}]}` |

### 3.3 Prepaid tool (1) — `server.mjs:1186-1265`

`xkey.validate` ("Validate structured XKEY intake"). Requires an authenticated
`ck_` principal (`authentication_required` / `credential_revoked` otherwise).
Commits one prepaid credit only on verified success; validation failures
release the reserved credit. Backed by sqlite
`data/xkey_paid_credits.sqlite3`. `readOnlyHint:false`, `openWorldHint:false`.
`idempotentHint` not set despite requiring `idempotency_key`.

### 3.4 Dead surface: 17 marketplace tools defined but NEVER registered

`lib/marketplace-tools.mjs:43-98` exports `registerMarketplaceTools` with:
`marketplace.describe`, `provider.register`, `provider.get`,
`provider.set_status`, `capability.register`, `capability.set_status`,
`capability.get`, `capability.search`, `catalog.list`, `commerce.quote`,
`capability.purchase`, `job.status`, `receipt.get`, `creator.apply`,
`settlement.get_balance`, `settlement.list_allocations`,
`settlement.mark_settled`. It is **imported at `server.mjs:26` but never called**
in the current `server.mjs` (only call site is
`.backup-tdqs-20260922-055746/server.mjs:601`). These have role-gated
visibility (`adminOnly`, `providerOrAdmin`, `authenticated`, `buyerOnly`) and
strong annotations (`_meta.humanAuthorizationRequired` on `capability.purchase`),
but none of it is live. The canonical `capability.get` / `capability.purchase`
/ `commerce.quote` / `marketplace.describe` names exist only as dead code.
Marketplace logic itself is exercised: `tests/marketplace.test.mjs`,
`tests/marketplace-http.test.mjs`, `tests/marketplace-security.test.mjs`.

### 3.5 Resources / prompts

**Absent.** Zero `registerResource` / `registerPrompt` calls. The MCP server
advertises only the `tools` capability.

### 3.6 Historical tool names vs reality

Present: `provider.describe`, `offers.list`, `cost.estimate`, `result.preview`,
`requirements.check`, `execution.preflight`, `xkey.validate`.
Absent as tools: `credits.options` (only `GET /api/credits/balance`, requires a
`ck_` principal), `services.list` (backing `data/request_services.json` absent),
`capabilities.list`, `capability.get`, `capability.quote`, `payment.methods`,
`purchase.status`, `entitlement.inspect`, `receipt.verify`, `payment.verify`,
`health` (only `GET /health`), `machine_capability.quote` (referenced by a tool
description in `marketplace-tools.mjs:86`; **does not exist anywhere else**).

## 4. Capability-naming inconsistency (verified agent-visible misinformation)

`publicCapabilityList()` (`server.mjs:230-251`) is the agent-visible capability
inventory used by `requirements.check`/`cost.estimate`/`result.preview`
(`server.mjs:263,279,308`). Its free list advertises:

- `offer.list` — registered tool is `offers.list`
- `requirement.check` — registered tool is `requirements.check`
- `credit.options` — **no such MCP tool** (HTTP only, authenticated)
- `service.list` — **no such MCP tool** (backing data file absent)

These names leak into item resolution, so an agent following the advertised
inventory calls names that do not exist on the MCP surface. The legacy-name
filter (`LEGACY_TOOL_NAMES`, `server.mjs:56`) only covers
`list_stripe_offers`, `get_stripe_checkout_link`, `get_fulfillment_status` —
not these.

## 5. Commerce

### 5.1 Capability model — `lib/paid-capability-catalog.mjs`
`assertPaidCatalog()` enforces exactly 5 x402 + 1 prepaid at import. x402
fields: `name, title, description, rail:'x402', chargingModel:'x402_exact',
priceUsd, amount (atomic USDC), asset:'USDC', executionPath, tags, inputSchema,
inputJsonSchema (frozen), output`. Prepaid: `xkey.validate`,
`rail:'prepaid_request_credit'`, `priceCredits:1`. Absent per-capability fields:
`version`, `status`, `category`, `approval_policy`, `side_effects`,
`requirements`, `estimated_execution`, `delivery`, `examples`,
`execution_transport`.

### 5.2 x402 — `lib/machine-commerce.mjs` (custom v1/v2 implementation)
- Only SDK import is `@x402/extensions/bazaar` (discovery extension). The v1/v2
  protocol is implemented custom: `canonicalRequirement` (v1 `maxAmountRequired`
  + `base`/`base-sepolia`; v2 `amount` + CAIP-2), `paymentRequired` (v1 JSON 402
  body vs v2 base64 `PAYMENT-REQUIRED` header), `canonicalizePayment`,
  `facilitatorCall` → `{facilitatorUrl}/{verify|settle}`.
- **Facilitator defaults to `https://x402.org/facilitator`**, overridable via
  `X402_FACILITATOR_URL` — a third-party trust dependency not surfaced in
  agent-visible metadata.
- **Network:** default `eip155:84532` (Base Sepolia); mainnet `eip155:8453`
  only when `CK_ENABLE_MAINNET==='true'` (strict). `enforcePolicy` throws
  `Payment network mismatch` / `Base mainnet is disabled until the Sepolia
  gate passes`. **No silent fallback.** Independent on-chain verification
  (`verifyOnchain`) is effectively mainnet-only (`eth_chainId === 0x2105`,
  Base USDC `0x8335…A02913`, ≥2 confirmations default); on Sepolia it returns
  `RECEIPT_MISMATCH`. A tx hash alone is never "verified"; `verified:false` is
  the default.
- **Receiver:** `LOCKED_RECEIVER` in source, but `server.mjs` honors
  `process.env.CK_RECEIVER_ADDRESS || LOCKED_RECEIVER` — env can override the
  "locked" constant. `enforcePolicy()` requires `payment.payTo` and
  `authorization.to` to equal the configured receiver (case-insensitive).
- **State machine (Gate1B):** payment-request → verify (`canonicalizePayment`
  → `enforcePolicy` → reconciliation anchor → facilitator `verify`) →
  replay/idempotency (`replayKey = network:nonce`, `REPLAY_DETECTED`;
  idempotency conflict vs `duplicate:true`) → settle (never twice; failure →
  `RECONCILIATION_REQUIRED` with ERC-3009 log reconciliation) → execute
  (crash → `EXECUTION_RECONCILIATION_REQUIRED`, no re-execution) → receipt +
  entitlement (`finalize()`: `ck_purchase_*`/`ck_ent_*`/`ck_rcpt_*` UUIDs,
  receipt `ck/1` with `resultHash=sha256(result)`, kennekarte HMAC payload,
  entitlement `status:'consumed'`, `usesRemaining:0`).
- **Marketplace quote:** `commerce.quote` → `{capability, price split, network,
  currency, feeBps, paymentRequirement:{v1,v2}, quoteHash,
  humanAuthorizationRequired:true}`. "A quote grants no entitlement and
  performs no execution." **No `quote_id`, no expiration** — only a content
  hash. The *approval* (`approvePurchase`, local CLI only —
  `scripts/marketplace-admin.mjs:21`, never an MCP tool) is time-bound
  (≤1h), single-use, bound to buyer+capability+idempotencyKey+inputHash+quoteHash;
  `assertApproval` throws `HUMAN_AUTHORIZATION_REQUIRED`. Approvals cannot be
  minted remotely — server-side enforced (`lib/marketplace.mjs:106-118`).
- **Semantic separation:** `cost.estimate` vs `commerce.quote` vs 402
  PAYMENT REQUEST vs VERIFIED SETTLEMENT are distinct code paths with distinct
  non-mutating guarantees. But: first-party x402 capabilities have **no quote
  stage** (take-it-or-leave-it fixed price), quotes are not time-bound, and
  three commerce universes (first-party x402, marketplace creator capabilities,
  Stripe rails) share tool listings with no machine-readable
  `approval_policy`/`payment_flow`/`rail` field distinguishing them.
- **Stripe (read-only audit):** `stripe ^18.5.0`; client constructed only if
  `STRIPE_SECRET_KEY` set, else 503s. Webhook `constructEvent` verification;
  fulfillment idempotent via `processed_sessions[session.id]`. No test/live
  branching — mode is implicit in the key. **NOT TESTED** against real Stripe
  (no credentials, no real payment tests; per brief this is forbidden).

### 5.3 Entitlements & receipts
- Created only in `finalize()`, after successful execution — never on quote,
  estimate, or payment intent. Stored in `data/machine_commerce.json`
  (durable atomic writes, `flock` guardian, `0600`). `machine-commerce.mjs`
  `atomicWrite` lacks the `wx` exclusive flag and fsync used by
  `gate1b-store` — **PARTIAL** vs the stronger store.
- `verifyReceipt` (result-hash recomputation, pure read-only) and
  `inspectEntitlement` exist only as internal functions — **no MCP tool or HTTP
  route exposes them** (only marketplace `receipt.get`, buyer-bound, unregistered).
- Minor tension: kennekarte claims `rights:{executions:1, downloads:3}` while
  the entitlement record is born `consumed`/`usesRemaining:0` (proof-of-purchase,
  not reusable).

## 6. Security controls (as implemented)

| Control | Verdict |
|---|---|
| SSRF: agent-supplied URLs (`safeFetch`, audits) | VERIFIED — http/https-only, no creds, all DNS IPs resolved and checked against private ranges, `redirect:'error'`, 8s timeout (`machine-commerce.mjs:72-76`) |
| SSRF: provider endpoints (`validateEndpoint`) | VERIFIED — https-only, port 443, DNS-pinned lookup defeats rebinding, 256KB response cap (`marketplace-adapters.mjs:10-36`) |
| SSRF: RPC (`rpcAuthority`) | VERIFIED — requires `https:` (`gate1b-production-adapter.mjs:59`) |
| **Response size cap on `safeFetch`** | **ABSENT** — full `res.text()` buffered; malicious target can force unbounded memory (`machine-commerce.mjs:76`) |
| Operator egress URLs (facilitator, base RPC) through `validateEndpoint`/`safeFetch` | ABSENT (operator config, not agent input; inconsistent) |
| Input validation | VERIFIED — `.strict()` zod everywhere; `boundedJson` (64KB, 4000-node/16-depth, rejects `__proto__`) on purchase/approval inputs |
| Shell injection (`spawnSync` fixed python module, `shell:false`) | VERIFIED |
| SQL injection (`node:sqlite` prepared + bound params; static DDL) | VERIFIED |
| Path traversal (`artifactInfo`/`safeDeliveryPath` realpath containment, 128MB cap) | VERIFIED |
| Archive extraction of untrusted archives | None in codebase |
| Idempotency / replay | VERIFIED — nonce-keyed `replayKeys`, journal-before-settle, crash → reconcile-only |
| Approvals | VERIFIED server-side — local CLI only, single-use ≤1h, bound, consumed at purchase; `capability.purchase` carries `_meta.humanAuthorizationRequired` but is unregistered |
| Receipt HMAC (kennekarte, env `CK_KENNEKARTE_HMAC_SECRET`; claim tokens, `CLAIM_SECRET`) | VERIFIED |
| Receipt tamper-evidence (`resultHash` recompute) | VERIFIED |
| Download integrity (`fileSha256` match, HMAC token, count cap) | VERIFIED |
| Secret logging / error leakage | VERIFIED clean — generic errors, no `.stack`; minor: x402 route returns full `err.message` (safe codes today, untruncated) |
| Randomness (`crypto.randomUUID` everywhere; zero `Math.random`) | VERIFIED |
| `.gitignore` + `scripts/scan-marketplace-secrets.mjs` | VERIFIED |

## 7. Discovery surfaces

- `/.well-known/mcp.json` (`server.mjs:868`): dynamically generated;
  `canonicalId`, `version`, `transport:streamable-http`, `protocolVersion`,
  `machineCommerce:true`, `discoveryProfile:'mcp-v3-2026-09-21-marketplace'`,
  `walletMode:'receiver-only'`, `paymentRails`, `recommendedEntryTool:
  provider.describe`, `roleScopedTools:true`, `storefront{freeMcpTools:6,
  paidMcpTools:6, …}`, `marketplace` with honest `activeCapabilityCount` (0).
- `/.well-known/glama.json` (`:838`): static claim only.
- `agent-card.json` + `agent.json`: identical `ckAgentDiscovery()` payload (9-step
  `purchaseFlow`, `executionPattern`, receiver, network).
- `x402.json` / `x402`: v2 discovery doc + v1/v2 ingress headers.
- `openai-apps-challenge`: 404 unless `OPENAI_APPS_CHALLENGE_TOKEN` set.
- `GET /health` (`:828`): reports `ok`, service, version only.
- **Marketplace inventory:** 8 capabilities in `data/marketplace.json`, all
  `status:'planned'`, `visibility:'private'` — **0 active, 0 public** (honestly
  reported). The full quote→authorize→pay→execute→receipt flow cannot be
  exercised via MCP.
- **Free/paid boundary visibility:** YES, via four channels — tool description
  prefixes (`FREE read-only…` / `PAID $N USDC on Base via x402…`), MCP
  annotations, `provider.describe`'s manifest, mcp.json `storefront`. Genuine
  strength; no hidden paywalls.

## 8. Documentation inventory & staleness

| Doc | State |
|---|---|
| `README.md` | STALE/MISLEADING — "12 public tools" (true count) then lists ~25 names, most not registered. Missing local run/test instructions (`npm start`/`npm test` exist, undocumented) |
| `docs/CAPABILITY-MANIFEST.md` | Current; matches `data/marketplace.json` fields |
| `docs/CREATOR-RIGHTS.md` | Current policy doc |
| `docs/GOVERNOR_PREFLIGHT.md`, `MARKETPLACE-HANDOFF.json`, `ONE-PASS-VERIFICATION.md`, `PROOF_BUNDLE.json`, `marketplace-catalog-validation.json`, `marketplace-one-pass-baseline.md`, `RECONCILIATION_V2.4.0.md` | Historical records, accurate as dated |
| `docs/MARKETPLACE-API.md` | Partially stale — documents tools that are dead code on the MCP transport |
| `docs/MARKETPLACE-OPERATIONS.md` | Operational; `<redacted>` placeholders, no secrets leaked |
| `docs/MARKETPLACE-SECURITY.md` | Claims need a test re-run to re-verify |
| `docs/MARKETPLACE-SOURCES.md` | Current, unusually honest scope notes |
| `docs/MARKETPLACE.md` | Current |
| `docs/PROVIDERS.md` | Stale vs MCP surface — directs providers to `provider.register` / `capability.register`, which are not registered tools |

## 9. The three comprehension failures that matter most

1. **Phantom tools.** Docs name ~25 tools; `tools/list` returns 12.
   `capability.get`, `payment.methods`, `receipt.verify`, `provider.register` —
   documented, dead. Docs and protocol contradict each other.
2. **Paid execution is off-MCP and never stated.** Calling a paid x402 MCP tool
   returns a 402 challenge; real execution is an out-of-band HTTPS POST with
   `PAYMENT-SIGNATURE` + idempotency key to `/api/x402/<capability>`.
   Instructions, descriptions, and discovery docs never explain what happens
   after payment, or how receipts/entitlements are retrieved.
3. **Advertised capability names don't match registered tool names**
   (`offer.list` vs `offers.list`, etc. — §4), and post-payment verification
   (`receipt.verify`, `entitlement.inspect`) has no protocol surface at all.

## 10. What is NOT covered by this audit

- Real-money x402/Stripe flows: **NOT TESTED — EXTERNAL/SECRET DEPENDENCY**
  (no facilitator calls, no settlements, no checkout; forbidden by brief).
- Production state/behavior beyond two read-only discovery fetches.
- The `.backup-tdqs-20260922-055746/` and `tests.pre-v3-test-fix.20260921T193958Z/`
  archives were treated as historical reference only.
- Complete Git history (unavailable by design of the export).

---
*Audit inputs: four read-only parallel audits (tool/protocol inventory,
security, commerce/x402, discovery/docs) + direct source verification of every
claim flagged as agent-visible. Saved at
`~/workspace/crossingkey-mcp/audit-reports/`.*
