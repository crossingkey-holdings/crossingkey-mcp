# CrossingKey MCP v4.0.0-rc.1 implementation report

Status: `LOCAL_RC_CANDIDATE — NOT PRODUCTION-READY`

## Implemented

- Reconciled protected production behavior into the isolated v4 worktree.
- Added `mcp.launch_audit` priced at $9.00 USDC.
- Added `x402.purchase_path_audit` priced at $19.00 USDC.
- Added bounded live HTTP checks, deterministic scoring, structured findings,
  schema contracts, Bazaar metadata, and tests for both audits.
- Routed both audits through the existing x402 machine-commerce gate; no audit
  execution occurs from a challenge-only request.
- Preserved the original five $0.01 capabilities, the five existing five-cent
  deterministic capabilities, prepaid `xkey.validate`, receiver-only policy,
  payment verification/settlement ordering, replay/idempotency/receipt paths,
  TryBounty safety gates, and security tests.
- Updated runtime closure evidence and RC version metadata to `4.0.0-rc.1`.
- Corrected isolated startup tests to disable mainnet and bind all mutable state
  to temporary local paths.

## Payment protection

The audits only inspect public endpoints during paid execution after the normal
x402 authorization path. Challenge generation remains free and records a
challenge metric, not a completed transaction. Audit results explicitly report
`paymentAttempted: false` and `settlementAttempted: false` for the purchase-path
audit itself. No private key, signature, wallet transfer, or autonomous spend
was added.

## Not implemented or not verified

- No production deployment or live public audit execution was performed.
- No real payment was submitted.
- No live Stripe product or Checkout flow was created.
- No Cloudflare, DNS, Shopify, systemd, or wallet changes were made.
- Dependency advisories remain open pending a writable trusted npm cache and
  verified current package metadata.
- Complete systemd drop-in inspection remains blocked by the previously
  recorded permission denial.
