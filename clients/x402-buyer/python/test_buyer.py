import unittest

from crossingkey_x402 import AuthorizationRequired, BuyerClient, parse_payment_required

ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
RECEIVER = "0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B"
CHALLENGE = {
    "x402Version": 2,
    "accepts": [{"scheme": "exact", "network": "eip155:8453", "asset": ASSET, "payTo": RECEIVER, "amount": "10000", "maxTimeoutSeconds": 60}],
}


class BuyerAdapterTests(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(parse_payment_required(CHALLENGE)["network"], "eip155:8453")

    def test_decline_does_not_retry(self):
        calls = []

        def transport(_url, _method, headers, _body):
            calls.append(headers)
            return 402, {"PAYMENT-REQUIRED": __import__("json").dumps(CHALLENGE)}, b"{}"

        client = BuyerClient(approve=lambda _ctx: False, sign=lambda _ctx: "never", transport=transport)
        with self.assertRaises(AuthorizationRequired):
            client.request("https://example.test/paid")
        self.assertEqual(len(calls), 1)

    def test_approved_retry_preserves_key(self):
        calls = []

        def transport(_url, _method, headers, _body):
            calls.append(headers.copy())
            if len(calls) == 1:
                return 402, {"PAYMENT-REQUIRED": __import__("json").dumps(CHALLENGE)}, b"{}"
            return 200, {"PAYMENT-RESPONSE": __import__("json").dumps({"status": "settled"})}, b'{"ok":true}'

        client = BuyerClient(approve=lambda _ctx: True, sign=lambda _ctx: "buyer-signed", transport=transport)
        result = client.request("https://example.test/paid", idempotency_key="py-test-001")
        self.assertTrue(result["paid"])
        self.assertEqual(calls[0]["Idempotency-Key"], calls[1]["Idempotency-Key"])
        self.assertEqual(calls[1]["PAYMENT-SIGNATURE"], "buyer-signed")


if __name__ == "__main__":
    unittest.main()
