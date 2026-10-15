Timestamp — 2026-10-15 16:56:30 UTC

# CrossingKey MCP v4.0.0-rc.1 promotion readiness

Status: `PHASE 2 VERIFIED — PHASES 3–7 NOT YET EXECUTED`

## Verified

- Package `crossingkey-mcp`, canonical identity `com.crossingkeyintelligence/crossingkey-mcp`, release `4.0.0-rc.1`, Streamable HTTP transport, and MCP protocol `2025-11-25` are defined in the current candidate.
- All 13 required x402 capabilities are present in the canonical catalog, public discovery metadata, MCP tool registration, input validation, execution routing, and x402 payment routing.
- The complete repository test command passed 113 tests with zero failures. The package test passed its legacy machine-commerce suite; the focused `*.test.mjs` suite passed 110 tests; the read-only Base mainnet RPC integration reported zero writes.
- Payment verification precedes settlement; duplicate fulfillment, replay, receipt/result binding, entitlement binding, receiver-only behavior, autonomous-spend denial, SSRF defense, 256 KiB response caps, marketplace authorization, deterministic output verification, reconciliation, and recovery failure paths have passing automated evidence.
- `npm audit --omit=dev` reported zero vulnerabilities. The tracked-file secret scan inspected 269 tracked files and the staged scan inspected the nine-file release delta; both reported zero findings after the deterministic test fixture was handled by an exact-path, exact-value rule.
- No live payment, settlement, wallet signing, DNS change, production data write, or legacy source modification occurred in Phases 1–2.

## Repaired

- Eight stale entries in `proof/evidence/qualified-source-SHA256SUMS` were refreshed to the tested v4 source bytes, and the parent evidence manifest was updated. `npm run proof:verify` now passes both source and evidence hashes.
- The secret scanner previously treated a deterministic HMAC fixture as a credential. It now exempts only the exact fixture at the exact proof-harness path and reports `test-fixture-integrity` if that expected fixture is absent or changed.

## Not verified

- The final GitHub commit and remote `main` equality are pending Phase 3.
- Current operator-host legacy service, socket, process, public version, and tunnel origin are pending Phase 4 read-back.
- A separate v4 systemd service, isolated state, local MCP transport, and all 13 local unpaid HTTP 402 challenges are pending Phase 5.
- Tunnel configuration backups, validated rollback command, and active tunnel identity are pending Phase 6.
- Public v4 health, discovery, initialize, tools/list, and 13 unpaid challenges are pending Phase 7.
- Real payment acceptance and facilitator settlement are intentionally not verified by this run.

## Requires human approval

- No additional approval is required for the exact GitHub push, staged v4 service, tunnel-origin switch, required `cloudflared` restart, verification, or rollback described in the operator’s current directive.
- Any action outside that directive—DNS changes, wallet or payment-destination changes, live payments, live settlements, secret rotation, production-data migration, legacy-source modification, deletion, or unrelated Cloudflare changes—requires separate current approval.

## Production changes intentionally not performed

- No legacy service stop, restart, replacement, source edit, data copy, or port reuse.
- No Cloudflare configuration edit or restart during Phases 1–2.
- No DNS, Stripe, Shopify, wallet, receiver, asset, network, facilitator, or payment-destination change.
- No live payment or settlement.

## Exact rollback procedure

The cutover may proceed only after the current Cloudflare configuration and legacy origin have been backed up outside Git and the staged v4 origin has passed all local gates.

1. Restore the backed-up Cloudflare Tunnel configuration file byte-for-byte to its original absolute path using the recorded protected backup.
2. Validate the restored configuration with `cloudflared tunnel ingress validate` using the exact config path loaded by the service.
3. Verify that `cloudflared tunnel ingress rule https://mcp.crossingkeyintelligence.com` resolves to the recorded legacy localhost origin.
4. Restart only the `cloudflared` system component identified by `systemctl cat cloudflared`; do not restart the legacy MCP service.
5. Read back `systemctl show cloudflared` active state, main PID, and start timestamp; inspect its journal for origin or connector errors.
6. Verify legacy public `/health`, `/.well-known/mcp.json`, MCP initialize, `tools/list`, and one known unpaid x402 challenge.
7. Leave the separately staged v4 service stopped only after legacy public recovery is verified. Do not delete its unit, state, logs, or evidence in this run.

The concrete config path, legacy origin, staged origin, backup paths, service name, and exact restart command must be filled from authenticated Phase 6 host evidence before cutover. A generic rollback command is not accepted as sufficient evidence.

— 𝙅̶△𝘼̶
crossingkey_
CrossingKey Intelligence
intelligence is the standard.
