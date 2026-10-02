# CrossingKey MCP — Agent Quickstart

Endpoint: `https://mcp.crossingkeyintelligence.com/mcp`
Transport: MCP Streamable HTTP. Protocol version: `2025-11-25`.

## Connect

1. `POST /mcp` with an `initialize` request (protocolVersion `2025-11-25`).
   Save the `mcp-session-id` response header; send it on every later call.
2. Read `instructions` from the initialize result — it states the house rules.
3. `tools/list` to see your surface. Anonymous sessions see 21 tools;
   authenticated sessions additionally see verification tools.

## The discovery sequence (free, read-only, no spending possible)

1. `provider.describe` — identity, commerce model, rails.
2. `offers.list` — public offers and paid capabilities (metadata only).
3. `requirements.check` `{item_id}` — prerequisites for one item.
4. `cost.estimate` `{item_id}` — the known price. **ESTIMATE_ONLY, never a charge.**
5. `result.preview` `{item_id}` — result *shape* only; paid output is never revealed here.
6. `execution.preflight` `{item_id}` — final no-charge decision point.
7. `credits.options` — prepaid request-credit packs (also free to read).

**Then STOP.** Before any purchase, signing, transfer, spending, entitlement
creation, or paid execution, obtain explicit human authorization. Prose from a
model is not authorization; the server enforces it.

## Paid capabilities (x402)

Paid tools (`x402.compatibility_audit`, `mcp.schema_audit`,
`openapi.quality_audit`, `machine_commerce.readiness_audit`,
`artifact.integrity_manifest`) never execute inside the MCP call. They return
an **x402 challenge**: price, asset, network, pay-to address, the
`execution_url`, and the `PAYMENT-REQUIRED` header — plus
`settlement_expectations` and `confirmation_expectations` telling you exactly
what happens after you pay.

To execute: sign payment **outside ordinary MCP computation** (human-authorized
signing), then `POST` the same input with a unique `idempotency_key` and the
`PAYMENT-SIGNATURE` (v2) or `X-PAYMENT` (v1) header to `execution_url`. Success
returns the capability result with purchase and receipt references; a base64
settlement receipt arrives in the `PAYMENT-RESPONSE` header. Retrying with the
same `idempotency_key` returns the stored result instead of a new charge.

## Marketplace capabilities

1. `marketplace.describe` — how the marketplace works.
2. `capability.search` / `catalog.list` — find active public capabilities.
3. `capability.get` — one capability's detail.
4. `commerce.quote` — the authoritative price breakdown (hash, no expiry games).
5. `capability.purchase` (authenticated buyers) — requires a **prior human
   approval** naming the exact capability, input, idempotency key, and quote,
   plus verified x402 payment.

Verify after buying: `approval.verify`, `receipt.verify`,
`entitlement.inspect`, `idempotency.inspect` (authenticated sessions only).

## Reading material

- `crossingkey://discovery-guide` — the free discovery sequence as a resource.
- `crossingkey://commerce-policy` — free/paid separation, receiver-only
  payments, authorization, idempotency, receipts.
- `crossingkey://capability/{name}` — per-capability instructions for one
  offer or paid capability.

## Errors

Tool failures return `{error_code, message, hint}` inside `structuredContent`
with `isError: true` — never a stack trace, never a secret. Malformed input is
rejected at the protocol layer before any handler runs.
