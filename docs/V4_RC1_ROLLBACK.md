# v4.0.0-rc.1 rollback procedure

This RC has not been deployed. The safe rollback is therefore to discard or
archive the isolated working-tree changes after review and continue using the
unchanged authoritative source/production application.

If a later authorized promotion occurs:

1. Preserve the exact promoted candidate hash and release manifest.
2. Record presence, ownership, permissions, and cryptographic hashes for the
   pre-promotion application files, service-injected environment, and every
   persistent state path. Never copy any secret value into release evidence.
3. Quiesce the service and verify the approved backup of the production source.
4. Preserve, and do not replace during a code rollback, the existing production
   databases and WAL/SHM files, JSON state, customer records, payment records,
   receipts, entitlements, replay keys, idempotency records, marketplace jobs,
   approvals, allocations, and fulfillment records. These are mutable business
   state, not release files.
5. Restore the prior approved application files and environment configuration
   only from exact, approved backups. Do not restore mutable data over newer
   state without an explicit state-recovery and payment-reconciliation decision.
6. Confirm database schema compatibility before opening the service. The v4
   funnel store uses the existing `funnel_snapshots` table and WAL mode; the
   machine-commerce state continues to require `version`, `idempotency`,
   `replayKeys`, `entitlements`, and `receipts`. Marketplace state must retain
   `allocations`, `approvals`, `jobs`, `purchases`, `receipts`, and
   `entitlements`.
7. Preserve interrupted or uncertain settlement records for manual
   reconciliation. Never retry a stranded payment with a fresh idempotency key,
   delete replay keys, or infer a refund from a code rollback.
8. Perform one bounded restart maximum, then read back PID, timestamp, journal,
   health, version, and payment-discovery surfaces.
9. Confirm receiver-only mode, payment challenge behavior, receipt integrity,
   and no unexpected writes before declaring rollback complete.

The production environment currently exposes these non-secret variable names:
`CK_ENABLE_MAINNET`, `CK_RECEIVER_ADDRESS`, `CLAIM_SECRET`, `DELIVERY_ROOT`,
`PORT`, `PUBLIC_BASE_URL`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`.
Values remain protected. v4 additionally supports optional paths and controls
including `CK_STATE_FILE`, `CK_CATALOG_FILE`, `CK_CREDITS_FILE`,
`CK_FULFILL_FILE`, `CK_SERVICES_FILE`, `CK_FUNNEL_DB`,
`CK_KENNEKARTE_HMAC_SECRET`, `CK_BASE_RPC_URL`, `X402_FACILITATOR_URL`,
`CK_ONCHAIN_MIN_CONFIRMATIONS`, `CK_EXPOSE_LEGACY_TOOLS`, and the v4 funnel
flags. Before promotion, each effective value and default must be reconciled
against the drop-in and `.env` without exposing secrets.

Persistent production paths observed during read-only inspection include:
`data/commerce_funnel.sqlite3` with WAL/SHM companions,
`data/machine_commerce.json`, `data/state.json`,
`data/capability_state.json`, `data/marketplace.json`,
`data/capability_registry.json`, `data/request_services.json`,
`data/fulfillment_map.json`, `data/credit_links.json`, and
`data/promotion_policy.json`. The deployment procedure must preserve these
paths and all customer/payment content within them.

No rollback command is executed by this development task.
