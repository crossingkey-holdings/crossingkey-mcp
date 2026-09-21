# CrossingKey MCP v2.4.0 Marketplace-Inclusive Reconciliation

This branch reconciles the verified production hardening with the marketplace implementation from `upgrade/marketplace-one-pass`.

Included:
- DEV marketplace imports, provider/capability registration, approval boundaries, purchase/delivery HTTP routes, session-principal binding, accounting, receipts, entitlements, adapters, and storage.
- DEV marketplace-aware `lib/machine-commerce.mjs`, including exported facilitator access required by marketplace execution and the file-lock wrapper around paid invocation.
- LIVE canonical core MCP tool surface (`provider.describe`, `offers.list`, `capabilities.list`, `capability.get`, `capability.quote`, `cost.estimate`, `result.preview`, `requirements.check`, `execution.preflight`, `payment.methods`, status/receipt/verification tools). When marketplace already owns the same canonical public name, marketplace keeps ownership and the duplicate direct canonical registration is omitted; the decision is recorded in `release/tool-registration-ownership-v2.4-marketplace.json`.
- LIVE minimal public health behavior, loopback-only listener, receiver-only authority boundary, and Base-mainnet-only advertisement when mainnet is enabled.
- A dedicated `release/runtime-files-v2.4-marketplace.txt` manifest is generated from the reconciled `server.mjs` import graph. The legacy v2.4 deploy script is left untouched; deployment-path changes are deferred to the separate v3 upgrade.
- Marketplace library and HTTP tests remain active in the default test suite.

The reconciliation remains local-only. It does not deploy, push, restart production, settle a payment, send funds, or grant autonomous spend authority.
