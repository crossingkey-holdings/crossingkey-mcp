# MCP Upgrade Plan — CrossingKey MCP 3.0.0 → 3.1.0

**Basis:** `docs/MCP_CURRENT_STATE.md` (inspect-only audit, 2026-10-01).
**Scope:** upgrade, not rewrite. Preserve working functionality and the proven
safety architecture (receiver-only wallet, server-side approvals, idempotency,
replay protection, SSRF defenses, receipt/entitlement correctness). Do not
delete source files. Do not overwrite owner changes. No production changes, no
real payments, no secret handling. Since Git objects are unavailable, change
tracking uses a pristine-copy diff (see §9).

**Target:** an unfamiliar AI agent can inspect and use the service correctly
without prior knowledge of CrossingKey — with every paid boundary,
approval requirement, and execution path machine-readable *before* any spend.

## Decision log (owner-visible)

| # | Decision | Rationale |
|---|---|---|
| D1 | Wire `registerMarketplaceTools` with existing role scoping (Group B) | 17 tools are implemented, have 3 test files, role-gated visibility, and good annotations; they are the documented surface. Inventory is 0 active / 0 public, so wiring is financially inert. The alternative (rewriting docs to pretend they don't exist) deletes designed capability. |
| D2 | Fix `publicCapabilityList()` names to canonical tool names; implement `credits.options` as a free tool from `request-credits-*` offers; drop `service.list` (no backing data file exists) | Removes agent-visible misinformation; all changes are additive or corrective, none weaken controls. |
| D3 | Add read-only `receipt.verify` + `entitlement.inspect` MCP tools (Group D) | Post-payment verifiability is currently internal-only — the #2 audit gap. Holder-knowledge IDs (UUIDs) + existing rate limits bound the oracle risk; tools return only verification booleans and non-sensitive metadata. |
| D4 | Add `outputSchema` to all 12 tools; `idempotentHint` on `xkey.validate` (Group A) | Protocol correctness with the installed SDK 1.30.0; schemas already exist implicitly as `structuredContent` shapes. |
| D5 | Two justified read-only resources (Group F) | `crossingkey://commerce-policy` and `crossingkey://capability-catalog` — static, public, already exposed via `/.well-known/*`; let agents fetch policy without tool calls. |
| D6 | `safeFetch` 256KB parity cap (Group G) | One-line parity with `validateEndpoint`'s cap; closes the only unbounded-input finding. |
| D7 | Startup validation of operator egress URLs (Group G) | Fail-fast on the facilitator URL (public by design); warn-only for operator RPC to avoid breaking local setups. |

## Group A — Protocol/schema correctness

**Goal:** every registered tool carries a machine-readable output contract.

- A1. Add `outputSchema` to all 12 `registerTool` calls, derived from the
  existing `structuredContent` shapes (free discovery envelopes, x402
  PAYMENT-REQUIRED challenge envelope, `xkey.validate` result envelope,
  marketplace tools' return shapes once wired).
- A2. Add `idempotentHint: true` to `xkey.validate` (it requires
  `idempotency_key`).
- A3. Ensure `title` is set on all tools (marketplace `add()` currently omits
  it; pass `title` through).
- **Files:** `server.mjs`, `lib/marketplace-tools.mjs`.
- **Safety gates:** no behavior change; handlers untouched.
- **Tests:** extend `tests/runtime-closure.test.mjs` / add schema-shape tests;
  `tools/list` snapshot asserting every tool has `outputSchema`.
- **Accept:** `tools/list` shows `outputSchema` on 12 (+ marketplace) tools;
  full suite green.

## Group B — Discovery/capability normalization

**Goal:** no advertised name lacks a registered tool; no registered tool lacks
truthful advertisement.

- B1. `publicCapabilityList()` (`server.mjs:230`): rename `offer.list` →
  `offers.list`, `requirement.check` → `requirements.check`.
- B2. Implement `credits.options` as a FREE read-only tool listing
  `request-credits-*` offers (from the existing offers data path). Remove
  `service.list` from the advertised list (backing `data/request_services.json`
  absent; not a tool).
- B3. Wire `registerMarketplaceTools` into `makeMcpServer()` with its built-in
  role scoping. Gate: register only after marketplace storage init succeeds;
  verify anonymous sessions expose **zero** marketplace tools; verify
  admin/provider/buyer scoping per the module's sets.
- B4. Fix `commerce.quote`'s description: `machine_capability.quote` →
  `commerce.quote` (the name that exists).
- B5. Verify item_id resolution paths (`server.mjs:263,279,308`) resolve both
  canonical free names and paid names after renames; add regression tests.
- **Files:** `server.mjs`, `lib/marketplace-tools.mjs` (title pass-through only).
- **Safety gates:** wiring changes transport exposure — keep
  `approvePurchase` off-MCP (CLI-only), keep buyer-bound purchase/approval
  binding checks; do not relax any gate to make tests pass.
- **Tests:** new `tests/capability-naming.test.mjs` (advertised ⊆ registered,
  registered ⊆ advertised); role-visibility tests per principal type;
  existing marketplace tests must stay green.
- **Accept:** cold-agent walk of every advertised name succeeds or fails with a
  truthful, bounded error; anonymous `tools/list` contains no privileged tools.

## Group C — Structured results/errors

**Goal:** errors are safe, bounded, machine-readable.

- C1. Truncate the x402 execution route's `err.message` passthrough
  (`server.mjs:1006-1008`) to the same 240-char bound used elsewhere; keep the
  stable error-code vocabulary.
- C2. Normalize paid-challenge and failure envelopes so `code`, `message`, and
  `retryable` are always present (no shape guessing).
- **Files:** `server.mjs`.
- **Safety gates:** no new information in error paths; no `.stack` anywhere.
- **Tests:** error-shape assertions for challenge, verify-fail, settle-fail paths.
- **Accept:** every error response matches the documented envelope; message
  length bounded.

## Group D — Approval/idempotency safety + verifiability

**Goal:** approvals stay server-side; verification becomes protocol-visible.

- D1. **No change** to approval minting (local CLI only), single-use ≤1h,
  buyer+capability+key+hash binding, consume-at-purchase. Re-verify with tests.
- D2. Add FREE read-only tools:
  - `receipt.verify` `{receipt_id}` → `{verified: bool, result_hash_match, …}`
    (pure recomputation; no state change).
  - `entitlement.inspect` `{entitlement_id}` → `{status, capability, …}`
    (non-sensitive metadata only).
  Both rate-limited via the existing limiter; UUID holder-knowledge IDs;
  return no payment payloads, signatures, or secrets.
- D3. Document the approval lifecycle (quote → CLI approval → purchase →
  consume) in tool descriptions where the agent must know it
  (`capability.purchase`, `commerce.quote`).
- **Files:** `server.mjs`, `lib/machine-commerce.mjs` (expose existing
  internals; no new crypto).
- **Safety gates:** read-only handlers; no auth bypass on buyer-bound data —
  first-party receipts are holder-knowledge; marketplace `receipt.get` stays
  buyer-bound.
- **Tests:** `tests/receipt-verification.test.mjs` — tampered receipt fails,
  valid passes, unknown ID is a safe 404-shape, rate limit engages.
- **Accept:** an agent can answer "how do I verify the result?" from
  `tools/list` alone.

## Group E — Commerce clarity

**Goal:** every paid capability is machine-readable about *how* it is paid,
*where* execution happens, and *what* proves completion.

- E1. Extend the paid capability descriptor (`publicCapabilityDescriptor()`)
  with `execution_transport: 'x402_http_post'`, `execution_url`,
  `quote_policy` (`fixed_price` for first-party; `quote_required` for
  marketplace), `approval_policy`, and `verification: {tools:
  ['receipt.verify','entitlement.inspect']}`.
- E2. Surface `facilitator` (URL host) and `network`/`asset` in the descriptor
  so the third-party facilitator dependency and Sepolia-default are
  discoverable before payment.
- E3. `commerce.quote`: add `quote_id` and `expires_at` (quote currently has
  only `quoteHash`, no expiry). Keep the approval as the binding artifact.
- E4. Fix kennekarte wording tension: entitlements are born
  `consumed`/`usesRemaining:0` (proof-of-purchase); align the `rights` claim or
  document that downloads are fulfillment artifacts, not re-execution rights.
- E5. Tool descriptions for the five x402 tools: add one sentence naming the
  out-of-band execution step ("Execution is a separate HTTPS POST to
  `execution_url` with a signed x402 payload; this tool only returns the
  challenge.").
- **Files:** `lib/paid-capability-catalog.mjs`, `lib/machine-commerce.mjs`,
  `lib/marketplace.mjs`, `server.mjs` (descriptions).
- **Safety gates:** descriptor changes are read-only; no pricing/settlement
  logic touched.
- **Tests:** descriptor-shape tests; quote `quote_id`/`expires_at` assertions;
  challenge-envelope includes the new sentence.
- **Accept:** a cold agent can state, before paying: price, asset, network,
  facilitator, execution transport, approval requirement, verification path.

## Group F — Resources & server instructions

**Goal:** policy and catalog fetchable without tool calls; instructions tell
the truth about execution.

- F1. Register two read-only resources:
  - `crossingkey://commerce-policy` — approval/payment/receipt policy summary
    (from manifest constants).
  - `crossingkey://capability-catalog` — frozen paid capability descriptors
    (from `lib/paid-capability-catalog.mjs`).
- F2. Update `MCP_SERVER_INSTRUCTIONS`: add the x402 off-MCP execution mode
  and the receipt/entitlement verification tools; keep it compact (~10 lines).
- **Files:** `server.mjs`, `lib/mcp-manifest.mjs`.
- **Safety gates:** resources are static public data; no per-request secrets.
- **Tests:** resource read tests; instructions mention execution mode +
  verification.
- **Accept:** `resources/list` + `resources/read` work anonymously; instructions
  no longer imply MCP-tool execution for paid capabilities.

## Group G — Observability & transport hardening

**Goal:** bounded visibility; close the small hardening gaps.

- G1. `safeFetch`: 256KB response cap (parity with `validateEndpoint`).
- G2. Startup egress validation: facilitator URL must be `https:`, public,
  credential-free → fail fast; operator RPC URL validated → warn-only on
  failure (do not break local setups).
- G3. `StreamableHTTPServerTransport`: honor `CK_ALLOWED_ORIGINS`
  (comma-separated) as `allowedOrigins` when set; default unchanged
  (documented 127.0.0.1 + proxy posture).
- G4. `GET /health`: add `version`, `protocolVersion`, `uptime_s`,
  `tool_counts{free,paid,marketplace}` — still no secrets, still cheap.
- G5. `machine-commerce.mjs` `atomicWrite`: adopt the `wx` exclusive-create +
  fsync pattern from `gate1b-store` (parity; no behavior change on success).
- **Files:** `lib/machine-commerce.mjs`, `lib/gate1b-store.mjs` (reference),
  `server.mjs`.
- **Safety gates:** caps and validation must not break existing passing tests;
  fail-fast only where the design requires public egress (facilitator).
- **Tests:** cap enforcement test (oversize body truncated/rejected);
  startup-validation tests; health-shape test; allowedOrigins unit test.
- **Accept:** the three security-audit gaps are closed; health is informative
  and bounded.

## Group H — Tests

**Goal:** every change above is covered; a cold agent's comprehension is
tested, not assumed.

- H1. New: `tests/capability-naming.test.mjs`,
  `tests/receipt-verification.test.mjs`, descriptor/quote-shape tests,
  resource tests, cap/validation/health tests (from groups above).
- H2. New: `scripts/agent-comprehension-test.mjs` — boots the server
  in-process and simulates a cold agent with zero CrossingKey knowledge:
  1. `provider.describe` → extract discovery sequence + manifest;
  2. follow the sequence for every `offers.list` item;
  3. assert `stopBeforePayment` and that preflight returns
     `READY_FOR_HUMAN_AUTHORIZATION` and nothing else;
  4. assert every name in every response resolves to a registered tool;
  5. assert every paid tool's challenge names its execution transport;
  6. assert anonymous sessions see no privileged tools;
  7. assert free/paid boundary is machine-readable before any call.
  Exit non-zero with a named failure on any violation.
- H3. Keep the full existing suite green; update the two archived-test
  references only if they break for legitimate reasons (they live in
  `tests.pre-v3-test-fix.*`, historical).
- **Accept:** `npm test` 100% green + comprehension script exits 0.

## Group I — Documentation

**Goal:** docs describe the system as it is.

- I1. Rewrite `README.md`: truthful 12-tool surface (+ marketplace tools once
  wired), local run/test instructions (`npm start`, `npm test`), discovery
  sequence, paid-execution mechanics.
- I2. New: `docs/AGENT_QUICKSTART.md` (5-minute cold-agent path),
  `docs/CAPABILITIES.md` (tool catalog with selection criteria),
  `docs/SECURITY_MODEL.md` (controls as implemented + residual risks),
  `docs/COMMERCE_FLOW.md` (the three rails, quote→approval→pay→execute→receipt
  with the real tool names), `docs/MCP_ARCHITECTURE.md` (transport, sessions,
  auth binding, storage).
- I3. Mark superseded claims: `docs/PROVIDERS.md`,
  `docs/RECONCILIATION_V2.4.0.md`, `docs/MARKETPLACE-API.md` get dated
  correction banners (do not delete; they are historical records).
- I4. `docs/MCP_UPGRADE_REPORT.md`: what changed, test evidence, residual
  risks, `NOT TESTED` items.
- **Accept:** no doc names a tool that isn't registered; every registered tool
  is documented with selection criteria.

## Sequencing & gates

1. A → B → C → D → E → F → G, with H tests written alongside each group and
   the full suite run after every group.
2. After each group: `node --check` on touched files, targeted tests, full
   `npm test`, `git diff --check` equivalent (pristine-copy diff, §9).
3. Stop conditions (from the brief): any step requiring production changes,
   real payments, secret reconstruction, weakening of approvals/payments/
   entitlements/idempotency/replay/SSRF controls, or overwriting owner changes
   → stop, report, await owner direction.

## 9. Change tracking (no Git)

1. Before the first edit, copy the extracted tree (excluding `node_modules`)
   to `~/workspace/crossingkey-mcp/pristine/` as the read-only baseline.
2. After implementation, `diff -r` pristine vs upgraded tree (excluding
   `node_modules`, `data/*.sqlite3`, runtime state) → change record saved as
   `docs/MCP_UPGRADE_REPORT.md` appendix.
3. Do not `git init`, commit, or otherwise fabricate history in
   `CROSSINGKEY_MCP_ROOT`.

## 10. Delivery

- Upgraded tree packaged as a downloadable archive of the **entire upgraded
  `CROSSINGKEY_MCP_ROOT`** — owner requirement; do not silently narrow the
  package to exclude `node_modules` or runtime state.
- Final status uses the brief's exact structure, including
  `NOT PERFORMED — AWAITING OWNER APPROVAL` where applicable.

## Non-goals

- No production modification, restart, promotion, or deployment.
- No real x402/Stripe payment execution or testing.
- No new dependencies unless a group cannot be done without one (none
  anticipated — SDK 1.30.0 already installed).
- No TryBounty operations (separate skill/policy gate).
- No reconstruction of the excluded Git history.
