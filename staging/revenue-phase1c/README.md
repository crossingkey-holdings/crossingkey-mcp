# CrossingKey Revenue Phase 1C (staging only)

Base SHA: f907addbaee109f2361da5861ea52732d88168b3 (v5.0.1)

This branch contains independent proposed guards and regression tests ONLY. It does not modify the running server, wallet recipient, or Supabase database.

## Run independent tests

```sh
node --test staging/revenue-phase1c/tests/phase1b.test.mjs
```

These tests are mock/synthetic and do not substitute for integration testing against real checkout and settlement handlers.

## Supabase development branch

Cost quoted on 2026-10-28: $0.01344/hour, subject to additional usage. Existing development branch count: 0. Creation needs explicit additional approval.

## Integration checks before any production change

- Snapshot schema, Edge Function and current receiver settings.
- On a separately approved isolated Supabase branch, add database-side event status, price, currency, link mapping and idempotency checks. Verify live/test mode separation, refund and dispute handling, concurrency, and webhook authorization.
- Reject legacy 0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B as a new treasury destination pending proof of ownership; preserve existing production receiver override 0x2381A81818E0FdCBe36c901e52dD87472ceE6a32.
- On isolated MCP staging, run real repository tests and mocked facilitator failures. No mainnet settlement or transfer permitted under this approval.
- Ensure no production deployment triggered from this branch.
