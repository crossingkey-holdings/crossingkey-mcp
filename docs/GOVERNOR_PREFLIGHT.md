# Marketplace engineering preflight

Mode: Build. Authority: INTERNAL_AUTONOMOUS, explicitly authorized local repository edits and commits by the attached 2026-09-16 authorization.
Outcome: provider catalog, buyer-authorized x402 purchase, delivery, receipts and post-sale provider accounting using the existing server.
Sources: existing repository; read-only CrossingKey-Productization catalog and releases. Classification: PRIVATE_CK; no publication authorized.
Available: repository reads/writes, local tests, Git, official documentation access. Production and financial actions are excluded.
Evidence: baseline and ONE-PASS-VERIFICATION.md. Acceptance: legacy regressions plus marketplace unit/integration/E2E tests.
Rollback: local commits and preserved original HEAD; preserve data separately before any future migration. No live data migration or restart is part of this run.
Controls must be labeled tested only when tests pass. Skills used: execution-governor, skill-orchestrator, custom-mcp-app-builder. Existing MCP is tool-only; no widget or Apps SDK scaffold is needed.
