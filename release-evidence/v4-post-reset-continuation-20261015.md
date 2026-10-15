# CrossingKey MCP v4 post-reset continuation evidence

Recorded: `2026-10-15T15:35:37-04:00`

Release: `4.0.0-rc.1`

Status: `BLOCKED_PRE_CUTOVER`

Invariant: `LIVE_PAYMENT_AND_SETTLEMENT_UNVERIFIED`

## Checkpoint recovery

- Source checkpoint: `/tmp/crossingkey-mcp-v4-pre-reset-checkpoint-20261015.md`
- Expected and observed SHA-256: `554c92e29802f9cdd375db7669c367e9634dbb8b44ce2a3f3ebfb4be7f8445ca`
- Protected copy: `/home/founder/.local/state/crossingkey-mcp-v4-cutover/crossingkey-mcp-v4-pre-reset-checkpoint-20261015.md`
- Both files were mode `0600`; the protected copy matched the source checksum.
- One context reset was resumed successfully without rebuilding or repeating the completed qualification suite.

## Source synchronization

- Starting HEAD: `632dad08efdc9171608a5d4b4271b8f40c8f5347`
- Branch: `codex/crossingkey-v4-development`
- Reviewed commit: `1e4bb015d5a71f4de6378a14a1d0347b9fbc12b4`
- Commit subject: `Add commercial monitoring and endpoint continuity evidence`
- Remote: `https://github.com/crossingkey-holdings/crossingkey-mcp.git`
- Push: normal fast-forward `632dad0..1e4bb01`, `HEAD -> main`; no force push.
- Readback: local HEAD and remote `refs/heads/main` both resolved to `1e4bb015d5a71f4de6378a14a1d0347b9fbc12b4`.
- The local remote-tracking ref update was blocked by the read-only shared Git metadata mount after the remote push succeeded. Direct `git ls-remote` readback proved synchronization.
- Staged set: exactly the 16 paths authorized by the verified checkpoint.
- Staged secret scan: 16 files, zero findings.
- Cached diff check: PASS after removing Markdown-only trailing whitespace.
- Unrelated untracked files remained excluded and preserved.

## Reused release qualification

No runtime source changed after the previously completed qualification, so the validated results were reused instead of rerunning the entire suite:

- Package test: 1/1 PASS.
- Full test suite: 115/115 PASS, zero failures.
- Commercial monitoring tests: 5/5 PASS.
- Proof source hashes: PASS.
- Proof evidence hashes: PASS.
- Isolated qualification: PASS.
- Production dependency audit: zero reported vulnerabilities.
- Live certification remains pending production cutover.

## Staged runtime integration

- Unit: `crossingkey-mcp-v4-staged.service`
- Unit backup: `/home/founder/.local/state/crossingkey-mcp-v4-cutover/pre-refresh-crossingkey-mcp-v4-staged.service`
- Unit and backup SHA-256: `fa7387540261a0759464f7bd57a7a3946ba0d7aeed8c102c7591aeb53f6eb7cb`
- Unit backup mode: `0600`.
- Unit working directory: `/home/founder/Downloads/crossingkey-mcp-v4-development`.
- Unit executable: `/usr/bin/node /home/founder/Downloads/crossingkey-mcp-v4-development/server.mjs`.
- State root: `/home/founder/.local/state/crossingkey-mcp-v4-staged`, mode `0700`.
- State files and staging environment: mode `0600`.
- The unit grants writes only to its staged state root and explicitly denies the legacy source tree.
- Staged service refresh: executed only for the staged user service.
- Post-refresh state: active/running, PID `38398`, `NRestarts=0`, listening on `127.0.0.1:3401`.
- Post-refresh health: `4.0.0-rc.1`.
- Process working directory and command matched the synchronized worktree and entrypoint.
- Journal review showed generated request IDs only; no proof body, signature, authorization header, credential, or buyer data.

## Monitoring verification

- Isolated database: `/home/founder/.local/state/crossingkey-mcp-v4-staged/data/commerce_funnel.sqlite3`.
- Database permissions: `0600`.
- `payment_attempts` exists with the reviewed 22-column privacy-safe schema.
- First staged synthetic monitor run:
  - health/discovery/MCP initialize/tools list PASS;
  - protocol `2025-11-25`;
  - 28 tools;
  - 13 paid capabilities;
  - all 13 HTTP routes returned valid x402 v2 unpaid challenges;
  - payment proof submitted: false;
  - chargeable operation attempted: false;
  - live settlement attempted: false.
- First funnel observation recorded 13 synthetic unpaid challenges as non-actionable `EXPECTED_UNPAID_402` with neutral `UNCONVERTED_CHALLENGE` state.
- One safe invalid-proof probe was rejected with HTTP 400 before verification or settlement and recorded as `INVALID_PAYMENT_PROOF`.
- One malformed-input probe was rejected with HTTP 400 and recorded separately as `MALFORMED_REQUEST`.
- Dummy proof marker scan across SQLite, WAL, and SHM: absent.
- Verification attempts: 0; settlement attempts: 0; successful paid executions: 0.
- External buyer intent, buyer abandonment, and off-infrastructure agent activity remain `NOT_OBSERVABLE`.
- Public monitor units were installed byte-for-byte and loaded:
  - service SHA-256 `5b98ac681f60ee3a061d0a411b0bd53c8c5260fabeaeb510b9d39bdc09ccb71b`;
  - timer SHA-256 `e6c99deb697da86e0a08a84d29634b6b3e90f3d10671f2a0418daca1c1da5c04`.
- Both units remain inactive; the timer remains disabled until public v4 cutover so current public v3 does not generate false v4 alerts.

## Endpoint continuity

- Post-refresh audit output was written to temporary evidence so committed inventory files remained unchanged.
- Post-refresh inventory semantically matched the committed inventory after excluding only `generated_at`.
- 13 direct HTTP paid endpoints verified on staging.
- 10 `LEGACY_ENDPOINT_PRESERVED`.
- 3 `NEW_PUBLIC_ENDPOINT`: `mcp.launch_audit`, `x402.purchase_path_audit`, `xkey.validate`.
- 0 `MCP_ONLY_CAPABILITY`, 0 `CHANGED_ENDPOINT`, 0 `UNVERIFIED_ENDPOINT` in staging.
- Named legacy continuity, all-legacy continuity, staging endpoint, and promotion gates: PASS.
- Current public hostname still reports v3.0.1; staged endpoints are not claimed as public v4.

## Legacy preservation

- `crossingkey-revenue-mcp.service` remained active/running as PID `2338`, `NRestarts=0`, on `127.0.0.1:3000`.
- The legacy start timestamp remained `2026-10-15 10:57:24 EDT` across the staged refresh.
- Local legacy health and public health both reported v3.0.1 after staged verification.
- The legacy service was not restarted, stopped, modified, or used as staged storage.

## Cloudflare read-only gate

- Authorized operation: GET `/accounts/b9bbf573c66a7b3b25fb92b51e1b65e4/cfd_tunnel/c3dd5c64-cd7c-494d-9edb-ec4264e58606/configurations`.
- HTTP response: 200; configuration version 1.
- Readback exactly matched the protected original configuration semantically and byte-for-byte when serialized in the preserved canonical layout.
- Original/current SHA-256: `041ab8709dfe2637e92c9ea84a1a0acd4271105aca359884b209305adf667bef`.
- Current route: `mcp.crossingkeyintelligence.com` -> `http://localhost:3000`.
- Ordered fallback remained `http_status:404`; `warp-routing.enabled` remained false.
- No Cloudflare write occurred.
- Prepared cutover diff remains exactly one field:
  - `config.ingress[0].service`: `http://localhost:3000` -> `http://127.0.0.1:3401`.
- Cutover request SHA-256: `0d9dd5ddc67bbeeeeb9b123c779090965aa6bfdd80199c8bdfdb886847903e90`.
- Rollback request SHA-256: `52d3aeadbbffd45da2b18802a6c44af166eebacb74057ea72b6157e3981255b9`.
- Rollback body exactly matches the original configuration body.

## Remaining blocker

- Required gate: prove `http://127.0.0.1:3401/health` is reachable from the actual cloudflared connector process network namespace.
- Connector service: active/running PID `4576`; `PrivateNetwork=no`; no alternate `NetworkNamespacePath`.
- Attempted exact probe: `nsenter --target 4576 --net -- curl -fsS --max-time 5 http://127.0.0.1:3401/health`.
- Result: `nsenter: cannot open /proc/4576/ns/net: Permission denied` before any HTTP request.
- Classification: `ENVIRONMENTAL_RESTRICTION`.
- This is not evidence of origin connectivity failure and not an application implementation failure.
- Cutover approval was not requested because the connector-context reachability gate remains unverified.
- Narrow next authorization: permit the exact read-only namespace probe above, or an equivalently direct connector-context health probe. No configuration mutation is required.

## Autonomy experiment record

- Implementation failures in this continuation: 0.
- Runtime compatibility regressions: 0 observed.
- Corrective rework cycles: 3.
  - Removed Markdown-only whitespace identified by the cached diff gate.
  - Corrected one local JavaScript review command whose shell quoting was invalid; no file or service state changed.
  - Removed an extra EOF blank line identified by the evidence-only cached diff gate.
- Environmental restrictions observed:
  - shared Git index was read-only in the sandbox; resolved through explicit-path authorization;
  - local remote-tracking ref update was read-only after a successful remote push; resolved by direct remote readback;
  - sandbox could not access the host user bus/process namespace; resolved through targeted read-only authorization;
  - connector network namespace remains inaccessible to the operating user; unresolved.
- Expected safety boundaries preserved:
  - Cloudflare writes require separate approval;
  - rollback requires separate approval;
  - no funded payment or live settlement;
  - no legacy restart or production data modification;
  - no secret-bearing output or commit.
- Tool-enforced authorization-boundary operations observed after reset: 14. Thirteen completed their intended operation; the connector namespace probe remained blocked by host permissions.
- Context resets successfully resumed: 1.
- Exact model runtime configuration and token consumption: `NOT_OBSERVABLE`; no values were inferred.
