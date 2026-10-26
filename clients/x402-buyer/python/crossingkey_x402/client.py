"""Small dependency-free buyer transport.

It intentionally accepts a signer callback. It never stores private keys, chooses
an account, or submits a payment without an explicit approval callback.
"""

import base64
import json
import secrets
import urllib.error
import urllib.request

DEFAULT_NETWORK = "eip155:8453"


class ProtocolError(RuntimeError):
    pass


class PaymentRequired(ProtocolError):
    pass


class AuthorizationRequired(ProtocolError):
    pass


class SettlementError(ProtocolError):
    pass


def _header(headers, name):
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


def _decode_header(value):
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        raise ProtocolError("Missing payment header")
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        try:
            padded = value.replace("-", "+").replace("_", "/")
            padded += "=" * ((4 - len(padded) % 4) % 4)
            return json.loads(base64.b64decode(padded).decode("utf-8"))
        except Exception as exc:
            raise ProtocolError("PAYMENT-REQUIRED is not valid base64 JSON") from exc


def _address(value, field):
    if not isinstance(value, str) or len(value) != 42 or not value.startswith("0x"):
        raise ProtocolError(f"Invalid {field} in PAYMENT-REQUIRED")
    try:
        int(value[2:], 16)
    except ValueError as exc:
        raise ProtocolError(f"Invalid {field} in PAYMENT-REQUIRED") from exc


def parse_payment_required(value, expected_network=DEFAULT_NETWORK, allowed_versions=(2, 1)):
    challenge = _decode_header(value)
    if not isinstance(challenge, dict) or int(challenge.get("x402Version", 0)) not in allowed_versions:
        raise ProtocolError("Unsupported x402 payment-challenge version")
    options = [item for item in challenge.get("accepts", []) if isinstance(item, dict)]
    options = [item for item in options if item.get("scheme") == "exact" and item.get("network") == expected_network]
    if not options:
        raise ProtocolError(f"No exact x402 option for {expected_network}")
    for option in options:
        _address(option.get("asset"), "asset")
        _address(option.get("payTo"), "payTo")
        amount = option.get("amount")
        if not isinstance(amount, str) or not amount.isdigit() or int(amount) <= 0:
            raise ProtocolError("Invalid amount in PAYMENT-REQUIRED")
        timeout = option.get("maxTimeoutSeconds")
        if not isinstance(timeout, int) or not 1 <= timeout <= 600:
            raise ProtocolError("Invalid maxTimeoutSeconds in PAYMENT-REQUIRED")
    selected = options[0]
    return {**challenge, "accepts": options, "selected": selected, **{key: selected[key] for key in ("network", "asset", "payTo", "amount", "maxTimeoutSeconds")}}


def _default_transport(url, method, headers, body):
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read()


class BuyerClient:
    def __init__(self, *, approve=None, sign=None, expected_network=DEFAULT_NETWORK, transport=None):
        self.approve = approve
        self.sign = sign
        self.expected_network = expected_network
        self.transport = transport or _default_transport

    def request(self, url, *, method="POST", body=None, headers=None, idempotency_key=None):
        key = idempotency_key or f"ck-v5-{secrets.token_hex(16)}"
        base_headers = dict(headers or {})
        base_headers["Idempotency-Key"] = key
        if body is not None and not isinstance(body, (bytes, bytearray)):
            body = json.dumps(body).encode("utf-8")
            base_headers.setdefault("Content-Type", "application/json")
        status, response_headers, response_body = self.transport(url, method, base_headers, body)
        if status != 402:
            return {"status": status, "headers": response_headers, "body": self._decode(response_body), "paid": False}
        raw = _header(response_headers, "PAYMENT-REQUIRED") or _header(response_headers, "X-PAYMENT-REQUIRED")
        challenge = parse_payment_required(raw or self._decode(response_body), self.expected_network)
        if not callable(self.approve) or self.approve({"challenge": challenge, "idempotency_key": key, "url": url}) is not True:
            raise AuthorizationRequired("Buyer declined or did not authorize x402 payment")
        if not callable(self.sign):
            raise AuthorizationRequired("A buyer-side wallet signer is required after approval")
        signature = self.sign({"challenge": challenge, "idempotency_key": key, "url": url})
        if not isinstance(signature, str) or not signature.strip():
            raise ProtocolError("Signer must return a non-empty PAYMENT-SIGNATURE payload")
        retry_headers = dict(base_headers)
        retry_headers["X-PAYMENT" if challenge.get("x402Version") == 1 else "PAYMENT-SIGNATURE"] = signature
        retry_status, retry_response_headers, retry_body = self.transport(url, method, retry_headers, body)
        decoded = self._decode(retry_body)
        if retry_status == 402:
            raise PaymentRequired("Payment was not accepted; the server returned another challenge")
        if not 200 <= retry_status < 300:
            raise SettlementError(f"Paid request failed with HTTP {retry_status}")
        receipt_raw = _header(retry_response_headers, "PAYMENT-RESPONSE") or _header(retry_response_headers, "X-PAYMENT-RESPONSE")
        return {"status": retry_status, "headers": retry_response_headers, "body": decoded, "paid": True, "receipt": _decode_header(receipt_raw) if receipt_raw else None, "idempotency_key": key, "challenge": challenge}

    @staticmethod
    def _decode(value):
        if value in (None, b"", ""):
            return None
        if isinstance(value, bytes):
            value = value.decode("utf-8")
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return value
