# Independent-agent compatibility plan

Status: `LOCAL_PLAN — NO EXTERNAL ACTION`

An independent agent can validate this RC without payment, credentials, or
production changes by using a disposable localhost fixture:

1. Start the candidate with `CK_ENABLE_MAINNET=false`, temporary
   `MACHINE_COMMERCE_FILE`, `MARKETPLACE_FILE`, `MARKETPLACE_AUTH_FILE`, and
   `CK_FUNNEL_DB`, empty Stripe values, and dummy HMAC secrets.
2. Allocate a loopback port dynamically.
3. Probe `/health`, `/.well-known/mcp.json`, `/.well-known/x402`, and `/mcp`.
4. Send MCP `initialize`, `tools/list`, and free discovery calls only.
5. Confirm both new tools appear with output schemas and exact prices in local
   discovery/Bazaar metadata.
6. Call the paid tools through MCP and confirm they return a challenge-shaped
   response without contacting a facilitator, changing a wallet, or creating a
   receipt.
7. Use injected local HTTP fixtures to exercise the audit executors without DNS
   or internet access.
8. Run `node --test tests/*.mjs` and `node scripts/trybounty-safety-test.mjs`.
9. Confirm the process exits and the temporary port has no listener.

Compatibility assertions:

- existing streamable HTTP MCP transport remains available
- protocol version `2025-11-25` remains accepted
- v1 and v2 x402 challenge shapes remain available
- free discovery does not start payment
- paid results require the existing x402 authorization path
- receiver-only mode remains declared
- no production endpoint or service is contacted

This plan intentionally excludes real payment headers, production URLs,
production databases, service restarts, deployment, and account changes.
