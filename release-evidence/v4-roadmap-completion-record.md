Timestamp — 2026-10-15 16:56:30 UTC

# Roadmap Completion Record

**Project / asset:** CrossingKey MCP `4.0.0-rc.1`

**Mode:** Launch and controlled cutover

**Selected roadmap.sh roadmaps:** DevOps, Linux, Git and GitHub, Node.js, API Security

**Access date:** 2026-10-15

**Primary documentation:** OpenAI “Build an MCP server — Run and test locally”; Cloudflare “Tunnel configuration file” and “Run as a service on Linux”; GitHub “Pushing commits to a remote repository”; repository-pinned MCP SDK, x402 packages, and executable tests.

| Completion item | Required now | Evidence | Status | Deferred rationale |
|---|---:|---|---|---|
| Deterministic dependency install and vulnerability audit | yes | `npm ci`; `npm audit --omit=dev --json` | PASS | — |
| Syntax, unit, integration, transport, and failure-path tests | yes | 113/113 full suite; deployment/recovery fixtures | PASS | — |
| Streamable HTTP initialize, tool discovery, valid/invalid calls, and authorization | yes | Repository transport suite; local staged read-back required in Phase 5 | PARTIAL | Candidate process not yet staged |
| Secret exclusion and least-privilege runtime state | yes | Tracked secret scan; isolated-path design; staged service gate pending | PARTIAL | Host service not yet created |
| Git review, non-force push, and remote hash read-back | yes | Exact reviewed path list; Phase 3 pending | PENDING | Must follow Phase 2 pass |
| Cloudflare config validation, hostname rule match, protected backup, health read-back, and rollback | yes | Current official Cloudflare guidance; Phases 6–7 pending | PENDING | Requires authenticated host topology |
| Payment safety: verify-before-settle, replay/idempotency, receiver-only, no autonomous spend | yes | Automated payment and recovery suites | PASS | Real payment intentionally prohibited |
| DNS, wallet, payment destination, and legacy-state preservation | yes | Explicit unchanged-state gates | PASS TO DATE | Revalidate after cutover |

## Acceptance criteria

- Exact `4.0.0-rc.1` identity through local and public transport.
- All 13 paid capabilities present and each returns the correct no-payment challenge for a valid input.
- No settlement or funds movement during verification.
- Legacy process remains active and public rollback is immediately testable.
- Local and GitHub `main` hashes match before any host staging.

## Tests and proof-bundle reference

See `release-evidence/v4-proof-bundle.json` and `release-evidence/v4-release-verification.log`.

## Known limitations

Local source tests are not public-service proof. Public cutover status remains pending until the tunnel reaches the staged v4 PID and all public checks pass. A roadmap checklist is planning evidence, not implementation proof.

## Release decision

`PHASE 2 PASS — PROCEED TO REVIEWED COMMIT/PUSH; CUTOVER NOT YET APPROVED BY GATES`

— 𝙅̶△𝘼̶
crossingkey_
CrossingKey Intelligence
intelligence is the standard.
