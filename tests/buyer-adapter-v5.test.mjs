import test from "node:test";
import assert from "node:assert/strict";
import {
  BuyerPaymentClient,
  X402AuthorizationRequiredError,
  X402PaymentRequiredError,
  X402ProtocolError,
  createBrowserWalletClient,
  parsePaymentRequired
} from "../clients/x402-buyer/src/index.mjs";

const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RECEIVER = "0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B";
const challenge = {
  x402Version: 2,
  accepts: [{ scheme: "exact", network: "eip155:8453", asset: ASSET, payTo: RECEIVER, amount: "10000", maxTimeoutSeconds: 60 }]
};

function response(status, body = {}, headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    async text() { return typeof body === "string" ? body : JSON.stringify(body); }
  };
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

test("parses and constrains the Base mainnet v2 challenge", () => {
  const parsed = parsePaymentRequired(base64url(challenge));
  assert.equal(parsed.network, "eip155:8453");
  assert.equal(parsed.amount, "10000");
  assert.equal(parsed.payTo, RECEIVER);
});

test("free response never invokes a signer", async () => {
  let calls = 0;
  const client = new BuyerPaymentClient({
    fetchImpl: async () => response(200, { ok: true }),
    approve: async () => { calls += 1; return true; },
    sign: async () => { calls += 1; return "should-not-run"; }
  });
  const result = await client.request("https://example.test/free", { method: "GET" });
  assert.equal(result.paid, false);
  assert.equal(calls, 0);
});

test("402 stops before signing without explicit approval", async () => {
  let requests = 0;
  let signed = false;
  const client = new BuyerPaymentClient({
    fetchImpl: async () => { requests += 1; return response(402, {}, { "PAYMENT-REQUIRED": base64url(challenge) }); },
    approve: async () => false,
    sign: async () => { signed = true; return "never"; }
  });
  await assert.rejects(() => client.request("https://example.test/paid"), X402AuthorizationRequiredError);
  assert.equal(requests, 1);
  assert.equal(signed, false);
});

test("approval and injected signer retry once with the same idempotency key", async () => {
  const seen = [];
  const client = new BuyerPaymentClient({
    approve: async ({ challenge: selected }) => selected.amount === "10000",
    sign: async () => "buyer-signed-payload",
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init.headers);
      seen.push({ payment: headers.get("PAYMENT-SIGNATURE"), idempotency: headers.get("Idempotency-Key") });
      if (seen.length === 1) return response(402, {}, { "PAYMENT-REQUIRED": base64url(challenge) });
      return response(200, { capability: "hash.encode", digest: "abc" }, { "PAYMENT-RESPONSE": base64url({ status: "settled", network: "eip155:8453" }) });
    }
  });
  const result = await client.request("https://example.test/paid", { method: "POST", idempotencyKey: "buyer-test-001" });
  assert.equal(result.paid, true);
  assert.equal(result.receipt.status, "settled");
  assert.deepEqual(seen, [
    { payment: null, idempotency: "buyer-test-001" },
    { payment: "buyer-signed-payload", idempotency: "buyer-test-001" }
  ]);
});

test("repeated 402 remains a payment failure, not a false success", async () => {
  const client = new BuyerPaymentClient({
    approve: async () => true,
    sign: async () => "buyer-signed-payload",
    fetchImpl: async () => response(402, {}, { "PAYMENT-REQUIRED": base64url(challenge) })
  });
  await assert.rejects(() => client.request("https://example.test/paid"), X402PaymentRequiredError);
});

test("rejects wrong network and malformed payment amount", () => {
  assert.throws(() => parsePaymentRequired({ ...challenge, accepts: [{ ...challenge.accepts[0], network: "eip155:84532" }] }), X402ProtocolError);
  assert.throws(() => parsePaymentRequired({ ...challenge, accepts: [{ ...challenge.accepts[0], amount: "0" }] }), X402ProtocolError);
});

test("uses the legacy v1 request header only when a v1 challenge is returned", async () => {
  const v1 = { ...challenge, x402Version: 1 };
  const headersSeen = [];
  const client = new BuyerPaymentClient({
    approve: async () => true,
    sign: async () => "v1-buyer-payload",
    fetchImpl: async (_url, init) => {
      const headers = new Headers(init.headers);
      headersSeen.push({ payment: headers.get("PAYMENT-SIGNATURE"), legacy: headers.get("X-PAYMENT") });
      return headersSeen.length === 1
        ? response(402, {}, { "X-PAYMENT-REQUIRED": base64url(v1) })
        : response(200, { ok: true });
    }
  });
  const result = await client.request("https://example.test/v1");
  assert.equal(result.paid, true);
  assert.deepEqual(headersSeen, [
    { payment: null, legacy: null },
    { payment: null, legacy: "v1-buyer-payload" }
  ]);
});

test("browser adapter checks Base only after approval and never receives a key", async () => {
  const calls = [];
  const wallet = { request: async (request) => { calls.push(request.method); return request.method === "eth_chainId" ? "0x2105" : [RECEIVER]; } };
  const client = createBrowserWalletClient({
    wallet,
    approve: async () => true,
    signPayment: async ({ wallet: passedWallet }) => { assert.equal(passedWallet, wallet); return "wallet-signed-payload"; },
    fetchImpl: async (_url, init) => init.headers instanceof Headers || init.headers ? response(402, {}, { "PAYMENT-REQUIRED": base64url(challenge) }) : response(500)
  });
  await assert.rejects(() => client.request("https://example.test/paid"), X402PaymentRequiredError);
  assert.deepEqual(calls, ["eth_chainId", "eth_requestAccounts"]);
});
