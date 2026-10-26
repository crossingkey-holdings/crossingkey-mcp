#!/usr/bin/env bash
set -Eeuo pipefail

# Promote the already-tested CrossingKey MCP V4 source to stable 4.0.0.
# This script never changes DNS, wallet settings, Stripe destinations, or data.
# It restarts only the staged V4 service after local tests pass.

SERVICE="${CK_MCP_SERVICE:-crossingkey-mcp-v4-staged.service}"
REPO_DIR="${CK_MCP_REPO_DIR:-}"
PUBLIC="${CK_MCP_PUBLIC_URL:-https://mcp.crossingkeyintelligence.com}"
EXPECTED_VERSION="4.0.0"

die(){ echo "ERROR: $*" >&2; exit 1; }
command -v systemctl >/dev/null || die "systemctl is required"
command -v curl >/dev/null || die "curl is required"
command -v git >/dev/null || die "git is required"
command -v node >/dev/null || die "node is required"

if [[ -z "$REPO_DIR" ]]; then
  REPO_DIR="$(systemctl --user show "$SERVICE" -p WorkingDirectory --value || true)"
fi
[[ -n "$REPO_DIR" && -d "$REPO_DIR/.git" ]] || die "Set CK_MCP_REPO_DIR to the checked-out V4 repository."
cd "$REPO_DIR"

git fetch origin main
git checkout main
git pull --ff-only origin main

[[ -z "$(git status --porcelain)" ]] || die "Repository has local changes; refusing to overwrite them."

node --check server.mjs
node --check server-runtime.mjs
npm ci --ignore-scripts --no-audit --no-fund
npm test
node --test tests/*.mjs

grep -q "MCP_RELEASE_VERSION = '$EXPECTED_VERSION'" lib/mcp-manifest.mjs || die "Source is not version $EXPECTED_VERSION."

echo "Restarting only $SERVICE..."
systemctl --user daemon-reload
systemctl --user restart "$SERVICE"
sleep 3

LOCAL="http://127.0.0.1:3401"
for base in "$LOCAL" "$PUBLIC"; do
  health="$(curl -fsS --max-time 15 "$base/health")" || die "Health failed: $base"
  grep -q '"version":"4.0.0"' <<<"$health" || die "Unexpected version at $base: $health"
  echo "$base health: $health"
done

DISCOVERY="$(curl -fsS --max-time 15 "$PUBLIC/.well-known/mcp.json")"
grep -q '"version":"4.0.0"' <<<"$DISCOVERY" || die "Public discovery is not 4.0.0."
grep -q 'mcp-v4-2026-10-26-marketplace' <<<"$DISCOVERY" || die "Public discovery profile is stale."

DOCS="$(curl -fsS --max-time 15 "$PUBLIC/mcp")"
grep -q 'CrossingKey MCP v4' <<<"$DOCS" || die "Public MCP documentation response is not live."

echo "Recording stable public verification in source metadata..."
node <<'NODE'
const fs = require('node:fs');
const readmePath = 'README.md';
const readme = fs.readFileSync(readmePath, 'utf8').replaceAll('4.0.0-rc.1', '4.0.0');
fs.writeFileSync(readmePath, readme);
const statusPath = 'live-status.json';
const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
status.version = '4.0.0';
status.operatorHostVersionObserved = '4.0.0';
status.statusSemantics = 'stable_public_runtime_verified';
status.localVerification = 'automated_v4_suite_passed; public health/discovery verified';
status.verifiedAt = new Date().toISOString().slice(0, 10);
fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + '\n');
NODE

git add README.md live-status.json
if ! git diff --cached --quiet; then
  git commit -m "Record stable V4 public promotion"
  git push origin main
fi

echo "Creating GitHub release/tag v4.0.0..."
if command -v gh >/dev/null 2>&1; then
  if gh release view "v$EXPECTED_VERSION" >/dev/null 2>&1; then
    echo "GitHub release v$EXPECTED_VERSION already exists."
  else
    gh release create "v$EXPECTED_VERSION" --target main --title "CrossingKey MCP v$EXPECTED_VERSION" --notes-file docs/MCP.md
  fi
else
  die "GitHub CLI is required for the release/tag step."
fi

echo
echo "SUCCESS: CrossingKey MCP v$EXPECTED_VERSION is running and publicly verified."
echo "No DNS, wallet, Stripe destination, payment, or data mutation was performed."
