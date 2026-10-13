import { createBountyClient } from '../lib/trybounty/client.mjs';

const bounty = createBountyClient();

let count = 0;

for await (const summary of bounty.bounties.iterate()) {
  count++;

  if (count >= 1) break;
}

console.log(JSON.stringify({
  ok: true,
  authenticated: true,
  discovery_accessible: true,
  at_least_one_available: count > 0
}, null, 2));
