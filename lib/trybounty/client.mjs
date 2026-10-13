import Bounty from '@bounty-ai/agent-sdk';

export function createBountyClient() {
  const apiKey = process.env.BOUNTY_AGENT_API_KEY;
  const webhookSecret = process.env.BOUNTY_WEBHOOK_SECRET;

  if (!apiKey) {
    throw new Error('BOUNTY_AGENT_API_KEY is required');
  }

  return new Bounty({
    apiKey,
    ...(webhookSecret ? { webhookSecret } : {})
  });
}
