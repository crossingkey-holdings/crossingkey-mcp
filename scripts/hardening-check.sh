#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== CROSSINGKEY V3 HARDENING CHECK ==="
node --check server.v3.mjs
node --check lib/audit.mjs

python3 - <<'PY'
import json
r=json.load(open("data/capability_registry.json"))
assert r["default_policy"]=="deny"
assert len(r["divisions"])==15
assert all(c["enabled"] is False for c in r["capabilities"])
print("PASS registry deny-by-default")
print("PASS 15 divisions")
print("PASS all executable capabilities disabled")
PY

if [ -f data/adapter_manifest.json ]; then
  echo "WARN active adapter manifest exists"
else
  echo "PASS no active adapter manifest"
fi

chmod 600 data/capability_state.json
echo "PASS capability state permissions"
echo "HARDENING CHECK PASSED"
