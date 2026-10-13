import { createBountyClient } from '../lib/trybounty/client.mjs';
import { qualifyBounty } from '../lib/trybounty/qualification.mjs';

const bounty = createBountyClient();

const results = [];

for await (const summary of bounty.bounties.iterate()) {
  results.push(qualifyBounty(summary));
}

results.sort((a, b) =>
  b.score - a.score ||
  b.payout_cents - a.payout_cents
);

console.log(JSON.stringify({
  ok: true,
  discovered: results.length,
  strong_matches: results.filter(x => x.strong_fit).length,
  candidates: results
}, null, 2));
