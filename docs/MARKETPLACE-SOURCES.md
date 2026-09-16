# Sources and verification scope

Accessed 2026-09-16. Primary implementation evidence is the local repository, installed SDK code, test results and hash-verified catalog; external documents guide contracts rather than prove this deployment.

- MCP tools specification: https://modelcontextprotocol.io/specification/2025-11-25/server/tools — tool identity, JSON Schema, content/structuredContent and taskSupport semantics. The installed SDK defaults registered tools to taskSupport=forbidden; real tools/list asserts that behavior.
- x402 HTTP 402 reference: https://docs.x402.org/core-concepts/http-402 — challenge/payment response framing. Existing v1/v2 implementation and regression tests determine backward compatibility.
- Node HTTPS documentation: https://nodejs.org/api/https.html — HTTPS request transport and options. Actual runtime Node 22.23.2 behavior was exercised by mocked transports and the real CrossingKey public free MCP call; this is not a claim of testing Node 26.
- Existing source modules: lib/machine-commerce.mjs, lib/discovery.mjs, lib/onchain-verifier.mjs and server.mjs at original HEAD 8513a0dc3d21e60c30b19083478f40970fcbeed6.
- First-party product source: authorized read-only CrossingKey-Productization/catalog/products.json and eight releases with SHA-256 sidecars. Hash receipt: marketplace-catalog-validation.json. No archive extraction or alteration.
- Operator-host service: systemctl show identity/state properties and GET http://127.0.0.1:3000/health only. Public MCP adapter check: payment.methods only. Neither proves a marketplace production deployment or real paid fulfillment.
