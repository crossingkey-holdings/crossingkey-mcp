#!/usr/bin/env node

import "dotenv/config";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";

const ENDPOINT =
  "https://mcp.crossingkeyintelligence.com/api/x402/artifact.integrity_manifest?x402Version=2";

const EXPECTED_BUYER =
  "0xb2addD4D19d7770850Ef03A64906fE9be9F03d50";

const EXPECTED_RECEIVER =
  "0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28";

const EXPECTED_NETWORK = "eip155:84532";

const EXPECTED_ASSET =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const EXPECTED_AMOUNT = "100000"; // 0.10 USDC

function die(message) {
  console.error(`\nABORT: ${message}`);
  process.exit(1);
}

function decodeBase64Json(value) {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

/*
 * Load the buyer key from a local ignored file.
 * NEVER print this value.
 */
let privateKey;

try {
  const envText = readFileSync(
    ".secrets/x402-sepolia-buyer.env",
    "utf8"
  );

  const match = envText.match(
    /^X402_BUYER_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m
  );

  if (!match) {
    die("X402_BUYER_PRIVATE_KEY missing or malformed.");
  }

  privateKey = match[1];
} catch (err) {
  die(`Cannot read buyer secret: ${err.message}`);
}

const account = privateKeyToAccount(privateKey);

console.log("\n=== CROSSINGKEY x402 BUYER ===");
console.log("Derived buyer:", account.address);
console.log("Expected buyer:", EXPECTED_BUYER);

if (
  account.address.toLowerCase() !==
  EXPECTED_BUYER.toLowerCase()
) {
  die("Private key does NOT belong to the funded test buyer.");
}

/*
 * PRE-FLIGHT
 *
 * Ask CrossingKey for the payment challenge BEFORE signing.
 */
console.log("\n=== PRE-FLIGHT 402 ===");

const body = {
  idempotency_key: "sepolia-e2e-005",
  input: {
    artifacts: [{ name: "crossingkey-x402-sepolia-e2e.txt", content: "CrossingKey Base Sepolia x402 v2 end-to-end verification" }]
  }
};

const probe = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    "content-type": "application/json"
  },
  body: JSON.stringify(body)
});

console.log("HTTP:", probe.status);

if (probe.status !== 402) {
  console.log(await probe.text());
  die(`Expected HTTP 402, received ${probe.status}.`);
}

const paymentRequiredHeader =
  probe.headers.get("payment-required");

if (!paymentRequiredHeader) {
  die("Server returned 402 without PAYMENT-REQUIRED.");
}

let challenge;

try {
  challenge = decodeBase64Json(paymentRequiredHeader);
} catch {
  die("PAYMENT-REQUIRED was not valid base64 JSON.");
}

if (challenge.x402Version !== 2) {
  die(`Unexpected x402 version: ${challenge.x402Version}`);
}

if (!Array.isArray(challenge.accepts)) {
  die("Challenge has no accepts array.");
}

const requirement = challenge.accepts.find(
  x =>
    x.scheme === "exact" &&
    x.network === EXPECTED_NETWORK
);

if (!requirement) {
  die("No exact Base Sepolia payment requirement.");
}

console.log("scheme:   ", requirement.scheme);
console.log("network:  ", requirement.network);
console.log("asset:    ", requirement.asset);
console.log("payTo:    ", requirement.payTo);
console.log("amount:   ", requirement.amount);

if (requirement.network !== EXPECTED_NETWORK)
  die("NETWORK MISMATCH.");

if (
  requirement.asset.toLowerCase() !==
  EXPECTED_ASSET.toLowerCase()
)
  die("USDC ASSET MISMATCH.");

if (
  requirement.payTo.toLowerCase() !==
  EXPECTED_RECEIVER.toLowerCase()
)
  die("RECEIVER MISMATCH.");

if (String(requirement.amount) !== EXPECTED_AMOUNT)
  die("PRICE MISMATCH.");

console.log("\nPRE-FLIGHT PASSED.");
console.log("Maximum authorized payment: 0.10 test USDC");

/*
 * PAYMENT CLIENT
 *
 * The private key remains local.
 * ExactEvmScheme creates the signed x402 authorization.
 */
const client = new x402Client();

client.register(
  EXPECTED_NETWORK,
  new ExactEvmScheme(account)
);

const payingFetch =
  wrapFetchWithPayment(fetch, client);

console.log("\n=== SIGN + PURCHASE ===");
console.log("Buyer:   ", account.address);
console.log("Receiver:", EXPECTED_RECEIVER);
console.log("Network: ", EXPECTED_NETWORK);
console.log("Amount:   0.10 test USDC");

const response = await payingFetch(ENDPOINT, {
  method: "POST",

  headers: {
    "content-type": "application/json"
  },

  body: JSON.stringify(body)
});

console.log("\n=== PURCHASE RESPONSE ===");
console.log("HTTP:", response.status);

const paymentResponse =
  response.headers.get("payment-response");

if (paymentResponse) {
  console.log(
    "PAYMENT-RESPONSE:",
    paymentResponse
  );
} else {
  console.log("PAYMENT-RESPONSE: <missing>");
}

const responseText = await response.text();

console.log("\n=== BODY ===");

try {
  console.log(
    JSON.stringify(
      JSON.parse(responseText),
      null,
      2
    )
  );
} catch {
  console.log(responseText);
}

if (!response.ok) {
  die(`Paid request failed with HTTP ${response.status}.`);
}

console.log("\n================================");
console.log("CROSSINGKEY x402 PURCHASE PASSED");
console.log("================================");
