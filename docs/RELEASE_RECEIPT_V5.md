# Release receipt — CrossingKey buyer adapter v5.0.0

- Release unit: `@crossingkey/x402-buyer`
- Repository: `crossingkey-holdings/crossingkey-mcp`
- Server release candidate: receiver-only MCP `5.0.0`
- Buyer adapter release: `5.0.0`
- Release date: 2026-10-26
- Funds spent: `0`
- Production services changed: `0`
- Private keys handled: `0`

## Verification

- JavaScript tests: `8 passed, 0 failed`
- Python tests: `3 passed, 0 failed`
- Node syntax checks: passed
- Python compilation checks: passed
- secret scan: passed
- live unpaid `hash.encode` challenge: passed
- live challenge network: `eip155:8453`
- live challenge asset: Base canonical USDC
- live challenge receiver: `0x15a879AEAb30A23f951dbF9d6e706f2Df893ed7B`
- live challenge amount used for probe: `10000` atomic units
- live settlement: not attempted

## Boundaries

This receipt proves the client transport's mocked control flow and its ability
to parse the public unpaid challenge. It does not prove a wallet vendor's
EIP-3009 implementation, live USDC settlement, universal host compatibility,
or a production host cutover until the host verification section is completed.
