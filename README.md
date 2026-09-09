# crossingkey-mcp

Public source for the CrossingKey MCP server.

Production MCP endpoint: https://mcp.crossingkeyintelligence.com/mcp

Official MCP Registry identity: com.crossingkeyintelligence/revenue-mcp

Current public server version: 2.1.0

## Capabilities

- Offer discovery
- Stripe checkout discovery
- Prepaid-credit commerce
- Fulfillment status
- Request-service discovery
- Authenticated bounded paid execution

The first production paid capability is bounded XKEY intake validation.

## Execution model

Agent -> MCP discovery -> authorization -> credit balance -> reserve -> bounded capability -> verify -> sanitize -> receipt -> commit/release

Discovery is free. Paid execution is separately authorized and metered.

The server does not expose arbitrary shell access or unrestricted filesystem access.

## Fulfillment

Digital delivery readiness requires the delivery artifact to exist and its SHA-256 digest to match the fulfillment manifest.

Paid artifacts are not stored in this public repository.

## Security

The deployment follows an NSA-aligned hardening approach. This does not imply NSA certification or formal compliance.

## CrossingKey Intelligence

Operating online under the handle crossingkey_.

**intelligence is the standard.**
