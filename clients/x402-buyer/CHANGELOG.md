# Changelog

## 5.0.1 — 2026-10-26

- Aligns the buyer package and server candidate metadata with the dependency-hardening patch release.
- Preserves explicit approval, receiver-only seller boundaries, x402 v1/v2 support, and no-payment test behavior.

## 5.0.0 — 2026-10-26

- Added explicit-approval x402 buyer transport for Node and TypeScript users.
- Added EIP-1193 browser-wallet wrapper with Base mainnet checking.
- Added dependency-free Python buyer client.
- Added x402 v2 support with v1 HTTP fallback.
- Added idempotency preservation and payment-response receipt parsing.
- Added no-funds tests for approval, signing, retry, malformed challenges,
  repeated 402 responses, and browser wallet ordering.
