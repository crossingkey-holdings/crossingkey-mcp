# Final v4.0.0-rc.1 release-blocker report

## Resolved

- npm cache `EROFS`: resolved without modifying the existing cache or system
  configuration by using an isolated writable cache under `/tmp`.
- Current npm metadata obtained successfully.
- `proxy-addr` upgraded to `2.0.8`.
- `ip-address` upgraded to `10.7.4`.
- `fast-uri` upgraded to `3.1.8`.
- `@modelcontextprotocol/sdk` upgraded to `1.32.1`.
- `npm audit`: 0 vulnerabilities after upgrade.
- Full repository suite: 103/103 passed after upgrade.
- Security, transport, payment lifecycle, and TryBounty safety tests passed.
- Two v4 paid audit capabilities have validated contracts, discovery entries,
  bounded execution, and challenge-before-result protection.

## Accepted local risks

- The Base RPC integration test uses a public read-only RPC and reports zero
  writes. This is test evidence, not production deployment evidence.
- The Node SQLite experimental warning remains informational in local startup
  output.
- Audit scoring is deterministic heuristic evidence, not a guarantee of
  endpoint security or payment compatibility.

## Unresolved or unverified

- No real x402 settlement was executed for either new commercial audit.
- No live public endpoint was audited in this task.
- No production service restart or post-deployment verification occurred.
- The complete privileged systemd drop-in remains unreadable and was not
  inspected or bypassed.
- No live Stripe/Shopify/Cloudflare state was changed or reverified.

## Explicit approval required

- Production deployment or service restart.
- Public publication of the new catalog/prices.
- Live payment/settlement verification.
- Cloudflare/DNS/Shopify/Stripe changes.
- Any inspection requiring privileged systemd access.

Release decision: `NOT APPROVED FOR PUBLIC RELEASE` until the unverified
external and privileged checks are separately authorized and completed.
