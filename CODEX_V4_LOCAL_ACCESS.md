# CrossingKey MCP v4 local handoff

Writable worktree: `/home/founder/Downloads/crossingkey-mcp-v4-development`.
Git source used: `/home/founder/src/crossingkey-mcp`, HEAD `83648229b3970780a2437b11208f708a2ab1d084`.
Live production directory (READ ONLY): `/home/founder/Downloads/crossingkey_developer_revenue_app`.
Live service: `crossingkey-revenue-mcp.service` (DO NOT restart or modify).
Other known Git MCP copies: `/home/founder/src/crossingkey-mcp`, `/home/founder/Downloads/crossingkey-mcp-v3.0.1-sync`, `/home/founder/Downloads/crossingkey-mcp` (READ ONLY).
Public endpoint: https://mcp.crossingkeyintelligence.com/mcp (discovery/health only).

Your first step is to compare production's `server.mjs` and project tree with the selected Git source, inspect alternate MCP worktrees, and identify any functionality in production that has not been reconciled into source. Do not import secrets, production SQLite data, user-owned creative IP, or environment files into this development worktree. No edits outside this worktree, no service restart, deployment, wallet operation, Cloudflare change, push, payment, or secret access without explicit approval. Local tests only. Never execute production scripts as tests. Follow the full v4 master directive supplied in Codex chat. If source does not represent running functionality, report a reconciliation blocker, do not rewrite from guesswork.
