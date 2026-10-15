Timestamp — 2026-10-15 16:56:30 UTC

# CrossingKey Governor Preflight

**Run ID:** `ck-mcp-v4-release-20261015T165630Z`

**Mode:** `Launch`

**Operator request:** Finish, verify, commit, publish, stage, and—only after all gates pass—promote CrossingKey MCP `4.0.0-rc.1` by switching the existing MCP Cloudflare Tunnel origin from legacy to a separate verified v4 localhost service, with automatic rollback on any cutover failure.

**Desired outcome:** Public `mcp.crossingkeyintelligence.com` reaches the verified v4 process while the legacy service remains running and recoverable.

**Economic objective:** Restore the public machine-commerce foundation without authorizing live spending, settlement, payment-destination changes, or uncontrolled liability.

**Buyer or user:** MCP clients and machine-commerce buyers discovering CrossingKey’s public paid capability catalog.

**Urgency / time-to-cash:** Immediate release restoration; no revenue promise or payment-success claim is permitted without an actual separately authorized payment.

**Existing safe assets:** Current v4 source checkout, Git history, locked Node dependencies, automated tests, proof manifests, legacy service, and existing Cloudflare Tunnel.

**Source of truth:** `/home/founder/Downloads/crossingkey-mcp-v4-development`, branch `codex/crossingkey-v4-development`, initial HEAD `dd19ad663cbc23f61e0d6d353dae13367ec7ea5f`, repository-defined version `4.0.0-rc.1`.

**Scope and exclusions:** Includes local repair, evidence, tests, reviewed commit, push to GitHub `main`, read-only legacy inspection, separate v4 systemd staging, protected tunnel-config backup, origin-only cutover, public read-back, and rollback. Excludes deletion, legacy source/data mutation, production-state sharing, DNS, wallet/payment-destination changes, live payments, live settlement, spend, force-push, and unrelated Cloudflare changes.

**Information classification:** Source and internal evidence are `PRIVATE_CK` until explicitly committed to the existing repository; sanitized health/discovery results are `PUBLIC_SAFE`; service/tunnel configuration and backups remain private; credentials and secret values remain `SECRET` and must never enter Git or evidence.

**Authority level:** `EXPLICITLY_APPROVED`

**Exact approval required, if any:** No further approval for the exact enumerated push, staging, tunnel-origin switch, required cloudflared restart, verification, or rollback. Any expansion beyond those exact actions requires new approval.

**Evidence available:** Git identity/history, 113-test full suite, package audit, tracked secret scan, proof manifests, recovery/deployment fixtures, real local transport checks to be produced in Phase 5, authenticated host service/tunnel evidence to be produced in Phases 4–6, and public read-back to be produced in Phase 7.

**Asset sources searched and coverage boundary:** The trusted v4 checkout and the separately named legacy checkout only; no broad home-directory or cloud-source scan.

**Reusable module manifest IDs:** `lib/mcp-app-factory.mjs`, `lib/paid-capability-catalog.mjs`, `lib/machine-commerce.mjs`, `lib/mcp-manifest.mjs`.

**Provenance / ownership status:** Existing CrossingKey repository and Git history; current push target must be read back after publication. Historical untracked artifacts are preserved but are not promoted as current proof.

**Public-safe derivative required:** Yes. Only the reviewed Git commit and sanitized public responses may be public; local secrets, state, service configuration, backup material, and private logs remain excluded.

**Capability attestation (read / write / test / network / account / deploy / payment):** Repository and approved host reads available; workspace writes and tests available; network available; GitHub push and local systemd/Cloudflare Tunnel actions authorized but still subject to live credential/privilege availability; payment execution explicitly prohibited.

**Proof bundle required before release:** `yes`

**Material exposure:** Public availability, payment challenge correctness, receiver identity, secret leakage, replay/idempotency, process isolation, tunnel rollback, and repository publication.

**Assumptions:** The named systemd and cloudflared services exist on this laptop, the current tunnel remains operator-controlled, and v4 can run on a distinct unused loopback port with isolated state and no settlement. Each assumption must be verified before mutation.

**Success test:** Local and public health/discovery identify exact version `4.0.0-rc.1`; MCP initialize and `tools/list` succeed; all 13 paid tools are advertised; each valid unpaid request returns a correct HTTP 402 challenge without settlement; receiver-only and no-autonomous-spend fields remain true; the legacy service remains active; and the public process identity is demonstrably v4.

**Rollback / recovery:** Byte-for-byte protected backup of the active tunnel config and unit topology; restore the exact legacy origin, validate ingress, restart only cloudflared, and verify legacy public health/discovery/initialize/tools/challenge.

**Next money action:** None in this run. After stable public verification, any real payment certification requires a separate explicit spend cap and observable transaction/settlement evidence.

— 𝙅̶△𝘼̶
crossingkey_
CrossingKey Intelligence
intelligence is the standard.
