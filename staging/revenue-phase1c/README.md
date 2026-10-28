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


## Phase 1C SQL validation (2026-10-28)

The CI workflow now provisions disposable PostgreSQL 16 as a GitHub Actions service.
It imports the actual 11-argument `public.dock_fulfill_stripe_event` implementation
retrieved read-only with `pg_get_functiondef`, plus synthetic tables constrained to
the inspected production column contracts.

Sequence:
1. `sql/01_snapshot_generic.sql`: disposable fixture and original generic helper.
2. `sql/02_actual_fulfillment.sql`: exact production function snapshot (read-only capture).
3. `sql/00_baseline_regression.sql`: deliberately reproduces the underpayment defect inside `BEGIN/ROLLBACK`.
4. `sql/03_guarded_fulfillment_candidate.sql`: staging-only candidate, with checkout type/session checks, serial checkout locking, and price/currency checks in generic-plan path.
5. `sql/04_fulfillment_regression.sql`: actual SQL function validations for valid purchases, replay, second event for same session, independent purchase, sandbox isolation, refund/intent rejection, wrong link/session, and price/currency mismatch.
6. `tests/sql-concurrent.sh`: separate PostgreSQL sessions race distinct events for the same checkout, expect one entitlement.

**Coverage limits / release blockers**
- A database RPC does not receive Stripe's signed event, so the Edge Function's HMAC and `payment_status=paid` checks must remain authoritative. The DB gate alone cannot verify actual payment.
- The generic subscription/plan revocation path on `charge.refunded` is not fully implemented by this candidate. Invalid/reversed payments must revoke the corresponding entitlements before deployment.
- The production function retains the custom-build branch with specific price/link checks; this test suite is focused on generic plan fulfillment. Add custom-build and refund tests before any migration.
- Candidate functions are not deploy-ready: separately review all signature overloads, permissions, caller expectations, migrations, rollback, old records, and schema drift.
- Only the GitHub staging branch has been modified. No live Supabase migration, deployment, real Stripe charge, wallet transfer, or new billable service has been executed.


## Phase 1D: refund, signed webhook, custom build validation (staging only)

Added:
- `sql/03_guarded_fulfillment_candidate.sql`: generic full-refund entitlement revocation; guarded build-reference lookup, build price and currency checks, and idempotent repeat refund receipts.
- `sql/05_refunds_custom_builds.sql`: disposable PostgreSQL tests for generic refunds, replay, unknown custom builds, wrong price/currency, valid owner-bound build purchase, duplicate build checkout, full refund, and duplicate refund.
- `stripe-event-policy.mjs`: runtime-neutral strict HMAC and admission policy. Accepts valid paid checkout sessions and fully refunded charge events only; rejects partial refunds, missing identifiers, wrong object shapes, and unsupported payment intent events.
- `stripe-webhook.candidate.ts`: proposed revision of the actual Supabase Edge Function using the shared validation policy; **not deployed**.
- `tests/stripe-authentication.test.mjs`: exercises actual cryptographic HMAC verification of signed fixture payloads and checkout/refund admission policies.

**Important release constraints:** The staged webhook and SQL candidate are not deployed. A Stripe-signed request can originate from an authentic but erroneous or unexpected event, so payment object verification, mode matching, and database fail-closed guards remain mandatory. A database RPC cannot itself verify a Stripe signature. Partial refunds and disputes require a separately specified policy. Full refund verification is applied at the webhook boundary, while the database assumes only the trusted service-role function may call the RPC. Confirm exact Stripe event object fields and all deployed RPC overloads before production approval. No real payment, money transfer, database migration, or service deployment occurred.
