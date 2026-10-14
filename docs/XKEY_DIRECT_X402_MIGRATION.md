# XKEY direct x402 migration

The v4 candidate moves `xkey.validate` to the shared direct x402 lifecycle.
The price is $0.10 USDC, or `100000` atomic USDC units, on Base Mainnet. The
existing receiver, canonical USDC asset, payment verification, settlement,
receipt, entitlement, replay, and idempotency controls are shared with the
other first-party paid capabilities.

The direct route never reads or mutates the legacy credit ledger. XKEY
normalization runs through `scripts/xkey-direct-validation.py`; the shared
machine-commerce state is authoritative for the new purchase, entitlement,
and receipt lifecycle.

New prepaid-credit sales are disabled in v4 discovery and fulfillment. Existing
paid credit balances, hashed credentials, reservations, receipts, entitlements,
and customer rights are preserved. Authenticated holders can use the explicit
`xkey.validate.legacy` compatibility tool, which consumes an existing credit
and never initiates x402 verification or settlement.

This is candidate behavior only. Production v3 remains unchanged, and no live
payment was executed during migration testing.
