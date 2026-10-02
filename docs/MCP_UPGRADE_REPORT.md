# CrossingKey MCP — Upgrade Report (v3.0.0)

> **Historical upgrade record.** This report preserves the v3.0.0-based upgrade work from which the qualified v3.0.1 source release was later published. It does not state that v3.0.1 is deployed to production.

Date: 2026-10-01
Scope: upgrade of the owner-provided `crossingkey-mcp` 3.0.0 snapshot
(SHA-256 `0529183c…b24`). Not a rewrite; all existing functionality and the
proven safety architecture are preserved.

## What changed

### A. Protocol/output schemas
Every registered tool now exposes an `outputSchema` and returns
`structuredContent`: discovery tools, the five paid x402 challenge tools, and
`xkey.validate`. `xkey.validate` carries `idempotentHint: true` with
correctly placed annotations. New: `tests/protocol-contracts.test.mjs`.

### B. Discovery normalization + marketplace registration
- `publicCapabilityList()` advertises the canonical names `offers.list`,
  `requirements.check`, `credits.options`. Phantom names (`offer.list`,
  `requirement.check`, `credit.options`, `service.list`) are no longer
  advertised anywhere.
- New live read-only `credits.options` discovery tool (added to the free set).
- The 8 existing public marketplace tools are now registered on the MCP
  server with role filtering; approval minting stays off-MCP.
- `commerce.quote` description corrected (references `offers.list` and the
  `capability.purchase` flow; no `machine_capability.quote` phantom).
- New: `tests/discovery-naming.test.mjs`.

### C. Structured errors
Shared `mcpError(error_code, message, hint)` helper. Discovery, x402
challenge, and `xkey.validate` failures return sanitized structured errors —
no stack traces, no secret material. Malformed input is rejected at the
protocol layer before handlers run.

### D. Verification surfaces (new, authenticated-only)
`lib/marketplace.mjs` gained `getApproval`, `inspectIdempotency`,
`verifyReceiptIntegrity`, `getEntitlement`. New authenticated read-only
tools: `approval.verify`, `idempotency.inspect`, `receipt.verify`,
`entitlement.inspect`. Hidden from anonymous sessions; buyer-bound;
`idempotency.inspect` never creates state; approval minting remains
off-MCP. New: `tests/verification-surfaces.test.mjs`.

### E. Commerce clarity
x402 challenges now include `settlement_expectations` (facilitator
settlement, settlement receipt header) and `confirmation_expectations`
(idempotent retry semantics, what success returns). `commerce.quote`
references the `capability.purchase` flow.

### F. Resources and instructions
Two new public static resources: `crossingkey://discovery-guide` and
`crossingkey://commerce-policy`. New `crossingkey://capability/{name}`
resource template with per-capability instructions. Server `instructions`
already state the stop-before-payment rule.

### G. Transport/security hardening
- `safeFetch`: 256KB response cap enforced while streaming (exported
  `readCappedBody` + `SAFE_FETCH_MAX_BYTES`); SSRF defenses intact.
- `POST /mcp`: Origin validation — cross-origin browser requests rejected
  with 403 (DNS-rebinding defense); Origin-less clients unaffected.
- Structured server-side logging (`logError`): `{tag, error, message}`
  truncated to 240 chars; no stacks, tokens, or payment payloads.
- New: `tests/transport-security.test.mjs`.

### H. Agent comprehension
New `scripts/agent-comprehension-test.mjs`: boots a fresh server and walks it
as a new agent would — 19/19 checks pass.

### I. Documentation
New: `docs/AGENT_QUICKSTART.md`, `docs/CAPABILITIES.md`,
`docs/SECURITY_MODEL.md`, `docs/COMMERCE_FLOW.md`,
`docs/MCP_ARCHITECTURE.md`, this report. `README.md` surface section
updated. `docs/MCP_UPGRADE_PLAN.md` packaging language corrected to require
the entire upgraded `CROSSINGKEY_MCP_ROOT`.

## Test results

| Suite | Result |
|---|---|
| Original baseline (pre-upgrade) | 76/76 PASS |
| Full suite after Groups A–G (fresh, unmasked `npm test`) | **92/92 PASS**, exit 0 |
| `scripts/agent-comprehension-test.mjs` | 19/19 PASS |

No real payments or production activity occurred. Credential-,
infrastructure-, and payment-dependent checks: `NOT TESTED —
EXTERNAL/SECRET DEPENDENCY`.

## Files changed vs the original snapshot

Changed: `server.mjs`, `lib/machine-commerce.mjs`, `lib/marketplace.mjs`,
`lib/marketplace-tools.mjs`, `lib/mcp-manifest.mjs`,
`scripts/openai-commercial-discovery-proof.mjs` (proof-message fix),
`tests/marketplace-http.test.mjs` and
`tests/openai-commercial-discovery.test.mjs` (stale assertions updated to the
new canonical surface).

Added: 7 docs, `scripts/agent-comprehension-test.mjs`,
`tests/protocol-contracts.test.mjs`, `tests/discovery-naming.test.mjs`,
`tests/verification-surfaces.test.mjs`, `tests/transport-security.test.mjs`.

No source files were deleted. Git objects were absent in the snapshot and
were not fabricated.

## Preserved invariants

Idempotency, replay protection, journal-before-settlement, reconciliation,
receipt hash-chaining, entitlements, server-side marketplace approvals,
receiver-only payments, and SSRF defenses are unchanged. Human authorization
remains enforced server-side.

## Not performed

Production deployment, real-payment testing, external account actions, and
TryBounty operations: `NOT PERFORMED — AWAITING OWNER APPROVAL`.
