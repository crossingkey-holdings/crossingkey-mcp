# v4.0.0-rc.1 commercial catalog

| Capability | Price | Rail | Execution boundary |
|---|---:|---|---|
| `mcp.launch_audit` | $9.00 USDC | x402 exact | Bounded public MCP health, manifest, x402, transport, and schema audit |
| `x402.purchase_path_audit` | $19.00 USDC | x402 exact | Bounded no-payment x402 challenge, amount, destination, and receiver-only audit |

Both capabilities are discovery-visible with exact input/output contracts and
Bazaar metadata. The catalog also preserves the prior 10 x402 capabilities and
the prepaid `xkey.validate` capability. Prices are implementation metadata only;
no live payment product or checkout has been created by this RC work.
