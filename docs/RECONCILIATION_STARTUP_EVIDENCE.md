# v4 isolated startup evidence

Status: `TESTED` in the isolated v4 development worktree only.

## Safe startup probe

- Worktree: `/home/founder/Downloads/crossingkey-mcp-v4-development`
- Port: dynamically allocated loopback port `35517`
- `CK_ENABLE_MAINNET=false`
- Payment facilitator: loopback-only unreachable test URL; no request was made
- RPC/blockchain access: not invoked
- Mutable state: temporary directory only, removed after the probe
- Credentials: dummy local test values only
- Health: `{"ok":true,"service":"crossingkey-mcp","version":"3.0.1"}` (reconciliation probe; before RC version bump)
- Process exit status: `0`
- Listener before cleanup: none
- Listener after cleanup: none
- Process after cleanup: absent
- Captured process output: server started on the loopback MCP URL; only the Node experimental SQLite warning appeared on stderr.

## Initial safe-probe failure

The first corrected probe deliberately disabled mainnet and used a dynamic port, but omitted `CK_FUNNEL_DB`. The server failed before listening with `ERR_SQLITE_ERROR: unable to open database file`. No listener or process remained. The test was corrected to provide an isolated temporary `CK_FUNNEL_DB`; the rerun passed as recorded above.

## Boundaries

No production directory, service, wallet, payment facilitator, production API, blockchain RPC, secret, database, or operational state was modified or contacted.
