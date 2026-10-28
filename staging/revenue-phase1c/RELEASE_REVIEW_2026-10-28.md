# CrossingKey Revenue | Production readiness review

**Status: NO-GO for production deployment.** This is a staging-only review, not deployment approval.

## Read-only production verification (2026-10-28)

Project: `jurkqfzsymtsydclhvvx`. The active Stripe Edge Function is `stripe-webhook` version 9, SHA-256 `956050ae72eeba6d44cbb44103d3b4c2795aef3ae4174f479b79520d9ed19014`. It verifies a Stripe HMAC signature and mode; a staging candidate provides stricter event admission. The currently deployed function has **not** been updated.

Two `public.dock_fulfill_stripe_event` function overloads remain:
- Ten arguments, definition MD5 `b4af8d7cf9298d614efdbf0a91161f01`.
- Eleven arguments, definition MD5 `e5d479b5be06b0e8cd0c6f103852cd7c`.

Both are SECURITY DEFINER; reported explicit EXECUTE ACL is `postgres` and `service_role`. The webhook passes `p_client_reference_id` and therefore invokes the 11-argument overload. A read-only pg_depend query returned **no catalog dependents** of the two functions; that does **not** prove no external client or service-role application calls the legacy overload. Search code and deployment configuration before removing it.

The current SQL staging candidate repairs price/currency verification, generic full-refund revocation, custom-build checks, and duplicate receipts. A GitHub Actions run verified 44 Node.js tests and disposable PostgreSQL function checks. That is **not** an end-to-end Stripe checkout proof.

## Deployment blockers

1. Search every service-role caller for the ten-argument overload and decide whether to remove, deny, or safely bridge it. A second unguarded privileged entry point must not remain.
2. Review the deployment pair: `sql/03_guarded_fulfillment_candidate.sql` and `stripe-webhook.candidate.ts` with `stripe-event-policy.mjs`. Preserve Stripe signature verification, mode verification, and `payment_status=paid`.
3. Validate the actual Deno Edge Function with signed Stripe test events, including invalid signature, mode mismatch, replay, partial and full refunds. A unit test of the helper alone is insufficient.
4. Confirm the product policy for **partial refunds**, **disputes**, and eventual restoration after reversal. Proposal: full refund revokes; partial refund requires manual review; disputes suspend paid access pending resolution and audit. Neither partial refund nor dispute handling should be silently inferred from existing SQL.
5. Capture current function definitions, grants, schema, Edge Function source, and the currently configured Stripe endpoint before any deployment. Do not commit credentials or private customer records.
6. Verify migration rollback and event reconciliation in a disposable environment. The existing ten-argument function must be retired safely or fenced from all callers before declaring release-ready.

## Zero-cost release test gate

Use the established public GitHub Actions PostgreSQL 16 service and Node.js tests. No new Supabase branch is necessary for SQL unit/integration checks. The Deno Edge Function and exact Supabase runtime still require explicit deployment testing, which may have limitations in a generic PostgreSQL runner.

## Suggested controlled rollback (only if later authorized)

- Pause entitlement fulfillment rather than customer checkout wherever possible; preserve incoming events and provider retries.
- Restore exact snapshotted Edge Function code and the correct SQL definitions/ACLs in the coordinated rollback order.
- Be aware that restoring the vulnerable legacy SQL can reopen the known underpayment defect. Keep fulfillment gated until a fixed version is ready.
- Reconcile events, entitlements, refunds, and receipts without deleting immutable audit records.
- Verify sign-off tests and replay safety before re-enabling fulfillment.

## Payment destination / withdrawal readiness

Keep the verified Coinbase CDP x402 receiver `0x2381A81818E0FdCBe36c901e52dD87472ceE6a32`. The historical Base payout destination `0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B` must not be used for new transfers until ownership is verified. Coinbase Business off-ramp and bank payout eligibility require separate confirmation. No real money movement is approved by this review.

## Safety boundary

No production database, webhook, wallet, payout method, Cloudflare deployment, or payment was changed by this review.
