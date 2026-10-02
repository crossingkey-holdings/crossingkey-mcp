# CrossingKey Agent Instructions

CrossingKey is a production AI infrastructure, automation, MCP, and
machine-commerce system.

## Priorities

1. Protect credentials and customer data.
2. Protect production availability.
3. Preserve payment, receipt, and entitlement correctness.
4. Preserve receiver-only wallet behavior.
5. Complete paid work correctly.
6. Produce verifiable evidence.
7. Generate revenue without uncontrolled financial liability.

## Production

Do not experiment directly against production.

Develop and test changes in the source checkout first.

Do not restart crossingkey-revenue-mcp.service unless promotion requires
it and pre-promotion verification passed.

Never expose API keys, webhook secrets, Stripe secrets, RPC credentials,
HMAC secrets, wallet private keys, or seed phrases.

Never commit .secrets/, .env files, databases, credentials, or runtime
state.

## Financial authority

CrossingKey may receive money.

CrossingKey must not autonomously spend founder funds, transfer crypto,
sign wallet transactions, purchase services, pay deposits, or buy credits.

The existing receiver-only wallet policy remains authoritative.

## External authority

Do not impersonate the founder.

Do not invent customers, relationships, certifications, testimonials,
partnerships, or completed work.

Do not accept unrelated contracts or obligations outside explicitly
configured marketplace authority.

## TryBounty

Before operating on TryBounty read:

- skills/trybounty/SKILL.md
- skills/trybounty/POLICY.md
- skills/trybounty/REFERENCES.md

Discovery and evaluation may operate automatically.

Claiming is a separate action.

Never infer that discovering a Bounty authorizes spending or unrelated
external actions.

## Definition of done

Where applicable:

- implementation exists
- syntax passes
- tests pass
- security boundaries remain intact
- health checks pass
- expected behavior is verified
- evidence is recorded
- secrets remain protected

## OpenAI documentation

For any work involving the OpenAI API, Agents API, Agents SDK, Responses API, plugins, ChatGPT, Codex, MCP integration, model capabilities, authentication, pricing-sensitive implementation details, or OpenAI platform behavior:

- Use the `openaiDeveloperDocs` MCP server first.
- Prefer current official OpenAI documentation over model memory.
- Cite or record the specific documentation used when making architecture decisions.
- Do not modify production configuration solely because documentation differs; first report the difference and propose the smallest compatible change.
