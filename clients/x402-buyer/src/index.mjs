const DEFAULT_NETWORK = "eip155:8453";
const PAYMENT_REQUIRED_HEADERS = ["PAYMENT-REQUIRED", "X-PAYMENT-REQUIRED"];
const PAYMENT_RESPONSE_HEADERS = ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"];

export class X402ProtocolError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "X402ProtocolError";
    Object.assign(this, details);
  }
}

export class X402PaymentRequiredError extends X402ProtocolError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "X402PaymentRequiredError";
  }
}

export class X402AuthorizationRequiredError extends X402ProtocolError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "X402AuthorizationRequiredError";
  }
}

export class X402SettlementError extends X402ProtocolError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "X402SettlementError";
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeBase64Json(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const decoded = typeof atob === "function"
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    throw new X402ProtocolError("PAYMENT-REQUIRED is not valid base64 JSON", { cause: error });
  }
}

function readHeader(headers, names) {
  if (!headers) return null;
  for (const name of names) {
    const value = typeof headers.get === "function" ? headers.get(name) : headers[name] ?? headers[name.toLowerCase()];
    if (value) return value;
  }
  return null;
}

export function decodePaymentHeader(value) {
  if (!value) throw new X402ProtocolError("Missing payment header");
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return decodeBase64Json(trimmed);
  }
}

function validateAddress(value, field) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new X402ProtocolError(`Invalid ${field} in PAYMENT-REQUIRED`);
  }
}

function validateAmount(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new X402ProtocolError("Invalid amount in PAYMENT-REQUIRED");
  }
}

export function parsePaymentRequired(value, { expectedNetwork = DEFAULT_NETWORK, allowedVersions = [2, 1] } = {}) {
  let challenge = value;
  if (typeof value === "string") challenge = decodePaymentHeader(value);
  if (!isObject(challenge)) throw new X402ProtocolError("PAYMENT-REQUIRED must be an object");
  const version = Number(challenge.x402Version);
  if (!allowedVersions.includes(version)) {
    throw new X402ProtocolError("Unsupported x402 payment-challenge version", { challenge });
  }
  if (!Array.isArray(challenge.accepts) || challenge.accepts.length === 0) {
    throw new X402ProtocolError("PAYMENT-REQUIRED has no payment options", { challenge });
  }
  const options = challenge.accepts.filter((option) => {
    return isObject(option) && option.scheme === "exact" && option.network === expectedNetwork;
  });
  if (options.length === 0) {
    throw new X402ProtocolError(`No exact x402 option for ${expectedNetwork}`, { challenge });
  }
  for (const option of options) {
    validateAddress(option.asset, "asset");
    validateAddress(option.payTo, "payTo");
    validateAmount(option.amount);
    if (!Number.isInteger(option.maxTimeoutSeconds) || option.maxTimeoutSeconds < 1 || option.maxTimeoutSeconds > 600) {
      throw new X402ProtocolError("Invalid maxTimeoutSeconds in PAYMENT-REQUIRED");
    }
  }
  const selected = options[0];
  return Object.freeze({
    ...challenge,
    accepts: Object.freeze(options.map((option) => Object.freeze({ ...option }))),
    selected,
    network: selected.network,
    asset: selected.asset,
    payTo: selected.payTo,
    amount: selected.amount,
    maxTimeoutSeconds: selected.maxTimeoutSeconds
  });
}

function makeIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `ck-v5-${globalThis.crypto.randomUUID()}`;
  return `ck-v5-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readBody(response) {
  if (!response) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function isSuccessful(status) {
  return status >= 200 && status < 300;
}

export class BuyerPaymentClient {
  constructor({ fetchImpl = globalThis.fetch, approve, sign, expectedNetwork = DEFAULT_NETWORK } = {}) {
    if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
    this.fetchImpl = fetchImpl;
    this.approve = approve;
    this.sign = sign;
    this.expectedNetwork = expectedNetwork;
  }

  async request(input, init = {}) {
    const idempotencyKey = init.idempotencyKey ?? init.headers?.["Idempotency-Key"] ?? makeIdempotencyKey();
    const headers = new Headers(init.headers ?? {});
    headers.set("Idempotency-Key", idempotencyKey);
    const firstResponse = await this.fetchImpl(input, { ...init, headers });
    if (firstResponse.status !== 402) return { response: firstResponse, data: await readBody(firstResponse), paid: false };

    const rawChallenge = readHeader(firstResponse.headers, PAYMENT_REQUIRED_HEADERS);
    let challenge;
    if (rawChallenge) {
      challenge = parsePaymentRequired(rawChallenge, { expectedNetwork: this.expectedNetwork });
    } else {
      const body = await readBody(firstResponse);
      challenge = parsePaymentRequired(body, { expectedNetwork: this.expectedNetwork });
    }

    if (typeof this.approve !== "function") {
      throw new X402AuthorizationRequiredError("Explicit buyer approval is required before signing or payment", { challenge, idempotencyKey });
    }
    const approved = await this.approve({ challenge, idempotencyKey, request: input });
    if (approved !== true) {
      throw new X402AuthorizationRequiredError("Buyer declined x402 payment", { challenge, idempotencyKey });
    }
    if (typeof this.sign !== "function") {
      throw new X402AuthorizationRequiredError("A buyer-side wallet signer is required after approval", { challenge, idempotencyKey });
    }
    const signature = await this.sign({ challenge, idempotencyKey, request: input });
    if (typeof signature !== "string" || signature.trim() === "") {
      throw new X402ProtocolError("Signer must return a non-empty PAYMENT-SIGNATURE payload", { challenge, idempotencyKey });
    }

    const retryHeaders = new Headers(init.headers ?? {});
    retryHeaders.set("Idempotency-Key", idempotencyKey);
    retryHeaders.set(challenge.x402Version === 1 ? "X-PAYMENT" : "PAYMENT-SIGNATURE", signature);
    const retryResponse = await this.fetchImpl(input, { ...init, headers: retryHeaders });
    const data = await readBody(retryResponse);
    if (retryResponse.status === 402) {
      const retryChallenge = readHeader(retryResponse.headers, PAYMENT_REQUIRED_HEADERS);
      throw new X402PaymentRequiredError("Payment was not accepted; the server returned another challenge", {
        challenge: retryChallenge ? parsePaymentRequired(retryChallenge, { expectedNetwork: this.expectedNetwork }) : challenge,
        idempotencyKey,
        data
      });
    }
    if (!isSuccessful(retryResponse.status)) {
      throw new X402SettlementError(`Paid request failed with HTTP ${retryResponse.status}`, { response: retryResponse, data, challenge, idempotencyKey });
    }
    const paymentResponse = readHeader(retryResponse.headers, PAYMENT_RESPONSE_HEADERS);
    return {
      response: retryResponse,
      data,
      paid: true,
      idempotencyKey,
      challenge,
      receipt: paymentResponse ? decodePaymentHeader(paymentResponse) : null
    };
  }

  async requestJson(input, body, init = {}) {
    const headers = new Headers(init.headers ?? {});
    headers.set("content-type", "application/json");
    return this.request(input, { ...init, method: init.method ?? "POST", headers, body: JSON.stringify(body) });
  }
}

export function createBrowserWalletClient({ wallet, approve, signPayment, fetchImpl = globalThis.fetch, expectedNetwork = DEFAULT_NETWORK } = {}) {
  if (!wallet || typeof wallet.request !== "function") throw new TypeError("An EIP-1193 wallet provider is required");
  if (typeof signPayment !== "function") throw new TypeError("signPayment is required; the adapter never handles private keys");
  const guardedApprove = async (context) => {
    if (typeof approve !== "function" || (await approve(context)) !== true) return false;
    const chainId = await wallet.request({ method: "eth_chainId" });
    if (String(chainId).toLowerCase() !== "0x2105") {
      throw new X402ProtocolError("Buyer wallet must be connected to Base mainnet (chain 8453)");
    }
    await wallet.request({ method: "eth_requestAccounts" });
    return true;
  };
  const sign = (context) => signPayment({ ...context, wallet });
  return new BuyerPaymentClient({ fetchImpl, approve: guardedApprove, sign, expectedNetwork });
}

export { DEFAULT_NETWORK };
