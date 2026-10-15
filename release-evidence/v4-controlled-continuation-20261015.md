# CrossingKey MCP v4 controlled continuation evidence

Timestamp: 2026-10-15T19:03:08Z
Release version: `4.0.0-rc.1`
Continuation baseline: `632dad08efdc9171608a5d4b4271b8f40c8f5347`
Branch observed: `codex/crossingkey-v4-development`
Repository: `https://github.com/crossingkey-holdings/crossingkey-mcp.git`

## Verified workspace results

- `npm run check`: PASS.
- `npm test`: PASS, 1/1 package test.
- `node --test tests/*.test.mjs`: PASS, 115/115 tests.
- Commercial-monitoring acceptance subset: PASS, 5/5 tests.
- `npm audit --omit=dev --json`: PASS, 0 reported vulnerabilities.
- Tracked secret pattern scan before staging: PASS, 269 files, 0 findings.
- Proof verification: source hashes PASS; evidence hashes PASS; isolated qualification PASS; live certification PENDING.
- `git diff --check`: PASS.
- Offline systemd unit validation: PASS for the prepared monitoring service and timer.
- `systemd-analyze --user verify` could not bind its private socket because one was already in use; classified `ENVIRONMENTAL_RESTRICTION`. Offline `systemd-analyze verify` passed.

## Payment and commercial monitoring

The existing SQLite funnel is extended rather than duplicated. The bounded
`payment_attempts` table defaults to the newest 5,000 rows and the database is
set to mode `0600`. Telemetry is best-effort and cannot block the payment path.

Recorded stages: discovery, paid-capability inquiry, payment challenge, proof
receipt as a boolean, verification, settlement, receipt, entitlement, and paid
execution. Generated correlation IDs trace a request across the internal
payment stages. Synthetic probes are explicitly marked.

The following classifications are implemented without storing raw proof or
authorization data:

- `EXPECTED_UNPAID_402` with neutral commercial state `UNCONVERTED_CHALLENGE`
- `INVALID_PAYMENT_PROOF`
- `VERIFICATION_FAILURE`
- `SETTLEMENT_FAILURE`
- `FACILITATOR_FAILURE`
- `RECEIPT_FAILURE`
- `ENTITLEMENT_FAILURE` aggregate counter
- `REPLAY_OR_IDEMPOTENCY_CONFLICT`
- `SUCCESSFUL_PAID_EXECUTION`
- bounded auxiliary categories for malformed input, infrastructure failure,
  and unexpected exceptions

Buyer intent, buyer abandonment, and agent activity outside
CrossingKey-controlled infrastructure are `NOT_OBSERVABLE`.

Acceptance evidence uses disposable storage and mocked facilitator/RPC paths.
It proves ordinary unpaid 402s are non-actionable, malformed requests and fake
proofs are separated, mocked verification and settlement failures are visible,
receipt/entitlement finalization failure is visible, correlation survives the
Gate1B stages, the fake proof marker is absent from SQLite, and the synthetic
monitor performs no payment or settlement.

Operator commands are documented in `docs/V4_COMMERCIAL_MONITORING.md`.
Repository user-unit templates are prepared but not installed or enabled.

## Current service observations

Evidence timestamp: 2026-10-15T19:02:38Z.

- Legacy unit: `crossingkey-revenue-mcp.service`, active/running, PID 2338,
  `NRestarts=0`, listener `127.0.0.1:3000`, health version `3.0.1`.
- Staged listener: `127.0.0.1:3401`, health version `4.0.0-rc.1`.
- Staged service-level verifier: PASS for health, canonical identity,
  MCP 2025-11-25 initialize, 28 tools, all 13 paid tools, and the complete
  13-capability unpaid HTTP 402 matrix.
- Staged runtime state files observed at mode `0600`.
- Staged user-unit `ActiveState`, `MainPID`, and `NRestarts`: UNVERIFIED because
  the user-manager bus returned `Failed to connect to bus: No data available`.
- The staged database contains only `funnel_snapshots`; the new
  `payment_attempts` schema is absent. Therefore the running staged process has
  not loaded the monitoring change and must be refreshed before promotion.
- Cloudflared unit: active/running, PID 4576, `NRestarts=2`, start time
  2026-10-15 10:59:24 EDT.
- Cloudflared properties: `PrivateNetwork=no`, no `NetworkNamespacePath`, and
  no IP allow/deny list. Direct `/proc` namespace verification was unavailable,
  so connector reachability to `127.0.0.1:3401` remains UNVERIFIED and is not
  inferred from shell curl.

No service was stopped, restarted, disabled, installed, or modified in this
continuation. Legacy source and production data were not modified.

## Staged unpaid x402 matrix

Every row returned HTTP 402, x402 v2, network `eip155:8453`, asset
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and receiver
`0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B`.

| Capability | USD | Atomic USDC |
| --- | ---: | ---: |
| x402.compatibility_audit | 1.00 | 1000000 |
| mcp.schema_audit | 1.00 | 1000000 |
| openapi.quality_audit | 1.00 | 1000000 |
| machine_commerce.readiness_audit | 2.00 | 2000000 |
| artifact.integrity_manifest | 0.10 | 100000 |
| hash.encode | 0.01 | 10000 |
| secret.scan | 0.01 | 10000 |
| pii.scan | 0.01 | 10000 |
| json.repair | 0.01 | 10000 |
| prompt.audit | 0.01 | 10000 |
| mcp.launch_audit | 9.00 | 9000000 |
| x402.purchase_path_audit | 19.00 | 19000000 |
| xkey.validate | 0.10 | 100000 |

## Cloudflare read and backup verification

Read performed: `GET /accounts/b9bbf573c66a7b3b25fb92b51e1b65e4/cfd_tunnel/c3dd5c64-cd7c-494d-9edb-ec4264e58606/configurations`.

Result: HTTP 200, tunnel identity matched, version `1`, source `cloudflare`, MCP
origin `http://localhost:3000`, then fallback `http_status:404`, with
`warp-routing.enabled=false`. The complete live configuration matched the
preserved backup at the read time. The GET did not change routing.

Original backup:
`/home/founder/.local/state/crossingkey-mcp-v4-cutover/original-tunnel-configuration.json`

- mode: `0600`
- JSON: valid
- SHA-256: `041ab8709dfe2637e92c9ea84a1a0acd4271105aca359884b209305adf667bef`

## Prepared cutover and rollback

Private prepared files are outside Git and mode `0600`:

- `/tmp/crossingkey-mcp-v4-cutover-current.json` — `af52bdebc6adf667cdd8b4598536f1f1a5c7c3c5a7e9e9b15e3d57874f6c5220`
- `/tmp/crossingkey-mcp-v4-cutover-request.json` — `0d9dd5ddc67bbeeeeb9b123c779090965aa6bfdd80199c8bdfdb886847903e90`
- `/tmp/crossingkey-mcp-v4-rollback-request.json` — `52d3aeadbbffd45da2b18802a6c44af166eebacb74057ea72b6157e3981255b9`
- `/tmp/crossingkey-mcp-v4-cutover-operation.js` — `28ba4a998385d0209968fc18a3ea563053fc006a01c3b8acc89f3f14c39c3581`
- `/tmp/crossingkey-mcp-v4-rollback-operation.js` — `86dda56b0d67b16b7e822e0e3c46407d96f82ebc0f7ad87506db6f74a7d890eb`

The cutover request is a full `PUT` body and changes exactly one property:

```text
config.ingress[0].service
- http://localhost:3000
+ http://127.0.0.1:3401
```

Ingress order, hostname, fallback, `warp-routing`, and property sets are
identical. The prepared cutover operation performs final GET, drift rejection,
one conditional PUT, and readback. The separately prepared rollback performs
GET, exact proposed-config precondition, one conditional PUT of the complete
original config, and readback. Cutover authority does not authorize rollback.

Cloudflare API documentation identifies the PUT as replacing the entire remote
tunnel configuration, which is why partial or reconstructed bodies are not
used.

## Interruption and rework classification

- `AUTHORIZATION_INTERRUPTION`: the earlier combined host verification request
  was intentionally canceled; it was not an implementation failure.
- `AUTHORIZATION_INTERRUPTION`: earlier Cloudflare requests were canceled when
  the executable operation was not visible; no write occurred.
- `EXPECTED_SECURITY_GATE`: Cloudflare PUT and rollback PUT remain withheld.
- `ENVIRONMENTAL_RESTRICTION`: user-systemd manager socket unavailable.
- `ENVIRONMENTAL_RESTRICTION`: cloudflared `/proc` namespace inspection was not
  available even though non-isolation properties were readable.
- `CORRECTIVE_REWORK`: one SQLite test comparison was adjusted for Node's
  null-prototype row objects; values had matched.
- `CORRECTIVE_REWORK`: the first staged schema probe targeted the state root;
  the corrected exact database path proved the new table absent.
- `CORRECTIVE_REWORK`: facilitator rejection logs were tightened to exclude
  upstream response text, and stored correlation IDs are now generated by the
  server rather than accepted from clients.
- `IMPLEMENTATION_FAILURE`: none observed.
- `VERIFICATION_FAILURE`: staged monitoring activation and connector-specific
  reachability are not yet verified; these are unresolved gates, not failed
  code tests.

## Promotion decision

Status: `BLOCKED`.

Required next host action: authorize a narrowly scoped refresh of only
`crossingkey-mcp-v4-staged.service` so it loads the reviewed monitoring build,
then read back its unit status/restart count, verify the new SQLite table and
operator commands, and prove the running cloudflared connector can reach
`http://127.0.0.1:3401`. Installing/enabling the prepared user monitoring timer
is also pending host authorization. The legacy service must remain untouched.

Only after those gates pass should the complete cutover operation be displayed
again for one-time production PUT approval. Rollback remains a separate
approval.

`LIVE_PAYMENT_AND_SETTLEMENT_UNVERIFIED`
