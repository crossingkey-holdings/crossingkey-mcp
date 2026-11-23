# Commercial Audit Launch Gates

Status: NOT CLEARED FOR PAID CUSTOMER LAUNCH

This document defines the minimum evidence required before CrossingKey advertises or accepts payment for its first paid audit offers. It does not assert that any gate has passed.

## Existing source facts

- Source package version: 5.0.1.
- Production MCP endpoint documented: https://mcp.crossingkeyintelligence.com/mcp
- Production health version documented as 5.0.1.
- Production x402 discovery was documented advertising receiver 0x2381A81818E0FdCBe36c901e52dD87472ceE6a32.
- Canonical source receiver is 0x1cc1c0576874b30b0ba014abb93c0768a3fa1cb4.
- Payment readiness is explicitly blocked until live x402 discovery AND a fresh unpaid challenge match the canonical receiver.
- live-status.json says mcpInitializeVerified=false.
- package.json includes Stripe SDK and commercial monitoring scripts, but their presence alone does not establish an operational customer checkout, webhook, fulfillment, or delivery workflow.

## Launch offers (proposed; not yet activated)

1. MCP Launch Check — $49
   Bounded review of supplied MCP tool definitions and schemas; tool descriptions, input contracts, discoverability, and prioritized findings.
2. Agent Interface Audit — $149
   Bounded review of MCP schemas plus supplied OpenAPI and prompt artifacts; evidence-backed findings and remediation guidance.
3. Machine Commerce Readiness — $299
   Bounded review of discovery, x402 compatibility, payment/authorization boundaries, and execution-readiness evidence.

Prices are launch hypotheses, not validated market rates. Do not create live payment links or accept payment until checkout, webhook verification, fulfillment, refunds/support policy, and delivery are tested.

## Required gates

### G0 — Production payment safety
- Reconcile deployed x402 receiver with canonical source receiver.
- Verify live discovery metadata and a fresh unpaid x402 challenge both advertise the canonical receiver.
- Confirm Base mainnet, USDC contract, network, amount units, and receiver-only policy.
- Run an end-to-end test using a safe test/staging path. Never send a real payment to an unverified receiver.
- Confirm no paid execution can proceed on mismatched or uncertain settlement.

### G1 — Audit truthfulness and repeatability
- Map each advertised offer to exact existing tools and supported inputs.
- Define scope, exclusions, evidence requirements, severity rubric, and deterministic report schema.
- Test representative clean, malformed, and adversarial fixtures.
- Label heuristic checks accurately; do not claim certification or guaranteed security.
- Ensure reports distinguish observed evidence, inferred risk, and recommendations.

### G2 — Customer transaction workflow
- Publish scope, turnaround expectation, data handling/retention, refund/cancellation, and support terms.
- Implement intake with file/type/size validation and explicit customer consent.
- Implement Stripe Checkout only if Stripe is the chosen payment rail; verify webhook signatures and idempotency server-side.
- Bind payment to immutable order, selected offer, scope, and customer contact.
- Do not trust browser redirects as proof of payment.
- Ensure retries cannot double-charge or duplicate fulfillment.

### G3 — Fulfillment and delivery
- Generate a consistent PDF/HTML report from validated audit results.
- Include scope, version, timestamp, methodology, evidence, severity, limitations, remediation, and retest criteria.
- Store report and transaction records securely; minimize sensitive input retention.
- Deliver through an authenticated or expiring link; verify access controls.
- Create a receipt and audit trail. Do not expose customer artifacts publicly.

### G4 — Operational readiness
- Test checkout success, cancellation, failed payment, duplicate webhook, delayed/uncertain settlement, audit failure, report failure, refund, and delivery retry.
- Add alerting for stuck orders and failed fulfillment.
- Verify backups, access controls, rate limits, abuse controls, privacy notice, terms, and support contact.
- Complete a production smoke test and record evidence before launch.

## Launch decision rule

Do not advertise the offers as purchasable and do not accept customer funds until G0-G4 have passing evidence. Until then, use a non-binding expression-of-interest or manual quote workflow only, clearly labeled as not yet accepting payment.

## Commerce validation metrics

Track qualified inquiries, paid conversion, average fulfillment time, audit failure rate, refund rate, repeat purchase/retest rate, customer-reported usefulness, and contribution margin after payment and execution costs.

The marketplace should expand only from observed customer demand and successful, documented transactions.
