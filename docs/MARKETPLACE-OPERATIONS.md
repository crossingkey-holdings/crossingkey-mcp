# Marketplace operations and deployment boundary

Version 2.5.0 is a local candidate. Operator-host inspection on 2026-09-16 observed crossingkey-revenue-mcp.service active/running with WorkingDirectory=/home/founder/Downloads/crossingkey_developer_revenue_app, unit /etc/systemd/system/crossingkey-revenue-mcp.service, and localhost:3000 health version 2.4.0 on Base mainnet in receiver-only mode. The marketplace repository is a different checkout. No service restart, deployment, remote push, payout or public publication was performed.

Configuration is documented in .env.example. Keep MARKETPLACE_FILE and MACHINE_COMMERCE_FILE in a private writable data directory; never commit them. MARKETPLACE_AUTH_FILE contains {"principals":{"<sha256-of-bearer-token>":{"id":"operator-assigned-id","role":"buyer","buyerReference":"operator-assigned-buyer","expiresAt":"ISO-8601"}}}. Provider entries use role=provider and providerId. Administrator entries use role=admin. Expiry is required. disabled=true revokes a credential. No credential values belong in this document or tool arguments.

MARKETPLACE_ADAPTERS_FILE maps capability IDs to private bindings. Examples of structure:

```json
{
  "operator-selected-capability-id": {
    "type": "digital_asset",
    "file": "operator-approved-relative-artifact.zip"
  }
}
```

http bindings require type=http and endpoint matching the registered HTTPS URL. mcp bindings additionally require an exact tool name. An operator must confirm external providers need no prepayment and disclose applicable provider obligations before binding. Local functions require explicit trusted application registration; do not accept paths or module names from manifests. Bindings reload on lookup so reviewed changes do not need a development restart.

Before payment, obtain commerce.quote, then create a private JSON request with capabilityId, buyerReference, idempotencyKey, input and expiresAt (at most one hour). The human runs `node scripts/marketplace-admin.mjs approve-purchase <private-json-file>` in the configured environment. Approval returns an approvalId bound to the current quote. The authenticated buyer uses capability.purchase with that ID and a signed payment. Never treat this command as permission for the agent to create a real-money approval on its own. Only sandbox fixtures are authorized in this build.

Other local commands: provider-status, capability-status and mark-settled. Status requests contain providerId/capabilityId and status; capability-status may include visibility. mark-settled contains allocationId and a reference to a separately approved completed transfer. It records accounting only. Administrator MCP equivalents enforce the same role checks. Settlement changes do not imply permission to move funds.

First-party import: `node scripts/import-marketplace-catalog.mjs <productization-root> <private-marketplace-state-file> <report-file>`. It hashes existing archives without extraction or changes and imports private/planned entries. Repeating unchanged input is idempotent; conflicts fail. Generated capability IDs live in local state and the report. To publish later, review rights, prices/network, bind original assets under a controlled root, approve the provider and explicitly approve capability publication/activation. No generic rollout enables these products automatically.

Recovery: a .lock file is intentional evidence after a crash. Confirm the recorded PID is no longer running, preserve the state and lock in a backup, reconcile any settlement_pending/unfinished purchase using payment evidence, then remove only that confirmed stale lock. Never broadly remove locks or retry a stranded payment with a fresh idempotency key. Failed paid jobs retain entitlement, receipt and allocation evidence for manual refund/dispute handling. No automated refund or reconciliation command is supplied.

Deployment requires a new exact approval. Prepare a backup of actual production code and both data stores, validate all runtime imports/dependencies, stage the 2.5.0 candidate with private configuration and no active marketplace offers, and verify health/MCP/legacy/payment fixtures against that staging directory. Preserve production .env, data/, delivery/, logs and secrets; do not copy candidate test state. The old deploy-v2.4.0.sh is a historical controller and MUST NOT deploy this candidate. A reviewed 2.5.0 promotion/rollback controller or equivalent operator procedure must be prepared against the exact service before approval to restart it. The current build is not a claim that the older release gate accepts a new version.

Rollback after an approved future deployment: stop only the named service, restore the captured predeployment code/dependencies, keep financial data intact and reconcile its schema before restarting the original service. Marketplace state must not be deleted on rollback. A host-specific deployment/rollback rehearsal is still a release prerequisite.
