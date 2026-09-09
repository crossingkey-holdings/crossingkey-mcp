# Security

## Repository boundary

Production credentials, payment secrets, customer identifiers, credit databases, receipt databases, fulfillment archives, runtime state, private keys, and sensitive logs must never be committed.

Production secrets must be supplied through the deployment environment.

## Execution boundary

Public MCP discovery does not imply authorization for paid execution.

Paid capabilities are designed to remain explicitly enumerated, schema validated, bounded, deny-by-default, credential bound, metered, idempotent, receipt producing, and output sanitized.

Arbitrary shell execution and unrestricted filesystem access are outside the public CrossingKey MCP capability model.

## Security reporting

Report security issues privately to founder@crossingkeyintelligence.com.
