# v4.0.0-rc.1 verification results

## Passed

- `node --check server.mjs`
- `node --check server-runtime.mjs`
- `npm test`: pass (the package script discovers the legacy `tests/test-*.mjs` test)
- `node --test tests/*.mjs`: **103 passed, 0 failed**
- `node scripts/trybounty-safety-test.mjs`: pass
- runtime import-closure manifest: pass
- paid audit unit tests: pass
- payment lifecycle tests: pass, including replay, duplicate/idempotency,
  interrupted settlement, receipts, result retrieval, and no-transfer accounting
- security and transport tests: pass
- isolated startup probe: pass with dynamic loopback port, mainnet disabled,
  temporary database paths, dummy credentials, no listener/process after cleanup

The repository suite's Base RPC test is read-only and reported `writes=0`.

## Dependency audit

`npm audit --json` still reports 9 advisories: 5 moderate and 4 critical. No
force upgrade or unverified lockfile override was applied. See
`docs/SECURITY_DEPENDENCY_AUDIT.md`.
