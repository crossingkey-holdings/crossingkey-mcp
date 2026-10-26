# CrossingKey MCP v5

CrossingKey MCP is a governed Streamable HTTP MCP for agent discovery, bounded capabilities, buyer-authorized machine commerce, x402 payments on Base, and verifiable results.

## Public endpoint

- MCP transport: https://mcp.crossingkeyintelligence.com/mcp
- Human documentation: https://www.crossingkeyintelligence.com/mcp/
- Canonical identity: `com.crossingkeyintelligence/crossingkey-mcp`
- Candidate server release: `5.0.0`
- Current public runtime before cutover: `4.0.0`
- Protocol: MCP Streamable HTTP
- Network: Base mainnet, `eip155:8453`
- Asset: USDC
- Wallet policy: receiver-only

## Discovery sequence

```text
provider.describe
→ offers.list
→ requirements.check
→ cost.estimate
→ result.preview
→ execution.preflight
→ HUMAN AUTHORIZATION
→ payment
→ execute
→ receipt
```

Discovery is free and does not itself authorize paid execution. Payment, authorization, execution, entitlement, and receipt generation are separate stages.

## Payment rails

The public v5 candidate preserves:

- Stripe payment links
- x402 v1 compatibility
- x402 v2 as the preferred machine-payment profile
- Base mainnet USDC
- receiver-only settlement policy

No discovery document should be interpreted as proof that a live payment or settlement has occurred.

## Capability groups

Free discovery includes provider description, offers, requirements, cost estimates, result previews, execution preflight, and legacy credit compatibility status.

Paid capabilities include:

- `x402.compatibility_audit`
- `mcp.schema_audit`
- `openapi.quality_audit`
- `machine_commerce.readiness_audit`
- `artifact.integrity_manifest`
- `hash.encode`
- `secret.scan`
- `pii.scan`
- `json.repair`
- `prompt.audit`
- `mcp.launch_audit`
- `x402.purchase_path_audit`
- `xkey.validate`

## Safety boundary

CrossingKey keeps meaningful human authority in the loop. Paid operations require explicit authorization, bounded inputs, idempotency, replay protection, payment verification, result binding, and a verifiable receipt. The MCP does not grant unrestricted seller-wallet signing or autonomous seller spending.

## Source

- Repository: https://github.com/crossingkey-holdings/crossingkey-mcp
- Live discovery: https://mcp.crossingkeyintelligence.com/.well-known/mcp.json
- Health: https://mcp.crossingkeyintelligence.com/health
- x402 discovery: https://mcp.crossingkeyintelligence.com/.well-known/x402

Stable release tagging remains a separate promotion step from runtime verification.
