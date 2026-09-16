# Marketplace baseline — 2026-09-16

Source: `/home/founder/Downloads/crossingkey-mcp`; origin: crossingkey-holdings/crossingkey-mcp (GitHub).
Original branch: `upgrade/bazaar-discovery-2.4.0`.
Original HEAD: `8513a0dc3d21e60c30b19083478f40970fcbeed6`.
Package, runtime, MCP and server metadata version: 2.4.0.
MCP identity: `crossingkey-mcp`; registry identity: `com.crossingkeyintelligence/crossingkey-mcp`.
Existing registered tools: 26. Existing payment path: Express x402 HTTP, separate from MCP computation.

Baseline `npm test`: 60 passed, 0 failed after execution permissions were granted. Earlier restricted execution reported a failing HTTP discovery test; the unchanged test and complete suite passed with the new permissions. No code repair was necessary. The earlier claim that an unhandled execFile rejection was the root cause was incomplete; it only identified the failure location.

Existing work preserved: modified tests/http-discovery.test.mjs and untracked v2.4 deployment scripts, fixtures, shell tests, MCP contract test, release evidence and staging directory. These belong to prior work and are excluded from marketplace commits except narrowly necessary version expectations in the tracked HTTP test.

Configuration structure: existing Stripe, claim, Kennekarte, receiver, network, facilitator, delivery and XKEY environment variables; JSON state under data/. Secret values were not inspected or recorded. Runtime configuration is not evidence of live configuration. The receiver constant and legacy prices must remain unchanged.

Authorized: local implementation, tests, docs, dedicated branch and local commits. Excluded: remote push, deployment, public release, payouts, real charges, archive modification and unrelated creative IP.
