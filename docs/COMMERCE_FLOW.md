# CrossingKey MCP — Commerce Flow

## The one rule

**Discovery is free. Payment is explicit. Nothing in between spends money.**

## Free discovery (no payment possible)

`provider.describe` → `offers.list` → `requirements.check` →
`cost.estimate` → `result.preview` → `execution.preflight` →
(`credits.options`). Every step is read-only. `cost.estimate` is
ESTIMATE_ONLY; `result.preview` reveals result shape, never paid output.

## Paid x402 capabilities

1. The agent calls the paid MCP tool (e.g. `x402.compatibility_audit`).
   **No funds move.** The tool returns an x402 challenge:
   - `payment_required: true`, `price`, `asset`, `network`, `pay_to`
   - `execution_url` — the out-of-band endpoint `/api/x402/:capability`
   - `payment_required_header` — the `PAYMENT-REQUIRED` value
   - `settlement_expectations` — payment is verified then settled on the
     quoted network via the x402 facilitator before any execution; a base64
     settlement receipt returns in the `PAYMENT-RESPONSE` (v2) or
     `X-PAYMENT-RESPONSE` (v1) header
   - `confirmation_expectations` — what the POST must carry and what success
     returns
   - `instruction` — obtain authorized x402 payment signing **outside
     ordinary MCP computation**
2. A human authorizes; signing happens outside the MCP session.
3. The agent `POST`s the same input with a unique `idempotency_key` and the
   `PAYMENT-SIGNATURE` (v2) / `X-PAYMENT` (v1) header to `execution_url`.
4. The server verifies the payment, settles via the facilitator, executes,
   and returns the result with `purchaseId`, `receipt`, and entitlement
   references, plus the settlement header.
5. Retrying with the same `idempotency_key` returns the stored result
   (`duplicate: true`) — never a second charge. Conflicting reuse is
   rejected. Unknown outcomes enter reconciliation; settlement is never
   retried blindly.

## Legacy prepaid request-credit compatibility

V4 does not sell new prepaid request-credit packs. Historical paid balances and
their hashed `ck_` credentials remain protected and can be redeemed only through
`xkey.validate.legacy`. That compatibility path consumes existing credits and
never creates or settles an x402 payment. New `xkey.validate` requests use the
direct $0.10 Base USDC x402 flow and never inspect or mutate the credit ledger.

## Marketplace purchases

1. Discover: `marketplace.describe`, `capability.search` / `catalog.list`,
   `capability.get`.
2. Quote: `commerce.quote` returns the authoritative price breakdown with a
   quote hash.
3. **Human approval** (local-operator/CLI minted, never over MCP) names the
   exact capability, input, idempotency key, and quote, bound to the buyer.
4. `capability.purchase` (authenticated buyer) executes only with a valid
   approval and verified x402 payment.
5. Verify: `approval.verify`, `receipt.verify`, `entitlement.inspect`,
   `idempotency.inspect`.

## Failure semantics

| Situation | Behavior |
|---|---|
| No payment header on POST | `402` with the x402 challenge |
| Ambiguous headers (both v1+v2) | `400 ambiguous_payment_headers` |
| Bad idempotency key | `400 bounded_idempotency_key_required` |
| Payment verification fails | `400 invalid_payment_or_request` |
| Same key, different request/payment | `400` conflict — no new charge |
| Same key, same request | Stored result, `duplicate: true` |
| Replayed payment | Rejected |
| Settlement/execution outcome unknown | `RECONCILIATION_REQUIRED` — reconcile, never blind-retry |
| Webhook signature unverifiable | Rejected, logged without details |

Failed or disputed payments return error codes — never a silent charge.
