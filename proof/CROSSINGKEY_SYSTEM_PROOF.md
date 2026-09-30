# CrossingKey System Proof v1

## Verdict

`CROSSINGKEY_ISOLATED_SYSTEM_PROOF_PASS` — bounded current-runtime qualification. The historical pre-closure bundle verdict remains preserved below for lineage; live production certification remains pending.

Historical sections in this document retain their original statuses and are not current qualification results unless the final qualification section explicitly incorporates them.

The canonical test-harness authority boundary is closed with new, explicitly test-only infrastructure. The deterministic production adapter passed through `npm test` using a localhost-only HTTPS JSON-RPC fixture and the existing `fetchImpl`/`rpcUrl` injection points. A historical core-suite record reports 122/122, but that Python test tree is absent from the current checkout and is not a fresh qualification result. All eight RPC negative probes pass freshly. Fresh gap probes establish seven adversarial PASS cases in the current matrix. Production archaeology initially classified recovery as PARTIALLY_IMPLEMENTED; the preserved recovery closure later closed that gate. The fixture does not certify live Base.

## Proven

- In an isolated temporary ledger, the production machine-commerce adapter executed `artifact.integrity_manifest` with `ai_required: false`, created a result and receipt, and verified the receipt hash. Evidence: `evidence/positive-proof.json`.
- Identical retry returned a duplicate without additional facilitator calls. Changed payload under the same idempotency key was rejected. Reuse of the payment nonce was rejected before execution. Evidence: `evidence/positive-proof.json` and `evidence/adversarial-matrix.json`.
- The service was observed running and was not restarted. This is an observation, not proof of the proof capability through production MCP.

## Partially proven

- Production has implemented lifecycle fragments for discovery, authorization, idempotency, replay protection, execution, verification, state, entitlement, and receipts.
- The archive has deterministic primitives for preconditions, authority, idempotency, replay, rollback, receipts, and persistence.
- A historical Phase XXXII record reports 122/122 using `proof/.venv`; the corresponding Python test tree is absent from the current checkout, so this is not a fresh qualification result.
- `npm run check` passes after the harness-closure inspection; no production implementation was changed.
- Provenance search found no Git history, branch, tag, stash, adjacent local copy, or archive copy of the four referenced authority artifacts.
- The new fixture proves only the deterministic production behavior against a controlled external RPC dependency; it is not Base consensus, live settlement, real payment, or public-network certification.
- The chain correction is recorded: `0x2105` is Base mainnet chain ID 8453; Base Sepolia is `0x14a34` / 84532. The fixture returns `0x2105` because that is the literal current `rpcAuthority()` contract, not because it certifies live Base mainnet.

## Not proven

- External payment settlement or on-chain verification: the harness used an isolated facilitator-shaped fixture and performed no real payment.
- A complete proposal-to-receipt lifecycle through the public MCP endpoint.
- Integration or semantic convergence between the production implementation and Phase XXXII core.
- Recovery after interruption at the requested lifecycle boundaries.
- All 18 adversarial cases; only the valid request, duplicate, changed-payload collision, and replay cases were executed.
- Model/interface independence across multiple exercised interfaces.
- Fourteen of eighteen requested adversarial cases were not executed through the integrated lifecycle; one revocation case is not supported by the identified production path.
- The claimed final-run result of `17/18` adversarial cases and `4/4` recovery cases could not be independently re-executed from this checkout because the referenced harness is absent; those claims remain preserved historical evidence, not current-run evidence.
- The canonical `npm test` path now passes freshly; its fixture lifecycle is recorded as `NEW_TEST_INFRASTRUCTURE`.
- Eight RPC negative probes pass freshly before anchor creation or state change.
- Fresh gap probes passed the current execution-exception, deadline, and verification-failure checks; unsupported or untested fault-injection cases remain explicit in `adversarial-matrix.json`.
- Programmatic adversarial counts are 7 PASS, 8 NOT_TESTED, 2 NOT_APPLICABLE, 1 NOT_SUPPORTED, total 18.
- The system state is `PRODUCTION_FEATURE_WORK_REQUIRED`: recovery is only partial and the real MCP cannot be safely isolated without testability/configuration work.

## Regression evidence

See `evidence/baseline-results.json`, `evidence/environment-repair.json`, `evidence/canonical-test-harness.json`, `evidence/tls-authority-analysis.json`, and `evidence/regression-results.json`. The production test glob was minimally repaired; no assertions were changed. The prior bundle is preserved under `evidence/history/previous-incomplete-run`.

## Safety boundary

Production files were not modified, the production service was not restarted, no funds were spent, and no blockchain transaction was signed or broadcast.

## Current closure blocker

The exact referenced files are absent:

- `proof/harness/run-machine-commerce-harness.mjs`
- `tests/fixtures/test-authority-ca.pem`
- `tests/fixtures/generate-ephemeral-authority-token.mjs`
- `src/reconciliation/authority-verifier.mjs`

Because those files are not present, the existing ephemeral TLS/JWT authority lifecycle cannot be shared with `npm test` without inventing a new authority implementation or weakening verification. Both are prohibited by the proof contract.

The earlier references to those paths are classified as `SUPERSEDED / UNSUPPORTED_BY_CURRENT_REPOSITORY_EVIDENCE`, not as recovered historical files.

The replacement fixture is not a restoration of those artifacts. It is new test-only infrastructure under `tests/fixtures/https-rpc-fixture.mjs`.

## Recovery and MCP boundary

Recovery is now `RECOVERY_PROOF_PASS` for the controlled test capability. The child-process harness executed REC-01, REC-02A, REC-02B, REC-02C, REC-03, and REC-04 through the production Gate 1B adapter, acknowledged explicit checkpoints over IPC, killed only harness children with SIGKILL, reloaded durable state in fresh runtimes, and converged on a second recovery run. REC-01/02B/03/04 each produced one effect and one receipt/entitlement/revenue event; REC-02C preserved `execution_unknown` with zero new success artifacts. This is capability-scoped evidence, not a universal exactly-once claim. The controlled fixture supplies deterministic authority/preparation callbacks; it does not certify every live production capability or live payment rail.

The real MCP path is present in `server.mjs`, but module-level startup reads fixed production state/configuration and the MCP paid x402 tool returns a payment challenge rather than directly invoking the same machine-commerce execution path. The existing exports are not a zero-side-effect, dependency-injected factory: an import smoke test emitted funnel restoration activity. Safe isolation would require a reviewed app factory/state injection and external-adapter seams. No fake MCP path was created.

## MCP convergence gate — fresh execution

The fresh MCP gate used an actual Streamable HTTP transport and a real MCP client exchange. `initialize`, session establishment, `tools/list`, and `tools/call` were executed against an isolated child server with temporary state, temporary funnel database, localhost HTTPS RPC/facilitator fixtures, and scoped CA trust. The selected capability was the existing `artifact.integrity_manifest` capability. Its authorized MCP continuation now delegates to `machineCommerce.invoke(...)`; no synthetic capability was added. Evidence: `evidence/mcp-convergence-proof.json`, `evidence/mcp-handshake.json`, and `evidence/mcp-convergence-map.json`.

Fresh results: protocol handshake PASS; two independent MCP sessions PASS; 12-tool surface observed with no test-only tool; unauthorized paid call returned the canonical payment challenge; authorized MCP execution returned the canonical-machine-commerce marker and the same result hash as direct invocation; direct-to-MCP and MCP-to-direct same-operation replay tests did not create a second execution; unknown-tool and invalid-argument calls failed closed; production state was untouched.

The MCP gate remains `MCP_CONVERGENCE_INCOMPLETE`, not PASS. The exported `createCrossingKeyApp()` still returns a module-scope application whose funnel database and dependency construction occur during `server.mjs` import. The isolated proof redirects those side effects to temporary paths, but zero-side-effect factory import is not proven. Changed-payload cross-ingress conflict and full nonce-replay parity were not freshly executed as separate cases. The Python core tree is absent from this checkout. These limitations remain explicit rather than being promoted to PASS.

## MCP closure rerun

The definition-only `lib/mcp-app-factory.mjs` import was freshly tested in a subprocess: no files, sockets, recovery, timers, or external calls were observed. Factory construction was then exercised with temporary state/database paths and the real Streamable HTTP server child. The authorized MCP and direct operations continued to produce the same result hash.

Fresh cross-ingress conflict/replay cases now pass. Direct-first then MCP with the same idempotency key and changed payload was rejected by the canonical Gate 1B `requestHash`/`paymentHash` conflict check. MCP-first then direct with changed payload was rejected by the same check. Direct-first then MCP with the same payment nonce but a different operation identity was rejected by canonical `state.replayKeys[context.replayKey]` replay detection. The reverse MCP-first then direct nonce replay was rejected by the same canonical replay check. No MCP-specific conflict or replay rule was added.

The prior MCP convergence gate was retained as `MCP_CONVERGENCE_INCOMPLETE` pending final qualification of the production entrypoint’s consumption of the new factory boundary. That historical limitation is superseded by the closure execution below. The prior closure evidence remains preserved in `evidence/mcp-zero-side-effect-import.json`, `evidence/mcp-changed-payload-cross-ingress.json`, `evidence/mcp-nonce-replay-cross-ingress.json`, and `evidence/mcp-convergence-map.json`.

## MCP convergence closure

The canonical construction path is now:

`server.mjs` → `lib/mcp-app-factory.mjs:createCrossingKeyApp` → `server-runtime.mjs` → existing Express/MCP/machine-commerce resources.

`server.mjs` owns only explicit production entrypoint startup. The implementation runtime no longer binds a listener on import. The factory module itself remains definition-only on import. A fresh isolated entrypoint test confirmed that the production entrypoint exports the factory-created app and start function while all mutable files were scoped to a temporary directory. The real MCP regression then passed `initialize`, session establishment, `tools/list` with 12 tools, authorized `tools/call`, direct/MCP result-hash parity, cross-ingress idempotency, changed-payload conflict, nonce replay, session isolation, and malformed-input rejection.

MCP convergence is therefore `MCP_CONVERGENCE_PASS` for the isolated source/runtime gate. The overall system proof remains `CROSSINGKEY_SYSTEM_PROOF_INCOMPLETE` pending the separate final qualification and the absent hardened Python core test tree. This is not live production certification.

## Final system qualification

Fresh qualification executed on 2026-09-30 against the current checkout. `npm run check`, `npm test`, the real Streamable HTTP MCP suite, the child-process recovery suite, the 8-case authorization tamper suite, execution-injection security, the witness contract, production recovery authority, and the 8-case RPC negative suite all passed. `sha256sum -c proof/evidence/SHA256SUMS` passed for the complete evidence bundle.

The bounded claim is now:

> CrossingKey has demonstrated, in the tested isolated implementation, a deterministic governance path from capability request through authority, execution, verification, durable state, recovery, and evidence production across both direct and real MCP ingress.

This qualifies the isolated current JavaScript implementation for the tested `artifact.integrity_manifest` capability, controlled RPC/facilitator dependencies, controlled external-effect witness, and real Streamable HTTP MCP transport. It does not claim universal exactly-once execution, mathematical correctness, all models/providers/protocols/capabilities, live payment settlement, live Base consensus, public facilitator behavior, or public deployed MCP certification.

The Durable Knowledge Boundary is described accurately as a durable staged-finalization protocol. After verified result evidence is durably persisted, the tested process-death cases completed local finalization without protected re-execution. `EFFECT_CONFIRMED`, `EFFECT_NOT_OBSERVED`, and `EFFECT_UNKNOWN` remained distinct; unknown outcomes did not trigger blind retry. This is capability-dependent evidence, not a universal external exactly-once guarantee.

The current bounded verdict is `CROSSINGKEY_ISOLATED_SYSTEM_PROOF_PASS`. Live production certification remains `PENDING`. The absent `crossingkey_core/tests` tree is recorded as `NOT_EXECUTED / TEST TREE NOT PRESENT`; the current JavaScript bounded claim does not depend on that absent historical suite, but the historical 122/122 result is not presented as fresh.

## Read-only live certification attempt

The live daemon was identified as `crossingkey-revenue-mcp.service`, active with MainPID `63255`, using the qualified checkout path. Local health returned version `3.0.0`. Public DNS/TLS, MCP initialize, and tools/list succeeded; the public surface matched the qualified 12-tool names and protocol `2025-11-25`.

Live certification remains `CROSSINGKEY_LIVE_READONLY_CERTIFICATION_INCOMPLETE` for two independent reasons. First, the running PID started on 2026-09-28, before the qualified production-factory source migration and qualification snapshot on 2026-09-29/30, so loaded-source correspondence cannot be proven without a prohibited restart. Second, repository inspection showed that the live request middleware schedules persistent funnel telemetry writes for MCP requests; the production funnel WAL timestamp advanced during the required initialize/tools-list probes. No payment, settlement, paid capability, wallet signature, blockchain transaction, deployment, restart, signal, or source replacement occurred. Further live probing was stopped.
