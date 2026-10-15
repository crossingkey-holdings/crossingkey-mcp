# CrossingKey MCP v4 public paid endpoint marketplace listing

Generated: 2026-10-15T19:07:48.904Z

Release: `4.0.0-rc.1`

All URLs below come from v4 published discovery metadata and are implemented by the explicit POST `/api/x402/:capability` route. They accept JSON bodies shaped as `{ "input": <request schema> }`. An unpaid valid request returns HTTP 402 plus the x402 v2 `PAYMENT-REQUIRED` header. No endpoint listed here is MCP-only.

| Classification | Capability | Method | Marketplace URL | Price | Current public state |
| --- | --- | --- | --- | ---: | --- |
| LEGACY_ENDPOINT_PRESERVED | `x402.compatibility_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/x402.compatibility_audit | $1.00 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `mcp.schema_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/mcp.schema_audit | $1.00 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `openapi.quality_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/openapi.quality_audit | $1.00 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `machine_commerce.readiness_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/machine_commerce.readiness_audit | $2.00 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `artifact.integrity_manifest` | POST | https://mcp.crossingkeyintelligence.com/api/x402/artifact.integrity_manifest | $0.10 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `hash.encode` | POST | https://mcp.crossingkeyintelligence.com/api/x402/hash.encode | $0.01 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `secret.scan` | POST | https://mcp.crossingkeyintelligence.com/api/x402/secret.scan | $0.01 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `pii.scan` | POST | https://mcp.crossingkeyintelligence.com/api/x402/pii.scan | $0.01 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `json.repair` | POST | https://mcp.crossingkeyintelligence.com/api/x402/json.repair | $0.01 USDC | VERIFIED_CURRENT_V3_0_1 |
| LEGACY_ENDPOINT_PRESERVED | `prompt.audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/prompt.audit | $0.01 USDC | VERIFIED_CURRENT_V3_0_1 |
| NEW_PUBLIC_ENDPOINT | `mcp.launch_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/mcp.launch_audit | $9.00 USDC | NOT_YET_PUBLIC_V4 |
| NEW_PUBLIC_ENDPOINT | `x402.purchase_path_audit` | POST | https://mcp.crossingkeyintelligence.com/api/x402/x402.purchase_path_audit | $19.00 USDC | NOT_YET_PUBLIC_V4 |
| NEW_PUBLIC_ENDPOINT | `xkey.validate` | POST | https://mcp.crossingkeyintelligence.com/api/x402/xkey.validate | $0.10 USDC | NOT_YET_PUBLIC_V4 |

Shared payment contract: x402 v2; Base mainnet `eip155:8453`; Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; receiver `0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B`.

The current public hostname still serves v3.0.1. Therefore new v4 endpoints may be locally verified at staging but are not independently public-v4 verified until an approved cutover and readback. A valid unpaid 402 is a challenge, not a payment failure or buyer abandonment.

Continuity decision: **PASS**.

`LIVE_PAYMENT_AND_SETTLEMENT_UNVERIFIED`
