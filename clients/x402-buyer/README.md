# CrossingKey x402 buyer adapter v5.0.0

This package is the buyer-side payment layer for CrossingKey MCP. It is
separate from the receiver-only v4 server. A buyer agent or human wallet uses
it to discover a v2 `PAYMENT-REQUIRED` challenge (with v1 HTTP fallback), show the exact amount/network/
receiver to a person, obtain explicit approval, ask an injected wallet signer
for a signature, and retry with `PAYMENT-SIGNATURE` (or v1 `X-PAYMENT`).

It never contains a private key, chooses a buyer account, signs automatically,
spends from CrossingKey's receiver wallet, or changes the server. If the buyer
does not provide both an approval callback and a signer callback, paid execution
stops before payment.

## TypeScript / Node

```js
import { BuyerPaymentClient } from "@crossingkey/x402-buyer";

const client = new BuyerPaymentClient({
  approve: async ({ challenge }) => {
    // Render challenge.selected.amount, challenge.selected.network,
    // and challenge.selected.payTo in the buyer's own confirmation UI.
    return await confirmWithHuman(challenge);
  },
  sign: ({ challenge, idempotencyKey }) =>
    buyerWalletAdapter.signX402V2({ challenge, idempotencyKey }),
});

const result = await client.requestJson(
  "https://mcp.crossingkeyintelligence.com/api/x402/hash.encode",
  { input: { text: "hello" }, idempotency_key: "buyer-request-001" },
);
```

## Browser wallets

`createBrowserWalletClient` accepts an EIP-1193 provider. It checks Base
mainnet and requests accounts only after the approval callback returns `true`.
The `signPayment` function is deliberately injected because wallet vendors
choose how they expose EIP-3009/x402 signing.

## Python

```python
from crossingkey_x402 import BuyerClient

client = BuyerClient(
    approve=lambda ctx: show_confirmation_and_get_yes(ctx["challenge"]),
    sign=lambda ctx: wallet_service.sign_x402_v2(ctx["challenge"]),
)
result = client.request(
    "https://mcp.crossingkeyintelligence.com/api/x402/hash.encode",
    body={"input": {"text": "hello"}},
    idempotency_key="buyer-request-001",
)
```

## Compatibility boundary

This release makes a standards-conscious buyer transport available to agents,
browser wallets, and ordinary HTTP clients. It cannot change a host such as
Gemini, Claude, or ChatGPT to add wallet signing. Those hosts must expose a
wallet/signer and a way to attach `PAYMENT-SIGNATURE` or `X-PAYMENT`. The server remains
receiver-only and the no-payment challenge path is testable without funds.
