# CrossingKey buyer adapter v5.0.0

Status: `TESTED — RELEASE CANDIDATE`

This release adds a buyer-side x402 transport without changing the live
receiver-only MCP v4 server. The server remains on v4.0.0. The v5 version is
the client adapter release, not a claim that the production server has been
restarted or relabeled.

## What it does

- Parses x402 v2 `PAYMENT-REQUIRED` challenges and accepts the existing v1 HTTP
  fallback.
- Restricts the default buyer network to Base mainnet `eip155:8453`.
- Displays enough challenge data for a buyer UI to show amount, asset, network,
  receiver, and timeout before signing.
- Requires an explicit approval callback before a signer is called.
- Requires an injected signer callback; no private key is stored or handled.
- Retries with `PAYMENT-SIGNATURE` for v2 or `X-PAYMENT` for v1.
- Preserves a caller-supplied `Idempotency-Key` across the challenge/retry pair.
- Exposes a browser/EIP-1193 wrapper that checks Base mainnet and asks for
  accounts only after approval.
- Provides the same guarded flow in Python using the standard library.

## What it does not claim

- It cannot add wallet support to Gemini, Claude, ChatGPT, or any other host
  that does not expose a signer and a way to attach payment headers.
- It does not sign a transaction by itself and does not hold or spend from the
  CrossingKey receiver wallet.
- It does not prove live settlement. The release proof uses mocked buyer
  transports and a live unpaid challenge only.
- It does not modify DNS, Stripe, Supabase, the live v4 process, or Cloudflare.

## Release gates

The v5 candidate is releasable only when all of these remain true:

1. JavaScript adapter tests pass.
2. Python adapter tests pass.
3. Node and Python syntax checks pass.
4. Secret scan finds no private keys, Stripe secrets, webhook secrets, or
   signed payment payloads.
5. Free requests never call approval or signing.
6. A declined payment never retries.
7. An approved payment retries once with the same idempotency key.
8. A repeated 402 is surfaced as a payment failure, never as success.
9. v1 and v2 request-header selection is covered.
10. Browser wallet access is requested only after approval.

The authoritative commands are:

```bash
node --test tests/buyer-adapter-v5.test.mjs
PYTHONPATH=clients/x402-buyer/python python3 -m unittest clients/x402-buyer/python/test_buyer.py
node --check clients/x402-buyer/src/index.mjs
node --check clients/x402-buyer/src/browser.mjs
python3 -m py_compile clients/x402-buyer/python/crossingkey_x402/*.py
```

## Standards and planning references

The design follows the live MCP discovery contract and x402 v2 challenge
shape. The planning review also checked roadmap.sh's API security checklist for
authentication boundaries, input validation, sensitive-data avoidance, tests,
dependency review, rollback, and monitoring. That checklist is planning input,
not a certification.
