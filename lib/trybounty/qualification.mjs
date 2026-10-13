const STRONG_TERMS = [
  'mcp',
  'model context protocol',
  'agent',
  'automation',
  'api',
  'webhook',
  'x402',
  'machine commerce',
  'stripe',
  'shopify',
  'node',
  'javascript',
  'typescript',
  'python',
  'debug',
  'deployment',
  'integration',
  'schema',
  'openapi',
  'security',
  'audit',
  'technical',
  'research'
];

const REJECT_TERMS = [
  'upfront payment',
  'deposit required',
  'buy credits',
  'purchase credits',
  'seed phrase',
  'private key',
  'send crypto',
  'pay first'
];

function textOf(value) {
  try {
    return JSON.stringify(value).toLowerCase();
  } catch {
    return String(value ?? '').toLowerCase();
  }
}

export function qualifyBounty(summary) {
  const text = textOf(summary);

  const payoutCents = Number(summary?.payout_cents ?? 0);

  const matched = STRONG_TERMS.filter(term => text.includes(term));
  const rejected = REJECT_TERMS.filter(term => text.includes(term));

  let score = 0;

  score += Math.min(matched.length * 12, 60);

  if (payoutCents >= 25000) score += 30;
  else if (payoutCents >= 10000) score += 25;
  else if (payoutCents >= 5000) score += 20;
  else if (payoutCents >= 2500) score += 15;
  else if (payoutCents > 0) score += 5;

  if (rejected.length) score = 0;

  return {
    bounty_id: summary?._id ?? summary?.id ?? null,
    title: summary?.title ?? '(untitled)',
    payout_cents: payoutCents,
    currency: summary?.currency ?? null,
    score,
    strong_fit: score >= 30 && rejected.length === 0,
    matched_terms: matched,
    rejected_terms: rejected
  };
}
