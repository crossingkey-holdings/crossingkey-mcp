# One-pass marketplace verification — 2026-09-16

STATUS: PASS WITH BLOCKERS — local marketplace conversion implemented, committed and verified; production promotion and offer activation remain gated.

| Required field | Verified result |
| --- | --- |
| Original HEAD | 8513a0dc3d21e60c30b19083478f40970fcbeed6 |
| Implementation HEAD | a33de8d00ccb4712cf614c36970c001b1b870859 |
| Final HEAD | The commit containing this report on upgrade/marketplace-one-pass; resolve with git rev-parse HEAD. A report cannot embed the hash of its own containing commit. The final chat receipt records that full hash. |
| Branch | upgrade/marketplace-one-pass |
| Original version | 2.4.0 |
| New version | 2.5.0 |
| Tools before / after | 26 / 42; capability.get extended in place |
| Providers registered | One first-party pending provider in local ignored state; no third-party provider onboarded |
| Capabilities active | Zero in persistent seed state; one per isolated marketplace E2E fixture |
| First-party products imported | Eight 1.0.1 products; hashes match catalog and sidecars; private/planned; operator rights affirmation required |
| Providers/capabilities in E2E tests | Provider A LOCAL TEST FIXTURE plus marketplace.echo; one provider and one capability per E2E fixture |
| Tests passed / failed | Working tree: 85 / 0. Clean committed export: 70 / 0. Prepared runtime payload MCP E2E: 1 / 0. These are overlapping validation scopes, not additive unique-test counts. |
| Marketplace suite | 25 tests: 20 domain/catalog tests, four adapter/security tests and one real MCP transport E2E |
| Legacy payment regression | PASS; all 60 baseline working-tree tests remain passing |
| Marketplace E2E | PASS for x402 v1/v2 local echo, real MCP digital delivery, HTTP payment headers and authenticated download; mock facilitator only |
| Revenue allocation | PASS: gross 100001 = platform 10000 + provider 90001; duplicate purchase leaves one allocation and one settlement |
| Security | Pattern scans: zero findings. npm audit --omit=dev: zero reported vulnerabilities. Auth/session/tenant checks, rights gate, SSRF pinning, size limits and payment replay tests pass. Scope limits documented. |
| Dependencies added | None; lockfile changes are root package version only |
| Runtime | Node v22.23.2, npm 10.9.8 |
| Real money / payouts / remote pushes / deployments | Zero |
| Production readiness | Local candidate and prepared payload verified; not approved or represented as production-ready |

## Execution and evidence

The initial restricted test run failed in HTTP discovery. After approved filesystem/network access, the unchanged baseline passed all 60 tests. No payment implementation repair was needed for that failure. An intermediate version edit accidentally changed the test's historical deployment-script reference to a nonexistent v2.5 filename; the reference was restored without removing its assertion. Final tests have no failures.

The existing x402 canonicalization, receiver enforcement, facilitator verification/settlement and receipt hashing are reused. Legacy invoke gained an exclusive file lock shared with marketplace nonce reservation. The receiver and existing prices are unchanged. New purchase journals record progress before settlement, bind human approval and retain failed/uncertain jobs. No automatic retry of uncertain settlements or creator payout is implemented.

Commands verified: npm test; npm run check; node --test tests/marketplace.test.mjs; node --test tests/marketplace-security.test.mjs; node --test tests/marketplace-http.test.mjs; tracked/staged secret scan; npm audit --omit=dev --json; clean git-archive export tests; prepare-marketplace-release.mjs with per-file hash readback; actual prepared-runtime MCP E2E.

Working-tree evidence: /tmp/ck-marketplace-final-tests.txt. Clean-export evidence: /tmp/ck-marketplace-committed-final-tests.txt. Prepared-payload evidence: /tmp/ck-marketplace-prepared-e2e.txt. Dependency audit: /tmp/ck-marketplace-audit.json. These temporary logs are supporting evidence; PROOF_BUNDLE.json records the durable results.

The clean export uses the existing installed node_modules via a local symlink; it does not claim a fresh dependency installation. The 15-test difference is the pre-existing untracked v2.4 MCP contract suite. The test counts demonstrate both reproducible committed source and compatibility with the broader operator worktree. Original uncommitted HTTP-test additions and untracked v2.4 controllers/fixtures/evidence remain outside marketplace commits.

Prepared runtime: /home/founder/Documents/Codex/2026-09-16/files-pasted-by-the-user-crossingkey/work/marketplace-2.5.0-final. Thirteen runtime/metadata files match implementation commit a33de8d00ccb4712cf614c36970c001b1b870859; PREPARED_MARKETPLACE_RELEASE.json records their SHA-256 values. No private data, credentials, product archives or node_modules are in the release manifest. A local dependency symlink was attached only for testing.

The real MCP adapter additionally completed HTTPS initialization, payment.methods, and session cleanup against https://mcp.crossingkeyintelligence.com/mcp. It returned three rails and agent_spend=false. This was a free read-only operation, not a real payment or deployment verification.

The original eight archives were only read and hashed. Import is idempotent and detects sidecar/hash conflicts. Seed state has one pending provider, eight planned/private capabilities, zero purchases and zero allocations. AI training is false and rights are unaffirmed. The initial engineering import's generated rights affirmation was corrected before release; a regression now prevents catalog metadata from implicitly making a legal affirmation.

## Files changed

Runtime: server.mjs, lib/machine-commerce.mjs, lib/marketplace.mjs, lib/marketplace-adapters.mjs, lib/marketplace-schema.mjs, lib/marketplace-storage.mjs, lib/marketplace-tools.mjs.

Configuration/metadata: .env.example, package.json, package-lock.json, server.json, live-status.json, README.md.

Operator utilities: scripts/marketplace-admin.mjs, scripts/import-marketplace-catalog.mjs, scripts/prepare-marketplace-release.mjs, scripts/scan-marketplace-secrets.mjs.

Tests: tests/marketplace.test.mjs, tests/marketplace-http.test.mjs, tests/marketplace-security.test.mjs, tests/http-discovery.test.mjs (version expectation only), tests/server-regression.test.mjs (version expectations only).

Documentation created: docs/MARKETPLACE.md, docs/PROVIDERS.md, docs/CAPABILITY-MANIFEST.md, docs/CREATOR-RIGHTS.md, docs/MARKETPLACE-SECURITY.md, docs/MARKETPLACE-OPERATIONS.md, docs/MARKETPLACE-API.md, docs/ONE-PASS-VERIFICATION.md, docs/marketplace-one-pass-baseline.md, docs/marketplace-catalog-validation.json, docs/GOVERNOR_PREFLIGHT.md, docs/PROOF_BUNDLE.json, docs/MARKETPLACE-HANDOFF.json, docs/MARKETPLACE-SOURCES.md.

## Warnings and production blockers

1. The existing operator service remains active at version 2.4.0 in /home/founder/Downloads/crossingkey_developer_revenue_app. No production process or configuration was changed. The historical deploy-v2.4.0.sh must not be used to promote this 2.5.0 payload; an exact promotion/rollback procedure must be reviewed and rehearsed against the actual target before deployment approval.
2. Real provider/buyer credentials, endpoint bindings, rights affirmations, release permissions and production offer/network choices must be supplied through the operator workflow before real purchases. The private first-party catalog is not sale-approved by this engineering run.
3. No real paid transaction or third-party paid provider execution was attempted. Mock payments prove the engineering paths, not live economic settlement. Remote MCP free transport was verified separately.
4. JSON storage is single-host and deliberately serializes payments. Stale locks, interrupted settlements and refunds need operator reconciliation. Digital download authorization consumes an attempt even if the downstream network transfer later fails. Full JSON Schema and autonomous payouts are outside this release.

EXACT NEXT PRODUCTION ACTION: after the named configuration/rehearsal gates are satisfied, obtain current approval to back up and promote the verified 2.5.0 payload to crossingkey-revenue-mcp.service at the confirmed production directory, preserving production secrets/data/receiver, then restart that exact service and verify health, MCP discovery, legacy paths and rollback. Activation of paid marketplace offers and any real payment remain separately approved actions.

Outcome: LOCAL IMPLEMENTATION VERIFIED; PREPARED NOT DEPLOYED; NOT APPROVED FOR PUBLIC RELEASE.
