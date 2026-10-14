# x402 bilingual compatibility

The candidate advertises x402 v2 as the preferred HTTP protocol and accepts
the official x402 v1 HTTP envelope through a separate compatibility path.

| Transport | v1 | v2 |
|---|---|---|
| HTTP challenge | JSON `x402Version: 1` body | Base64 `PAYMENT-REQUIRED` header containing `x402Version: 2` |
| Payment request | `X-PAYMENT` | `PAYMENT-SIGNATURE` |
| Settlement response | `X-PAYMENT-RESPONSE` | `PAYMENT-RESPONSE` |
| Network label | `base` / `base-sepolia` | CAIP-2 `eip155:8453` / `eip155:84532` |
| Amount field | `maxAmountRequired` | `amount` |

The server rejects unsupported versions, ambiguous v1/v2 request headers, and
envelopes containing fields from the other protocol. Both versions enter the
same verify-before-settle, replay, idempotency, receipt, and entitlement path.

MCP tool calls return an x402 HTTP challenge fallback. This candidate does not
claim a native MCP payment exchange: clients must authorize and submit the
version-appropriate HTTP request to the advertised execution URL. The
facilitator's live v1 support remains an environment-specific verification
item; local fixtures verify that the version is forwarded without bypassing
verification.
