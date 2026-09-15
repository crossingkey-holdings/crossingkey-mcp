#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export CROSSINGKEY_DEPLOY_LIB_ONLY=1
source "$ROOT/scripts/deploy-v2.3.0.sh"
LOG_FILE="$(mktemp)"
fixture_root=""
trap 'rm -f "$LOG_FILE"; [[ -z "$fixture_root" ]] || rm -rf "$fixture_root"' EXIT

attempt=0
curl() { attempt=$((attempt + 1)); if (( attempt < 3 )); then return 7; fi; printf '{"ok":true,"version":"%s"}\n' "$mock_version"; }
sleep() { :; }
mock_version=2.3.0
wait_for_health 2.3.0 delayed >/dev/null
(( attempt == 2 ))

curl() { return 7; }
if wait_for_health 2.3.0 timeout >/dev/null 2>&1; then exit 1; fi
curl() { printf '{"ok":true,"version":"2.2.0"}\n'; }
if wait_for_health 2.3.0 wrong-version >/dev/null 2>&1; then exit 1; fi

sudo() { [[ "$2" == is-active ]] && { printf 'inactive\n'; return 0; }; return 0; }
if restart_service >/dev/null 2>&1; then exit 1; fi

fixture_root="$(mktemp -d)"
PRODUCTION_ROOT="$fixture_root"
mkdir -p "$fixture_root/data"
printf '{"idempotency":{"a":1},"entitlements":{"b":1},"receipts":{"c":1}}\n' > "$fixture_root/data/machine_commerce.json"
capture_commerce_baseline
verify_commerce_baseline
printf '{"idempotency":{"a":1},"entitlements":{"b":1},"receipts":{}}\n' > "$fixture_root/data/machine_commerce.json"
if verify_commerce_baseline; then exit 1; fi

fixture="$fixture_root/topology"
backup="$fixture/backup"
before="$fixture/before"
after="$fixture/after"
mkdir -p "$backup/runtime/lib" "$before/lib" "$after/lib"
printf '2.2.0\n' > "$before/server.mjs"
printf 'commerce\n' > "$before/lib/machine-commerce.mjs"
printf 'unrelated\n' > "$before/lib/unrelated.mjs"
cp -a "$before/." "$after/"
printf '2.3.0\n' > "$after/server.mjs"
printf 'commerce-new\n' > "$after/lib/machine-commerce.mjs"
printf 'verifier\n' > "$after/lib/onchain-verifier.mjs"
cp -a "$before/server.mjs" "$backup/runtime/server.mjs"
cp -a "$before/lib/machine-commerce.mjs" "$backup/runtime/lib/machine-commerce.mjs"
printf '%s\n' 'deployment_path=server.mjs presence=PRESENT' 'deployment_path=lib/machine-commerce.mjs presence=PRESENT' 'deployment_path=lib/onchain-verifier.mjs presence=ABSENT_BEFORE_DEPLOYMENT' > "$backup/BACKUP_METADATA.txt"
restore_deployment_paths "$backup" "$after"
cmp -s "$before/server.mjs" "$after/server.mjs"
cmp -s "$before/lib/machine-commerce.mjs" "$after/lib/machine-commerce.mjs"
cmp -s "$before/lib/unrelated.mjs" "$after/lib/unrelated.mjs"
[[ ! -e "$after/lib/onchain-verifier.mjs" ]]

! grep -Eq '\$[A-Z_]+=' "$ROOT/scripts/deploy-v2.3.0.sh"
restart_block="$(sed -n '/restart_service()/,/^}/p' "$ROOT/scripts/deploy-v2.3.0.sh")"
! grep -q 'curl' <<<"$restart_block"
printf 'DEPLOYMENT CONTROL FIXTURES: PASS\n'
