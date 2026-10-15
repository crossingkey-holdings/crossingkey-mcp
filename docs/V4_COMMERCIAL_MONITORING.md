# CrossingKey MCP v4 commercial monitoring

Status: staged deployment support. Installing or enabling the user timer is a
separate host change; these repository files do not modify systemd.

The application reuses its existing `CK_FUNNEL_DB` SQLite database. Aggregate
counters remain in `funnel_snapshots`; a bounded `payment_attempts` table keeps
the newest 5,000 privacy-safe attempt records by default. The database is set
to mode `0600`. Set `CK_PAYMENT_ATTEMPT_MAX_ROWS` to a value from 100 through
50,000 when a different local retention bound is required.

Recorded fields are limited to timestamps, generated correlation IDs,
capability and route identifiers, synthetic/request stage booleans, stage
outcomes, HTTP status, latency, safe classification, application version, and
truncated nonsecret receipt or transaction references. Payment proofs,
signatures, authorization headers, bearer tokens, request bodies, wallet
secrets, and buyer-identifying data are not recorded.

`EXPECTED_UNPAID_402` is a healthy payment challenge outcome. Its neutral
commercial state is `UNCONVERTED_CHALLENGE`; it is not actionable and is never
called buyer abandonment. Synthetic requests use the explicit
`X-CrossingKey-Synthetic: 1` header and are separately counted.

Operator commands:

```bash
npm run monitor:status
npm run monitor:funnel
npm run monitor:failures
node scripts/commercial-monitor.mjs unconverted
node scripts/commercial-monitor.mjs facilitator-errors
node scripts/synthetic-commercial-monitor.mjs http://127.0.0.1:3401
systemctl --user status crossingkey-mcp-v4-monitor.timer --no-pager
journalctl --user -u crossingkey-mcp-v4-monitor.service -n 100 --no-pager
```

The synthetic monitor performs health, discovery, MCP initialize, tools/list,
and all 13 unpaid x402 challenge checks. It never submits a payment proof,
retries a chargeable operation, calls a facilitator, or changes routing. A
failure makes the oneshot unit fail for operator alerting; it never restarts,
repairs, reroutes, or mutates production.

Observable funnel stages are discovery, paid capability inquiry, challenge,
proof receipt, verification, settlement, receipt, entitlement, and paid
execution. Buyer intent, buyer abandonment, and agent activity outside
CrossingKey-controlled infrastructure are `NOT_OBSERVABLE`.
