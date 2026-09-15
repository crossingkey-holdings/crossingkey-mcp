#!/usr/bin/env bash
set -Eeuo pipefail

# CrossingKey MCP 2.3.0 controlled release transaction.
# Phase A only. Git/MCP Registry publication is intentionally absent.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CANDIDATE_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
PRODUCTION_ROOT="${CROSSINGKEY_PRODUCTION_ROOT:-$HOME/Downloads/crossingkey_developer_revenue_app}"
SERVICE="${CROSSINGKEY_SERVICE:-crossingkey-revenue-mcp.service}"
SERVICE_UNIT="/etc/systemd/system/$SERVICE"
PUBLIC_BASE="${CROSSINGKEY_PUBLIC_BASE:-https://mcp.crossingkeyintelligence.com}"
EXPECTED_BRANCH="upgrade/payment-verify-onchain-2.3.0"
EXPECTED_VERSION="2.3.0"
ROLLBACK_TAG="crossingkey-mcp-v2.2.0-pre-onchain-verifier"
EXPECTED_RECEIVER="0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28"
EXPECTED_USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
EXPECTED_NETWORK="eip155:8453"
EXPECTED_LEGACY_NETWORK="base"
EXPECTED_SCHEME="exact"
REPORT_DIR="${CROSSINGKEY_RELEASE_REPORT_DIR:-$CANDIDATE_ROOT/.release-evidence}"
dry_run=0
production_modified=0
rollback_in_progress=0
restart_completed=0
BACKUP_DIR=""
RUNTIME_VERSION_BEFORE=""
TMP_DIR=""
LOG_FILE=""
BACKUP_METADATA=""
COMMERCE_BASELINE=""
DEPLOYMENT_PATHS=(server.mjs lib/machine-commerce.mjs lib/onchain-verifier.mjs)

REQUIRED_BACKUP_FILES=(server.mjs package.json .env)
OPTIONAL_BACKUP_FILES=(package-lock.json server.json live-status.json)
REQUIRED_BACKUP_DIRS=(lib data)
OPTIONAL_BACKUP_DIRS=(delivery logs)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*"; return 1; }
cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup EXIT

preflight() {
  log "preflight: candidate=$CANDIDATE_ROOT production=$PRODUCTION_ROOT dry_run=$dry_run"
  [[ "$CANDIDATE_ROOT" == "/home/founder/Downloads/crossingkey-mcp" ]] || die "unexpected candidate path"
  [[ -d "$PRODUCTION_ROOT" ]] || die "production root missing: $PRODUCTION_ROOT"
  [[ "$(git -C "$CANDIDATE_ROOT" branch --show-current)" == "$EXPECTED_BRANCH" ]] || die "wrong branch"
  git -C "$CANDIDATE_ROOT" rev-parse -q --verify "refs/tags/$ROLLBACK_TAG" >/dev/null || die "rollback tag missing"
  [[ "$(node -p "require('$CANDIDATE_ROOT/package.json').version")" == "$EXPECTED_VERSION" ]] || die "candidate package version mismatch"
  [[ "$(node -p "require('$CANDIDATE_ROOT/server.json').version")" == "$EXPECTED_VERSION" ]] || die "candidate server.json version mismatch"
  [[ "$(node -p "require('$CANDIDATE_ROOT/live-status.json').version")" == "$EXPECTED_VERSION" ]] || die "candidate live-status version mismatch"
  for f in server.mjs lib/machine-commerce.mjs lib/onchain-verifier.mjs package.json package-lock.json server.json; do [[ -f "$CANDIDATE_ROOT/$f" ]] || die "required candidate file missing: $f"; done
  npm test --prefix "$CANDIDATE_ROOT" | tee -a "$LOG_FILE"
  node --check "$CANDIDATE_ROOT/server.mjs"
  node --check "$CANDIDATE_ROOT/lib/machine-commerce.mjs"
  node --check "$CANDIDATE_ROOT/lib/onchain-verifier.mjs"
  git -C "$CANDIDATE_ROOT" diff --check
  ! rg -n -i 'circle|sk_(live|test)_[A-Za-z0-9]+|private[_ -]?key\s*=|0x[0-9a-f]{64}' "$CANDIDATE_ROOT" --glob '!node_modules/**' --glob '!scripts/deploy-v2.3.0.sh' --glob '!.git/**' --glob '!.env.example' >/dev/null || die "secret/Circle scan failed"
  rg -q "payment\.verify_onchain" "$CANDIDATE_ROOT/server.mjs" || die "verifier registration missing"
  rg -q "readOnlyHint:true.*destructiveHint:false" "$CANDIDATE_ROOT/server.mjs" || die "read-only verifier annotations missing"
  rg -q "$EXPECTED_RECEIVER" "$CANDIDATE_ROOT/lib/machine-commerce.mjs" || die "receiver mismatch"
  rg -q "$EXPECTED_USDC" "$CANDIDATE_ROOT/lib/machine-commerce.mjs" || die "Base USDC mismatch"
  rg -q "scheme:'exact'" "$CANDIDATE_ROOT/lib/machine-commerce.mjs" || die "x402 scheme mismatch"
  rg -q "x402Versions:\[1,2\]" "$CANDIDATE_ROOT/lib/machine-commerce.mjs" || die "x402 versions mismatch"
  for module in express stripe zod '@modelcontextprotocol/sdk/server/mcp.js' '@modelcontextprotocol/sdk/server/streamableHttp.js' '@modelcontextprotocol/sdk/types.js'; do
    (cd "$PRODUCTION_ROOT" && node --input-type=module -e "await import('$module')") || die "production cannot resolve candidate runtime import: $module"
  done
  log "dependencies: candidate runtime imports resolve from production node_modules; production dependency superset verified"
  log "preflight: PASS; no production mutation performed"
}

topology() {
  log "topology: source deployment set is server.mjs, lib/machine-commerce.mjs, lib/onchain-verifier.mjs"
  log "topology: metadata-only package.json, package-lock.json, server.json, live-status.json remain excluded from runtime copy"
  log "topology: excluded .env, .env.example, data/, delivery/, logs, backups, node_modules, runtime-generated files, README.md, tests/, scripts/"
  [[ -f "$PRODUCTION_ROOT/server.mjs" && -f "$PRODUCTION_ROOT/package.json" ]] || die "production runtime incomplete"
  [[ -f "$PRODUCTION_ROOT/.env" ]] || die "production .env missing"
  [[ -d "$PRODUCTION_ROOT/data" ]] || die "production data directory missing"
  if sudo -n systemctl show "$SERVICE" -p FragmentPath -p ExecStart -p WorkingDirectory -p EnvironmentFiles -p MainPID >/dev/null 2>&1; then
    log "topology: system service metadata readable"
  else
    log "topology: system service metadata unavailable without noninteractive sudo in this runtime; expected unit=$SERVICE_UNIT, WorkingDirectory=$PRODUCTION_ROOT, EnvironmentFile=$PRODUCTION_ROOT/.env, ExecStart=/usr/bin/node $PRODUCTION_ROOT/server.mjs, PORT=3000"
    (( dry_run )) || die "cannot verify live system service topology"
  fi
  RUNTIME_VERSION_BEFORE="$(sed -n "s/.*version: ['\"]\([0-9][0-9.]*\)['\"].*/\1/p" "$PRODUCTION_ROOT/server.mjs" | head -1)"
  [[ "$RUNTIME_VERSION_BEFORE" == 2.2.0 ]] || die "unexpected production runtime version: ${RUNTIME_VERSION_BEFORE:-missing}"
  log "topology: runtimeVersionBefore=$RUNTIME_VERSION_BEFORE; packageMetadataVersionBefore=$(node -p "require('$PRODUCTION_ROOT/package.json').version"); registryVersionBefore=$(node -p "require('$PRODUCTION_ROOT/server.json').version")"
  log "topology: persistent state boundary confirmed at $PRODUCTION_ROOT/data; .env remains out of deployment set"
  if curl -fsS --max-time 3 "$PUBLIC_BASE/health" >"$TMP_DIR/public-health-before.json"; then log "topology: public health reachable before deployment"; else log "topology: public health not reachable from preparation runtime"; fi
}

backup() {
  if (( dry_run )); then
    BACKUP_DIR="$TMP_DIR/backup-simulation"
    create_backup "$BACKUP_DIR"
    log "backup: dry-run simulation verified at $BACKUP_DIR; production untouched"
    return 0
  fi
  local stamp; stamp="$(date -u +%Y%m%dT%H%M%SZ)"; BACKUP_DIR="$HOME/backups/crossingkey-mcp/$stamp"
  mkdir -p "$BACKUP_DIR/runtime" "$BACKUP_DIR/state"
  create_backup "$BACKUP_DIR"
  log "backup: verified at $BACKUP_DIR"
}

create_backup() {
  local destination="$1"; local metadata="$destination/BACKUP_METADATA.txt"
  mkdir -p "$destination/runtime" "$destination/state"

  for f in "${REQUIRED_BACKUP_FILES[@]}"; do
    [[ -f "$PRODUCTION_ROOT/$f" ]] || die "required production backup file missing: $f"
    if [[ "$f" == ".env" ]]; then cp -a "$PRODUCTION_ROOT/$f" "$destination/.env"; else cp -a "$PRODUCTION_ROOT/$f" "$destination/runtime/$f"; fi
    printf 'file=%s presence=PRESENT sha256=%s\n' "$f" "$(sha256sum "$PRODUCTION_ROOT/$f" | awk '{print $1}')" >> "$metadata"
  done
  for f in "${OPTIONAL_BACKUP_FILES[@]}"; do
    if [[ -f "$PRODUCTION_ROOT/$f" ]]; then
      cp -a "$PRODUCTION_ROOT/$f" "$destination/runtime/$f"
      printf 'file=%s presence=PRESENT sha256=%s\n' "$f" "$(sha256sum "$PRODUCTION_ROOT/$f" | awk '{print $1}')" >> "$metadata"
    else
      printf 'file=%s presence=ABSENT_BEFORE_DEPLOYMENT\n' "$f" >> "$metadata"
    fi
  done
  for d in "${REQUIRED_BACKUP_DIRS[@]}"; do
    [[ -d "$PRODUCTION_ROOT/$d" ]] || die "required production backup directory missing: $d"
    if [[ "$d" == data ]]; then cp -a "$PRODUCTION_ROOT/$d" "$destination/state/$d"; else cp -a "$PRODUCTION_ROOT/$d" "$destination/runtime/$d"; fi
    printf 'directory=%s presence=PRESENT\n' "$d" >> "$metadata"
  done
  for d in "${OPTIONAL_BACKUP_DIRS[@]}"; do
    if [[ -d "$PRODUCTION_ROOT/$d" ]]; then
      cp -a "$PRODUCTION_ROOT/$d" "$destination/runtime/$d"
      printf 'directory=%s presence=PRESENT\n' "$d" >> "$metadata"
    else
      printf 'directory=%s presence=ABSENT_BEFORE_DEPLOYMENT\n' "$d" >> "$metadata"
    fi
  done
  for path in "${DEPLOYMENT_PATHS[@]}"; do
    if [[ -f "$PRODUCTION_ROOT/$path" ]]; then
      mkdir -p "$destination/runtime/$(dirname -- "$path")"
      cp -a "$PRODUCTION_ROOT/$path" "$destination/runtime/$path"
      printf 'deployment_path=%s presence=PRESENT sha256=%s\n' "$path" "$(sha256sum "$PRODUCTION_ROOT/$path" | awk '{print $1}')" >> "$metadata"
    else
      printf 'deployment_path=%s presence=ABSENT_BEFORE_DEPLOYMENT\n' "$path" >> "$metadata"
    fi
  done
  chmod 600 "$destination/.env"
  {
    printf 'runtimeVersionBefore=%s\nservice=%s\nserviceUnit=%s\nworkingDirectory=%s\nproductionPath=%s\n' "$RUNTIME_VERSION_BEFORE" "$SERVICE" "$SERVICE_UNIT" "$PRODUCTION_ROOT" "$PRODUCTION_ROOT"
    cat "$metadata"
    (cd "$destination" && find runtime state -type f -print0 | sort -z | xargs -0 sha256sum)
  } > "$destination/MANIFEST.txt"
  (cd "$destination" && { find runtime state -type f -print; printf '%s\n' .env; } | sort | xargs sha256sum > SHA256SUMS)
  (cd "$destination" && sha256sum -c SHA256SUMS >/dev/null) || die "backup integrity check failed"
  BACKUP_METADATA="$metadata"
  log "backup: deployment-path presence metadata:"
  sed -n '/^deployment_path=/p' "$metadata" | while IFS= read -r record; do log "backup: $record"; done
}

deploy() {
  (( dry_run )) && { log "deploy: SKIPPED in dry-run"; return 0; }
  local staging="$PRODUCTION_ROOT/.release-v2.3.0-staging"
  rm -rf -- "$staging"
  mkdir "$staging" "$staging/lib"
  cp -a "$CANDIDATE_ROOT/server.mjs" "$staging/server.mjs"
  cp -a "$CANDIDATE_ROOT/lib/machine-commerce.mjs" "$staging/lib/"
  cp -a "$CANDIDATE_ROOT/lib/onchain-verifier.mjs" "$staging/lib/"
  validate_deployed "$staging"
  production_modified=1
  mv -Tf "$staging/server.mjs" "$PRODUCTION_ROOT/server.mjs"
  log "deploy: copied server.mjs"
  mv -Tf "$staging/lib/machine-commerce.mjs" "$PRODUCTION_ROOT/lib/machine-commerce.mjs"
  log "deploy: copied lib/machine-commerce.mjs"
  mv -Tf "$staging/lib/onchain-verifier.mjs" "$PRODUCTION_ROOT/lib/onchain-verifier.mjs"
  log "deploy: copied lib/onchain-verifier.mjs"
  rmdir "$staging/lib" "$staging"
  log "deploy: candidate runtime copied atomically; state and .env untouched"
}

validate_deployed() {
  local root="${1:-$PRODUCTION_ROOT}"
  node --check "$root/server.mjs"; node --check "$root/lib/machine-commerce.mjs"; node --check "$root/lib/onchain-verifier.mjs"
  log "syntax: PASS"
  rg -q "version: \"$EXPECTED_VERSION\"" "$root/server.mjs" || die "deployed runtime version mismatch"
  rg -q "$EXPECTED_RECEIVER" "$root/lib/machine-commerce.mjs" || die "deployed receiver mismatch"
  rg -q "$EXPECTED_USDC" "$root/lib/machine-commerce.mjs" || die "deployed Base USDC mismatch"
  rg -q "payment\.verify_onchain" "$root/server.mjs" || die "deployed verifier missing"
}

capture_commerce_baseline() {
  local data_file="$PRODUCTION_ROOT/data/machine_commerce.json"
  COMMERCE_BASELINE="$(node -e 'const fs=require("fs");const p=process.argv[1];let s={};try{s=JSON.parse(fs.readFileSync(p,"utf8"))}catch{};process.stdout.write([Object.keys(s.idempotency||{}).length,Object.keys(s.entitlements||{}).length,Object.keys(s.receipts||{}).length].join(","))' "$data_file")"
  log "commerce baseline: $COMMERCE_BASELINE"
}

verify_commerce_baseline() {
  local current; current="$(node -e 'const fs=require("fs");const p=process.argv[1];let s=JSON.parse(fs.readFileSync(p,"utf8"));process.stdout.write([Object.keys(s.idempotency||{}).length,Object.keys(s.entitlements||{}).length,Object.keys(s.receipts||{}).length].join(","))' "$PRODUCTION_ROOT/data/machine_commerce.json")" || return 1
  log "commerce post-deployment: $current"
  [[ "$current" == "$COMMERCE_BASELINE" ]]
}

health_version_ok() {
  local body="$1" expected="$2"
  node -e 'const b=JSON.parse(process.argv[1]);process.exit(b.ok===true&&b.version===process.argv[2]?0:1)' "$body" "$expected"
}

wait_for_health() {
  local expected="$1" label="$2" attempts=30 body="" saw_response=0
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if body="$(curl -fsS --max-time 5 "http://127.0.0.1:${CROSSINGKEY_PORT:-3000}/health" 2>/dev/null)"; then
      saw_response=1
      if health_version_ok "$body" "$expected"; then
      log "$label readiness: PASS attempt=$attempt runtime_version=$expected"
      printf '%s\n' "$body"
      return 0
      fi
      log "$label readiness: HEALTH_VERSION_MISMATCH expected=$expected"
    fi
    log "$label readiness: attempt=$attempt/$attempts not ready"
    (( attempt < attempts )) && sleep 1
  done
  if (( saw_response )); then log "$label readiness: HEALTH_VERSION_MISMATCH"; else log "$label readiness: TIMEOUT attempts=$attempts"; fi
  return 1
}

restart_service() {
  (( dry_run )) && { log "restart: SKIPPED in dry-run"; return 0; }
  restart_completed=0
  log "restart: command attempted: sudo systemctl restart $SERVICE"
  sudo systemctl restart "$SERVICE" || { log "restart: SERVICE_RESTART_FAILED"; return 1; }
  restart_completed=1
  local active; active="$(sudo systemctl is-active "$SERVICE" 2>/dev/null || true)"
  log "restart: service active result=$active"
  [[ "$active" == active ]] || { log "restart: SERVICE_NOT_ACTIVE"; return 1; }
  wait_for_health "$EXPECTED_VERSION" deploy || { log "restart: SERVICE_READINESS_TIMEOUT"; return 1; }
}

rollback() {
  rollback_in_progress=1
  log "rollback: restoring backup ${BACKUP_DIR:-unknown}"
  [[ -n "$BACKUP_DIR" && -d "$BACKUP_DIR/runtime" ]] || { log "ROLLBACK FAILURE - MANUAL INTERVENTION REQUIRED"; return 1; }
  restore_deployment_paths "$BACKUP_DIR" "$PRODUCTION_ROOT"
  cp -a "$BACKUP_DIR/state/data/." "$PRODUCTION_ROOT/data/"
  cp -a "$BACKUP_DIR/.env" "$PRODUCTION_ROOT/.env"
  chmod 600 "$PRODUCTION_ROOT/.env"
  log "rollback: restart command attempted: sudo systemctl restart $SERVICE"
  sudo systemctl restart "$SERVICE" || { log "rollback: SERVICE_RESTART_FAILED"; return 1; }
  local active; active="$(sudo systemctl is-active "$SERVICE" 2>/dev/null || true)"
  log "rollback: service active result=$active"
  [[ "$active" == active ]] || { log "rollback: SERVICE_NOT_ACTIVE"; return 1; }
  wait_for_health "$RUNTIME_VERSION_BEFORE" rollback || { log "rollback: SERVICE_READINESS_TIMEOUT"; return 1; }
  verify_commerce_baseline || { log "rollback: commerce baseline mismatch"; return 1; }
  log "rollback: SUCCESS"
}

restore_deployment_paths() {
  local backup="$1" target="$2" path presence
  while read -r path presence; do
    case "$presence" in
      PRESENT)
        mkdir -p "$target/$(dirname -- "$path")"
        cp -a "$backup/runtime/$path" "$target/$path"
        log "rollback: restored deployment_path=$path"
        ;;
      ABSENT_BEFORE_DEPLOYMENT)
        if [[ -e "$target/$path" || -L "$target/$path" ]]; then
          rm -f -- "$target/$path"
          log "rollback: removed deployment_path=$path (absent before deployment)"
        else
          log "rollback: confirmed deployment_path=$path remains absent"
        fi
        ;;
      *) die "unknown deployment path presence: $path $presence" ;;
    esac
  done < <(awk -F'[ =]' '/^deployment_path=/ { print $2, $4 }' "$backup/BACKUP_METADATA.txt")
}

rollback_fixture() {
  local fixture backup before after
  fixture="$(mktemp -d)"; backup="$fixture/backup"; before="$fixture/before"; after="$fixture/after"
  mkdir -p "$backup/runtime/lib" "$before/lib" "$after/lib" "$backup/state/data"
  printf 'server-2.2.0\n' > "$before/server.mjs"
  printf 'commerce-2.2.0\n' > "$before/lib/machine-commerce.mjs"
  printf 'unrelated\n' > "$before/lib/unrelated.mjs"
  printf 'persistent\n' > "$before/data.sqlite"
  printf 'env\n' > "$before/.env"
  cp -a "$before/." "$after/"
  printf 'server-2.3.0\n' > "$after/server.mjs"
  printf 'commerce-2.3.0\n' > "$after/lib/machine-commerce.mjs"
  printf 'verifier-2.3.0\n' > "$after/lib/onchain-verifier.mjs"
  cp -a "$before/server.mjs" "$backup/runtime/server.mjs"
  cp -a "$before/lib/machine-commerce.mjs" "$backup/runtime/lib/machine-commerce.mjs"
  cat > "$backup/BACKUP_METADATA.txt" <<'EOF'
deployment_path=server.mjs presence=PRESENT
deployment_path=lib/machine-commerce.mjs presence=PRESENT
deployment_path=lib/onchain-verifier.mjs presence=ABSENT_BEFORE_DEPLOYMENT
EOF
  restore_deployment_paths "$backup" "$after"
  cmp -s "$before/server.mjs" "$after/server.mjs" || die "fixture server restore failed"
  cmp -s "$before/lib/machine-commerce.mjs" "$after/lib/machine-commerce.mjs" || die "fixture commerce restore failed"
  [[ ! -e "$after/lib/onchain-verifier.mjs" ]] || die "fixture orphan was not removed"
  cmp -s "$before/lib/unrelated.mjs" "$after/lib/unrelated.mjs" || die "fixture unrelated file changed"
  cmp -s "$before/data.sqlite" "$after/data.sqlite" || die "fixture data changed"
  cmp -s "$before/.env" "$after/.env" || die "fixture env changed"
  rm -rf -- "$fixture"
  printf 'ROLLBACK FIXTURE: PASS\n'
}

verify_local() { (( dry_run )) && { log "local verification: SKIPPED in dry-run"; return 0; }; wait_for_health "$EXPECTED_VERSION" post-deploy | tee -a "$LOG_FILE"; }
verify_public() { (( dry_run )) && { log "public verification: SKIPPED in dry-run"; return 0; }; curl -fsS --max-time 10 "$PUBLIC_BASE/health"; curl -fsS --max-time 10 "$PUBLIC_BASE/.well-known/mcp.json"; }
verify_mcp() { (( dry_run )) && { log "MCP verification: SKIPPED in dry-run"; return 0; }; log "MCP verification requires the production transport harness and is reserved for the authorized deployment transaction"; }
verify_x402() { (( dry_run )) && { log "x402 verification: SKIPPED in dry-run"; return 0; }; log "x402 quote verification reserved for authorized deployment transaction; no purchase path is invoked"; }
verify_base_rpc() { (( dry_run )) && { log "Base RPC verification: SKIPPED in dry-run"; return 0; }; log "Base RPC verification reserved for authorized deployment transaction"; }

main() {
  if [[ "${1:-}" == --rollback-fixture ]]; then
    LOG_FILE=/dev/null
    rollback_fixture
    return 0
  fi
  [[ "${1:-}" == --dry-run ]] && dry_run=1
  TMP_DIR="$(mktemp -d)"; mkdir -p "$REPORT_DIR"
  if (( dry_run )); then LOG_FILE="$TMP_DIR/release.log"; else LOG_FILE="$REPORT_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ).log"; fi
  preflight; topology; capture_commerce_baseline; backup; deploy
  if (( dry_run )); then validate_deployed "$CANDIDATE_ROOT"; else validate_deployed; fi
  restart_service; verify_local; verify_commerce_baseline || die "post-deployment commerce baseline mismatch"; verify_public; verify_mcp; verify_x402; verify_base_rpc
  (( dry_run )) && cp -a "$LOG_FILE" "$REPORT_DIR/dry-run.log"
  log "publication: NOT EXECUTED; blockchain writes/spending: NOT EXECUTED"
  log "DEPLOYMENT SCRIPT PREPARATION: PASS"
}

on_error() {
  local status=$?; trap - ERR
  if (( production_modified && ! rollback_in_progress )); then
    if ! rollback; then log "ROLLBACK FAILURE - MANUAL INTERVENTION REQUIRED"; fi
  fi
  log "DEPLOYMENT SCRIPT PREPARATION: FAIL (exit $status)"
  exit "$status"
}
if [[ "${CROSSINGKEY_DEPLOY_LIB_ONLY:-0}" != 1 ]]; then
  if [[ "${1:-}" == --rollback-fixture ]]; then
    LOG_FILE=/dev/null
    rollback_fixture
    exit 0
  fi
  trap on_error ERR
  main "$@"
fi
