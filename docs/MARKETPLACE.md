# CrossingKey marketplace 2.5.0

This additive local candidate extends the existing Express/MCP server with provider applications, capabilities, authorized x402 purchases, bounded execution, compatible receipts and provider accounting. The existing five paid HTTP capabilities, prices, wallet receiver, Stripe discovery, credit tools, v1/v2 protocols and on-chain verifier remain available.

Flow: provider application → operator approval → rights-affirmed capability registration → adapter binding and activation → discovery → quote → local human approval → signed test or separately authorized payment → facilitator verify/settle → entitlement and job → execution → schema/hash verification → receipt and allocation.

Amounts are USDC atomic-unit decimal strings. Fees are basis points; default MARKETPLACE_FEE_BPS=1000. Platform allocation is integer floor(gross*bps/10000); provider gets the remainder. The registration snapshots fee terms. Existing legacy prices are not changed.

Provider balances are records only. No signer, treasury wallet, keys, autonomous payout or provider prepayment is created. ACTIVE public capabilities from ACTIVE providers may accept payments. beta/planned/disabled and private records cannot. The nine proposed native commercialization capabilities are described as planned and are not paid tools.

Configuration and operator steps: [operations](MARKETPLACE-OPERATIONS.md). Tool contracts: [API](MARKETPLACE-API.md). Providers: [onboarding](PROVIDERS.md). Security: [threat model](MARKETPLACE-SECURITY.md). Rights: [creator rights](CREATOR-RIGHTS.md).

Eight first-party 1.0.1 ZIPs were verified against the catalog and sidecars. Metadata is in ignored local data/marketplace.json; the import receipt is marketplace-catalog-validation.json. The provider remains pending, capabilities planned/private, and original archives unchanged. Import uses priceUsd, not the lower launchPriceUsd. These records do not establish release approval or current mainnet pricing.

The persistence backend is a small local JSON store behind readJson/writeJson/withFileLock. It uses mode-0600 files, fsync, atomic replacement and exclusive process locks. This is deliberately a single-host design; network filesystems, horizontal scaling and automatic financial reconciliation are not supported.
