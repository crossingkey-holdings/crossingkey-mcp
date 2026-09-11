import {
  createPublicClient,
  http,
  parseAbiItem,
  formatUnits
} from "viem";

import { baseSepolia } from "viem/chains";

const USDC =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const BUYER =
  "0xb2addD4D19d7770850Ef03A64906fE9be9F03d50";

const RECEIVER =
  "0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28";

const client = createPublicClient({
  chain: baseSepolia,
  transport: http("https://sepolia.base.org")
});

const transfer = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

console.log("=== CROSSINGKEY x402 SETTLEMENT AUDIT ===");
console.log("NETWORK=eip155:84532");
console.log("USDC=" + USDC);
console.log("BUYER=" + BUYER);
console.log("RECEIVER=" + RECEIVER);

const latest = await client.getBlockNumber();
const floor = latest > 20000n ? latest - 20000n : 0n;

console.log("LATEST_BLOCK=" + latest);
console.log("SEARCH_FROM=" + floor);

let matches = [];

for (let from = floor; from <= latest; from += 500n) {
  const to =
    from + 499n > latest
      ? latest
      : from + 499n;

  const logs = await client.getLogs({
    address: USDC,
    event: transfer,
    args: {
      from: BUYER,
      to: RECEIVER
    },
    fromBlock: from,
    toBlock: to
  });

  matches.push(...logs);
}

console.log("MATCHING_TRANSFERS=" + matches.length);

for (const log of matches) {
  const block = await client.getBlock({
    blockNumber: log.blockNumber
  });

  console.log("");
  console.log("=== TRANSFER ===");
  console.log("TX_HASH=" + log.transactionHash);
  console.log("BLOCK=" + log.blockNumber);

  console.log(
    "TIMESTAMP=" +
      new Date(
        Number(block.timestamp) * 1000
      ).toISOString()
  );

  console.log("RAW_AMOUNT=" + log.args.value);
  console.log(
    "USDC_AMOUNT=" +
      formatUnits(log.args.value, 6)
  );

  if (log.args.value === 100000n) {
    console.log("EXPECTED_X402_AMOUNT=YES");
  }
}

if (matches.length === 0) {
  console.log("");
  console.log("FIRST_ATTEMPT_SETTLEMENT=NOT_FOUND");
}
