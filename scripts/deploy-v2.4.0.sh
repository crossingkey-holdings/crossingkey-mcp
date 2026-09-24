#!/usr/bin/env bash
set -Eeuo pipefail

# CrossingKey v2.4 release transaction.  This script is intentionally boring:
# every phase is visible and every mutation has a named rollback boundary.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
STAGING="${CROSSINGKEY_STAGING_ROOT:-$ROOT/.release-v2.4.0-staging-20260915T204721Z}"
PROD="${CROSSINGKEY_PRODUCTION_ROOT:-/home/founder/Downloads/crossingkey_developer_revenue_app}"
SERVICE="${CROSSINGKEY_SERVICE:-crossingkey-revenue-mcp.service}"
UNIT_PATH="${CROSSINGKEY_UNIT_PATH:-/etc/systemd/system/$SERVICE}"
CANONICAL_UNIT_PATH="/etc/systemd/system/crossingkey-revenue-mcp.service"
REPORT_DIR="${CROSSINGKEY_RELEASE_REPORT_DIR:-$ROOT/.release-evidence}"
BACKUP_ROOT="${CROSSINGKEY_BACKUP_ROOT:-/home/founder/backups/crossingkey-mcp/v2.4.0}"
HOST_EVIDENCE="${CROSSINGKEY_OPERATOR_HOST_EVIDENCE:-}"
EXPECTED_BRANCH="upgrade/bazaar-discovery-2.4.0"
EXPECTED_COMMIT="8513a0dc3d21e60c30b19083478f40970fcbeed6"
RECEIVER="0x6D1CCe697B145E6D8DB31B038F5D7fbc4Fe27B28"
USDC="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
runtime_files=(server.mjs lib/machine-commerce.mjs lib/discovery.mjs lib/onchain-verifier.mjs)
runtime_imports=("@modelcontextprotocol/sdk/server/mcp.js" "@modelcontextprotocol/sdk/server/streamableHttp.js" "@modelcontextprotocol/sdk/types.js" express stripe zod "@x402/extensions/bazaar")
NODE_TREE_ALGORITHM="ck-node-tree-v1"
PREPARED_NODE_MODULES_HASH=""
PREPARED_SYMLINK_HASH=""
CRITICAL_DEPENDENCY_HASHES=()
ARTIFACT_ATTESTATION="$STAGING/OPERATOR_HOST_ARTIFACT_ATTESTATION.json"

LOG_FILE="/dev/null"
TRANSACTION_ID=""
TRANSACTION_COMPLETED=0
BACKUP_DIR=""
MUTATION_STARTED=0
RUNTIME_ACTIVATED=0
MANIFESTS_ACTIVATED=0
V23_DEPENDENCIES_MOVED=0
V24_DEPENDENCIES_ACTIVATED=0
SYSTEMD_UNIT_ACTIVATED=0
DAEMON_RELOADED=0
SERVICE_RESTARTED=0
ROLLBACK_FAILURE_EXIT=70
ROLLBACK_RUNNING=0
ROLLBACK_COMPLETE=0
ROLLBACK_ATTEMPTED=0
DEPENDENCIES_ROLLBACK_COMPLETE=0
DEPENDENCY_STATE=ORIGINAL
DRY_RUN_MODE=0
ERROR_REPORTED=0
SIGNAL_REPORTED=0
ENV_HASH_BEFORE=""
DATA_HASH_BEFORE=""
DEPENDENCY_HASH_BEFORE=""
UNIT_HASH_BEFORE=""
UNIT_MODE_BEFORE=""
COMMERCE_HASH_BEFORE=""
EVIDENCE_SOURCE=""
CONTROLLER_EUID="$EUID"

log() {
  local message="$*"
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$message" | tee -a "$LOG_FILE"
}

fail() {
  log "FAIL: $*"
  return 1
}

sha() {
  sha256sum -- "$1" | awk '{print $1}'
}

tree_hash() {
  local directory="$1"
  (
    cd -- "$directory"
    find . -type f -printf '%P\0' | sort -z | xargs -0 sha256sum
  ) | sha256sum | awk '{print $1}'
}

verify_critical_dependency_files() {
  local tree_root="$1"
  node --input-type=module - "$tree_root" "$STAGING/PREPARED_RELEASE.json" <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const [root, manifestPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath));
for (const [relative, expected] of Object.entries(manifest.criticalDependencyFiles ?? {})) {
  const file = `${root}/${relative}`;
  if (!fs.statSync(file, { throwIfNoEntry: false } )?.isFile()) process.exit(1);
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (actual !== expected) process.exit(1);
}
NODE
}

audit_dependency_symlinks() {
  local tree_root="$1"
  local count
  local actual_hash
  count="$(find "$tree_root" -type l -printf '%P\n' 2>/dev/null | wc -l)"
  actual_hash="$(cd -- "$tree_root" && find . -type l -printf '%P\t%l\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')"
  [[ "$actual_hash" == "$PREPARED_SYMLINK_HASH" ]] || {
    fail prepared-symlink-map-hash-mismatch
    return 1
  }
  log "dependency symlink audit: algorithm=ck-symlink-map-v1 symlink_count=$count sha256=$actual_hash"
}

operator_host_artifact_gate() {
  local prepared_tree="$STAGING/prepared-dependency-state/node_modules"
  local live_tree_hash
  local live_symlink_hash
  local package_hash
  local lock_hash
  local candidate_commit
  [[ -f "$ARTIFACT_ATTESTATION" ]] || { fail operator-host-artifact-attestation-missing; return 1; }
  [[ -d "$prepared_tree" ]] || { fail operator-host-prepared-tree-missing; return 1; }
  live_tree_hash="$(tree_hash "$prepared_tree")" || { fail operator-host-tree-recompute-failed; return 1; }
  live_symlink_hash="$(cd -- "$prepared_tree" && find . -type l -printf '%P\t%l\n' | LC_ALL=C sort | sha256sum | awk '{print $1}')" || { fail operator-host-symlink-recompute-failed; return 1; }
  package_hash="$(sha "$STAGING/package.json")" || { fail operator-host-package-hash-failed; return 1; }
  lock_hash="$(sha "$STAGING/package-lock.json")" || { fail operator-host-lock-hash-failed; return 1; }
  candidate_commit="$(git -C "$ROOT" rev-parse HEAD)" || { fail operator-host-commit-recompute-failed; return 1; }
  if ! node --input-type=module - "$ARTIFACT_ATTESTATION" "$STAGING/PREPARED_RELEASE.json" "$prepared_tree" "$live_tree_hash" "$live_symlink_hash" "$package_hash" "$lock_hash" "$candidate_commit" <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const [attestationPath, releasePath, tree, treeHash, symlinkHash, packageHash, lockHash, commit] = process.argv.slice(2);
const attestation = JSON.parse(fs.readFileSync(attestationPath));
const release = JSON.parse(fs.readFileSync(releasePath));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const expectedSchema = 'crossingkey-operator-host-artifact-attestation-v1';
if (attestation.schema !== expectedSchema || attestation.artifactAuthority !== 'operator-host') process.exit(1);
if (attestation.branch !== release.branch || attestation.candidateCommit !== commit) process.exit(1);
if (attestation.dependencyIdentityAlgorithm !== 'ck-node-tree-v1') process.exit(1);
if (attestation.dependencySymlinkIdentityAlgorithm !== 'ck-symlink-map-v1') process.exit(1);
if (attestation.preparedNodeModulesSha256 !== treeHash || attestation.preparedNodeModulesSymlinkSha256 !== symlinkHash) process.exit(1);
if (attestation.packageJsonSha256 !== packageHash || attestation.packageLockSha256 !== lockHash) process.exit(1);
if (attestation.walletMode !== 'receiver-only' || attestation.agentSpendAuthority !== false || attestation.operatorReleaseCostUSD !== 0) process.exit(1);
const critical = attestation.criticalDependencyFiles;
if (!critical || typeof critical !== 'object' || Array.isArray(critical)) process.exit(1);
for (const [relative, expected] of Object.entries(critical)) {
  const file = `${tree}/${relative}`;
  if (!fs.statSync(file, {throwIfNoEntry:false})?.isFile() || hash(file) !== expected) process.exit(1);
}
if (attestation.releaseVersion !== undefined && attestation.releaseVersion !== release.releaseVersion) process.exit(1);
NODE
  then
    fail operator-host-artifact-attestation-mismatch
    return 1
  fi
  PREPARED_NODE_MODULES_HASH="$live_tree_hash"
  PREPARED_SYMLINK_HASH="$live_symlink_hash"
  log "operator-host artifact attestation: PASS tree_sha256=$live_tree_hash symlink_sha256=$live_symlink_hash"
  return 0
}

same_filesystem() {
  local source="$1"
  local destination_parent="$2"
  [[ "$(stat -c %d -- "$source")" == "$(stat -c %d -- "$destination_parent")" ]]
}

candidate_gate() {
  local branch
  local commit
  branch="$(git -C "$ROOT" branch --show-current)"
  commit="$(git -C "$ROOT" rev-parse HEAD)"
  [[ "$branch" == "$EXPECTED_BRANCH" ]] || { fail "wrong candidate branch: $branch"; return 1; }
  [[ "$commit" == "$EXPECTED_COMMIT" ]] || { fail "wrong candidate commit: $commit"; return 1; }
  return 0
}

manifest_gate() {
  [[ -f "$STAGING/PREPARED_RELEASE.json" ]] || { fail prepared-release-missing; return 1; }
  [[ -f "$STAGING/package.json" ]] || { fail staged-package-json-missing; return 1; }
  [[ -f "$STAGING/package-lock.json" ]] || { fail staged-package-lock-missing; return 1; }
  return 0
}

prepared_gate() {
  local prepared_tree="$STAGING/prepared-dependency-state/node_modules"
  local certified_hash
  local algorithm
  local package_lock_zod
  local package_lock_x402
  [[ -f "$STAGING/PREPARED_RELEASE.json" ]] || { fail prepared-release-missing; return 1; }
  [[ -f "$STAGING/package.json" ]] || { fail staged-package-json-missing; return 1; }
  [[ -f "$STAGING/package-lock.json" ]] || { fail staged-package-lock-missing; return 1; }
  [[ -d "$prepared_tree" ]] || { fail prepared-node-modules-missing; return 1; }
  PREPARED_NODE_MODULES_HASH="$(tree_hash "$prepared_tree")" || { fail prepared-tree-hash-failed; return 1; }
  if ! CANDIDATE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)" node --input-type=module - \
    "$STAGING/PREPARED_RELEASE.json" "$STAGING/package.json" "$STAGING/package-lock.json" "$PREPARED_NODE_MODULES_HASH" "$NODE_TREE_ALGORITHM" <<'NODE'
import fs from 'node:fs';
import crypto from 'node:crypto';
const [releasePath, packagePath, lockPath, actualTreeHash, expectedAlgorithm] = process.argv.slice(2);
const hash = (path) => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const release = JSON.parse(fs.readFileSync(releasePath));
const valid = release.releaseVersion === '2.4.0'
  && release.candidateCommit === process.env.CANDIDATE_COMMIT
  && release.packageJsonSha256 === hash(packagePath)
  && release.packageLockSha256 === hash(lockPath)
  && release.dependencyIdentityAlgorithm === expectedAlgorithm
  && /^[0-9a-f]{64}$/.test(release.preparedNodeModulesSha256)
  && release.walletMode === 'receiver-only'
  && release.agentSpendAuthority === false
  && release.operatorReleaseCostUSD === 0;
if (!valid) process.exit(1);
NODE
  then
    fail prepared-release-invariant-mismatch
    return 1
  fi

  certified_hash="$(node --input-type=module -e 'const r=JSON.parse(await import("node:fs").then(m=>m.readFileSync(process.argv[1])));process.stdout.write(r.preparedNodeModulesSha256)' "$STAGING/PREPARED_RELEASE.json")" || { fail prepared-manifest-unreadable; return 1; }
  algorithm="$(node --input-type=module -e 'const r=JSON.parse(await import("node:fs").then(m=>m.readFileSync(process.argv[1])));process.stdout.write(r.dependencyIdentityAlgorithm)' "$STAGING/PREPARED_RELEASE.json")" || { fail prepared-manifest-unreadable; return 1; }
  [[ "$certified_hash" =~ ^[0-9a-f]{64}$ ]] || { fail prepared-node-modules-certificate-invalid; return 1; }
  [[ "$algorithm" == "$NODE_TREE_ALGORITHM" ]] || { fail prepared-node-modules-algorithm-mismatch; return 1; }
  PREPARED_SYMLINK_HASH="$(node --input-type=module -e 'const r=JSON.parse(await import("node:fs").then(m=>m.readFileSync(process.argv[1])));process.stdout.write(r.preparedNodeModulesSymlinkSha256)' "$STAGING/PREPARED_RELEASE.json")" || { fail prepared-manifest-unreadable; return 1; }
  [[ "$PREPARED_SYMLINK_HASH" =~ ^[0-9a-f]{64}$ ]] || { fail prepared-symlink-hash-missing; return 1; }
  verify_critical_dependency_files "$prepared_tree" || { fail critical-dependency-hash-mismatch; return 1; }
  audit_dependency_symlinks "$prepared_tree" || return 1
  package_lock_zod="$(node --input-type=module -e 'const p=JSON.parse(await import("node:fs").then(m=>m.readFileSync(process.argv[1])));process.stdout.write(p.packages?.["node_modules/zod"]?.version||"")' "$STAGING/package-lock.json")"
  package_lock_x402="$(node --input-type=module -e 'const p=JSON.parse(await import("node:fs").then(m=>m.readFileSync(process.argv[1])));process.stdout.write(p.packages?.["node_modules/@x402/extensions"]?.version||"")' "$STAGING/package-lock.json")"
  [[ "$package_lock_zod" == "3.25.76" ]] || { fail prepared-zod-version-mismatch; return 1; }
  [[ "$package_lock_x402" == "2.26.0" ]] || { fail prepared-x402-version-mismatch; return 1; }

  for module in "${runtime_imports[@]}"; do
    (
      cd -- "$STAGING/prepared-dependency-state"
      node --input-type=module -e "await import('$module')"
    ) || { fail "prepared import failed: $module"; return 1; }
  done
  for path in zod/v4/mini/iso.js zod/v4/mini/schemas.js @x402/extensions/dist/esm/bazaar/index.mjs; do
    [[ -f "$prepared_tree/$path" ]] || { fail "critical dependency missing: $path"; return 1; }
  done
  if [[ "${CROSSINGKEY_SANDBOX_VALIDATION:-0}" == 1 ]]; then
    log "operator-host artifact attestation: sandbox validation bypass (host authority not asserted)"
  else
    operator_host_artifact_gate || return 1
  fi
  return 0
}

read_host_evidence() {
  local fragment_path
  local active_state
  local sub_state
  local working_directory
  local evidence_hash
  local evidence_mode
  [[ -n "${HOST_EVIDENCE:-}" ]] || return 1
  [[ -f "$HOST_EVIDENCE" ]] || return 1
  [[ -r "$HOST_EVIDENCE" ]] || return 1
  fragment_path="$(awk -F= '$1=="FragmentPath" {print substr($0,index($0,"=")+1); exit}' "$HOST_EVIDENCE")"
  evidence_hash="$(awk -F= '$1=="unit_sha256" {print $2; exit}' "$HOST_EVIDENCE")"
  evidence_mode="$(awk -F= '$1=="unit_mode" {print $2; exit}' "$HOST_EVIDENCE")"
  active_state="$(awk -F= '$1=="ActiveState" {print $2; exit}' "$HOST_EVIDENCE")"
  sub_state="$(awk -F= '$1=="SubState" {print $2; exit}' "$HOST_EVIDENCE")"
  working_directory="$(awk -F= '$1=="WorkingDirectory" {print substr($0,index($0,"=")+1); exit}' "$HOST_EVIDENCE")"
  [[ "$fragment_path" == "$UNIT_PATH" ]] || return 1
  [[ "$evidence_hash" =~ ^[[:xdigit:]]{64}$ ]] || return 1
  [[ "$evidence_mode" =~ ^[0-9]+$ ]] || return 1
  [[ "$active_state" == active ]] || return 1
  [[ "$sub_state" == running ]] || return 1
  [[ "$working_directory" == "$PROD" ]] || return 1
  [[ "$(awk -F= '$1=="health_version" {print $2; exit}' "$HOST_EVIDENCE")" == 2.3.0 ]] || return 1
  UNIT_HASH_BEFORE="$evidence_hash"
  UNIT_MODE_BEFORE="$evidence_mode"
}

resolve_live_unit() {
  local fragment_path
  command -v systemctl >/dev/null || { fail systemctl-missing; return 1; }
  fragment_path="$(systemctl show "$SERVICE" -p FragmentPath --value 2>/dev/null || true)"
  [[ "$fragment_path" == "$UNIT_PATH" ]] || { fail "unexpected FragmentPath=${fragment_path:-missing}"; return 1; }
  return 0
}

resolve_systemd_evidence() {
  local fragment_path
  local active_state
  local sub_state
  local working_directory
  if command -v systemctl >/dev/null 2>&1; then
    fragment_path="$(systemctl show "$SERVICE" -p FragmentPath --value 2>/dev/null || true)"
    if [[ "$fragment_path" == "$UNIT_PATH" && -r "$UNIT_PATH" ]]; then
      active_state="$(systemctl show "$SERVICE" -p ActiveState --value 2>/dev/null || true)"
      sub_state="$(systemctl show "$SERVICE" -p SubState --value 2>/dev/null || true)"
      working_directory="$(systemctl show "$SERVICE" -p WorkingDirectory --value 2>/dev/null || true)"
      [[ "$active_state" == active ]] || { fail "unexpected ActiveState=${active_state:-missing}"; return 1; }
      [[ "$sub_state" == running ]] || { fail "unexpected SubState=${sub_state:-missing}"; return 1; }
      [[ "$working_directory" == "$PROD" ]] || { fail "unexpected WorkingDirectory=${working_directory:-missing}"; return 1; }
      UNIT_HASH_BEFORE="$(sha "$UNIT_PATH")"
      UNIT_MODE_BEFORE="$(stat -c %a -- "$UNIT_PATH")"
      EVIDENCE_SOURCE="LIVE_HOST"
      return 0
    fi
  fi
  [[ -n "${HOST_EVIDENCE:-}" ]] || { fail 'systemd live inspection unavailable and HOST_EVIDENCE is empty'; return 1; }
  read_host_evidence || { fail 'invalid operator host evidence fallback'; return 1; }
  EVIDENCE_SOURCE="OPERATOR_HOST_EVIDENCE"
}

state_gate() {
  [[ -d "$PROD" ]] || { fail production-root-missing; return 1; }
  [[ -f "$PROD/.env" ]] || { fail production-env-missing; return 1; }
  [[ -d "$PROD/data" ]] || { fail production-data-missing; return 1; }
  [[ -d "$PROD/node_modules" ]] || { fail production-node-modules-missing; return 1; }
  ENV_HASH_BEFORE="$(sha "$PROD/.env")" || { fail production-env-hash-failed; return 1; }
  DATA_HASH_BEFORE="$(tree_hash "$PROD/data")" || { fail production-data-hash-failed; return 1; }
  DEPENDENCY_HASH_BEFORE="$(tree_hash "$PROD/node_modules")" || { fail production-dependency-hash-failed; return 1; }
  resolve_systemd_evidence || return 1
  [[ -f "$PROD/data/machine_commerce.json" ]] || { fail production-commerce-state-missing; return 1; }
  COMMERCE_HASH_BEFORE="$(sha "$PROD/data/machine_commerce.json")" || { fail production-commerce-hash-failed; return 1; }
  return 0
}

assert_rename_preconditions() {
  local source="$1"
  local destination="$2"
  [[ -n "$source" ]] || { fail rename-source-empty; return 1; }
  [[ -n "$destination" ]] || { fail rename-destination-empty; return 1; }
  [[ -e "$source" ]] || { fail "rename source missing: $source"; return 1; }
  [[ ! -e "$destination" ]] || { fail "rename destination exists: $destination"; return 1; }
  same_filesystem "$source" "$PROD" || { fail "rename crosses filesystem: $source -> $destination"; return 1; }
  log "rename preconditions: source=$source destination=$destination"
}

backup_runtime_manifest() {
  local destination="$1"
  local path
  mkdir -p "$destination/runtime/lib" || return 1
  : >"$destination/runtime-manifest.tsv" || return 1
  for path in "${runtime_files[@]}"; do
    if [[ -e "$PROD/$path" ]]; then
      cp -a -- "$PROD/$path" "$destination/runtime/$path" || return 1
      printf '%s\ttrue\t%s\t%s\n' "$path" "$(sha "$PROD/$path")" \
        "$(stat -c %a -- "$PROD/$path")" >>"$destination/runtime-manifest.tsv" || return 1
    else
      printf '%s\tfalse\t-\t-\n' "$path" >>"$destination/runtime-manifest.tsv" || return 1
    fi
  done
}

create_backup() {
  local destination="$1"
  log "backup phase: start destination=$destination"
  mkdir -p "$destination" || return 1
  backup_runtime_manifest "$destination" || return 1
  cp -a -- "$PROD/package.json" "$destination/package.json" || return 1
  cp -a -- "$PROD/package-lock.json" "$destination/package-lock.json" || return 1
  cp -a -- "$UNIT_PATH" "$destination/unit.v23" || return 1
  printf '%s\n' "$ENV_HASH_BEFORE" >"$destination/env.sha256" || return 1
  printf '%s\n' "$DATA_HASH_BEFORE" >"$destination/data.sha256" || return 1
  printf '%s\n' "$DEPENDENCY_HASH_BEFORE" >"$destination/dependency.sha256" || return 1
  printf '%s %s\n' "$UNIT_HASH_BEFORE" "$UNIT_MODE_BEFORE" >"$destination/unit.meta" || return 1
  chmod --reference="$UNIT_PATH" "$destination/unit.v23" || return 1
  [[ "$(sha "$destination/unit.v23")" == "$UNIT_HASH_BEFORE" ]] || { fail unit-backup-hash-mismatch; return 1; }
  [[ "$(stat -c %a -- "$destination/unit.v23")" == "$UNIT_MODE_BEFORE" ]] || { fail unit-backup-mode-mismatch; return 1; }
  log "backup phase: verified runtime, manifests, unit, and state hashes"
}

stage_release() {
  local destination="$1"
  local path
  log "staging phase: start"
  mkdir -p "$destination/candidate/lib" "$destination/prepared" || return 1
  for path in "${runtime_files[@]}"; do
    [[ -f "$ROOT/$path" ]] || { fail "candidate runtime missing: $path"; return 1; }
    cp -a -- "$ROOT/$path" "$destination/candidate/$path" || return 1
  done
  cp -a -- "$STAGING/package.json" "$destination/candidate/package.json" || return 1
  cp -a -- "$STAGING/package-lock.json" "$destination/candidate/package-lock.json" || return 1
  cp -a -- "$STAGING/prepared-dependency-state/node_modules" \
    "$destination/prepared/node_modules" || return 1
  same_filesystem "$destination/prepared/node_modules" "$PROD" || { fail prepared-tree-crosses-filesystem; return 1; }
  [[ "$(tree_hash "$destination/prepared/node_modules")" == "$PREPARED_NODE_MODULES_HASH" ]] || { fail prepared-tree-certified-hash-mismatch; return 1; }
  [[ "$(tree_hash "$destination/prepared/node_modules")" != "$DEPENDENCY_HASH_BEFORE" ]] || { fail prepared-tree-equals-v23; return 1; }
  log "staging dependency identity: algorithm=$NODE_TREE_ALGORITHM sha256=$PREPARED_NODE_MODULES_HASH"
  log "staging phase: candidate and prepared dependency tree verified"
}

candidate_boot_gate() {
  local boot_root=""
  local runtime_dir
  local candidate
  local data
  local delivery
  local stdout_log
  local stderr_log
  local commerce_file
  local port
  local pid=""
  local body
  local candidate_pid_alive=0
  boot_root="$(mktemp -d "${TMPDIR:-/tmp}/crossingkey-v240-candidate-boot.XXXXXX")" || { fail candidate-boot-mktemp-failed; return 1; }
  [[ -n "$boot_root" ]] || { fail candidate-boot-root-empty; return 1; }
  [[ -d "$boot_root" ]] || { fail candidate-boot-root-missing; return 1; }
  [[ "$boot_root" != / ]] || { fail candidate-boot-root-invalid; return 1; }
  cleanup_candidate_boot() {
    if [[ -n "$pid" ]] && [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    if [[ -n "$boot_root" ]] && [[ "$boot_root" == "${TMPDIR:-/tmp}"/crossingkey-v240-candidate-boot.* ]] && [[ "$boot_root" != / ]]; then
      rm -rf -- "$boot_root"
    fi
  }
  trap cleanup_candidate_boot RETURN
  require_under_boot_root() {
    case "$1" in
      "$boot_root"/*) return 0 ;;
      *) fail "candidate-boot-path-escape:$1"; return 1 ;;
    esac
  }
  runtime_dir="$boot_root/runtime"
  candidate="$runtime_dir"
  data="$runtime_dir/data"
  delivery="$runtime_dir/delivery"
  stdout_log="$boot_root/stdout.log"
  stderr_log="$boot_root/stderr.log"
  commerce_file="$data/machine_commerce.json"
  for path in "$runtime_dir" "$candidate" "$data" "$delivery" "$stdout_log" "$stderr_log" "$commerce_file" "$runtime_dir/node_modules"; do
    require_under_boot_root "$path" || return 1
  done
  [[ -d "$STAGING/prepared-dependency-state/node_modules" ]] || { fail prepared-node-modules-missing; return 1; }
  prepared_gate || return 1
  mkdir -p "$runtime_dir" "$data" "$delivery" || { fail candidate-boot-runtime-mkdir-failed; return 1; }
  printf '{"idempotency":{},"entitlements":{},"receipts":{},"replayKeys":{}}\n' >"$commerce_file" || return 1
  printf 'NODE_ENV=test\n' >"$runtime_dir/.env" || return 1
  local candidate_env_hash candidate_data_hash candidate_commerce_hash
  candidate_env_hash="$(sha "$runtime_dir/.env")" || return 1
  candidate_data_hash="$(tree_hash "$data")" || return 1
  candidate_commerce_hash="$(sha "$commerce_file")" || return 1
  for path in "${runtime_files[@]}"; do
    [[ -f "$ROOT/$path" ]] || { fail "candidate runtime missing: $path"; return 1; }
    mkdir -p "$runtime_dir/$(dirname -- "$path")" || return 1
    cp -a -- "$ROOT/$path" "$runtime_dir/$path" || { fail candidate-boot-runtime-copy-failed; return 1; }
  done
  cp -a -- "$STAGING/package.json" "$runtime_dir/package.json" || return 1
  cp -a -- "$STAGING/package-lock.json" "$runtime_dir/package-lock.json" || return 1
  ln -s -- "$STAGING/prepared-dependency-state/node_modules" "$runtime_dir/node_modules" || { fail candidate-boot-dependency-link-failed; return 1; }
  [[ "$(readlink -f "$runtime_dir/node_modules")" == "$(readlink -f "$STAGING/prepared-dependency-state/node_modules")" ]] || { fail candidate-boot-dependency-link-mismatch; return 1; }
  port="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')" || { fail candidate-boot-port-selection-failed; return 1; }
  log "candidate boot gate: start port=$port"
  pushd "$runtime_dir" >/dev/null || { fail candidate-boot-cd-failed; return 1; }
  env -i PATH="$PATH" PORT="$port" \
    PUBLIC_BASE_URL="http://127.0.0.1:$port" \
    MACHINE_COMMERCE_FILE="$commerce_file" \
    CK_ENABLE_MAINNET=false \
    CLAIM_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')" \
    NODE_ENV=test \
    nohup node server.mjs >"$stdout_log" 2>"$stderr_log" < /dev/null &
  pid=$!
  popd >/dev/null
  [[ "$pid" =~ ^[0-9]+$ ]] || { fail candidate-boot-pid-invalid; return 1; }
  for _ in {1..30}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      log candidate-boot-process-exited-before-ready
      sed -E 's/(sk_(live|test)_[A-Za-z0-9_-]+|SECRET[=:][^ ]+|PRIVATE_KEY[=:][^ ]+)/[REDACTED]/g' "$stderr_log" "$stdout_log" 2>/dev/null | tail -60 | while IFS= read -r line; do [[ -n "$line" ]] && log "candidate boot diagnostic: $line"; done
      return 1
    fi
    body="$(curl -fsS --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null || true)"
    if verify_health_response "$body" candidate >/dev/null 2>&1; then
      (
        PROD="$runtime_dir"
        ENV_HASH_BEFORE="$candidate_env_hash"
        DATA_HASH_BEFORE="$candidate_data_hash"
        COMMERCE_HASH_BEFORE="$candidate_commerce_hash"
        verify_release "http://127.0.0.1:$port" candidate
      ) || return 1
      if [[ -n "${CROSSINGKEY_CANDIDATE_HEALTH_CAPTURE_FILE:-}" ]]; then
        printf '%s\n' "$body" >"$CROSSINGKEY_CANDIDATE_HEALTH_CAPTURE_FILE" || { fail candidate-health-capture-write-failed; return 1; }
      fi
      kill -TERM "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      if kill -0 "$pid" 2>/dev/null; then
        kill -KILL "$pid" 2>/dev/null || true
        fail candidate-boot-process-survived
        return 1
      fi
      log "candidate boot gate: PASS"
      [[ -z "$(ss -H -ltn "sport = :$port")" ]] || { fail candidate-listener-remained; return 1; }
      log "candidate cleanup: pid=$pid exited port=$port no-listener"
      return 0
    fi
    sleep 0.25
  done
  kill -TERM "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  sed -E 's/(sk_(live|test)_[A-Za-z0-9_-]+|SECRET[=:][^ ]+|PRIVATE_KEY[=:][^ ]+)/[REDACTED]/g' "$stderr_log" | tail -40 | while IFS= read -r line; do
    [[ -n "$line" ]] && log "candidate boot stderr: $line"
  done
  sed -E 's/(sk_(live|test)_[A-Za-z0-9_-]+|SECRET[=:][^ ]+|PRIVATE_KEY[=:][^ ]+)/[REDACTED]/g' "$stdout_log" | tail -20 | while IFS= read -r line; do
    [[ -n "$line" ]] && log "candidate boot stdout: $line"
  done
  fail candidate-boot-health-timeout
  return 1
}

activate_runtime() {
  local path
  log "mutation boundary: runtime activation: start"
  for path in "${runtime_files[@]}"; do
    mkdir -p "$PROD/$(dirname -- "$path")"
    mv -- "$BACKUP_DIR/candidate/$path" "$PROD/$path"
  done
  log "mutation boundary: runtime activation: complete"
}

build_unit_candidate() {
  local candidate="$BACKUP_DIR/unit.v24"
  [[ -f "$BACKUP_DIR/unit.v23" ]] || { fail unit-backup-missing; return 1; }
  sed 's/^Description=.*/Description=CrossingKey MCP v2.4.0/' \
    "$BACKUP_DIR/unit.v23" >"$candidate"
  diff -u <(sed '/^Description=/d' "$BACKUP_DIR/unit.v23") \
    <(sed '/^Description=/d' "$candidate") >/dev/null || { fail unit-change-not-description-only; return 1; }
  chmod --reference="$BACKUP_DIR/unit.v23" "$candidate" || return 1
  log "systemd phase: Description-only candidate verified"
}

execution_identity_gate() {
  local current_user
  current_user="$(id -un)"
  if [[ "$CONTROLLER_EUID" -eq 0 ]]; then
    fail 'whole-controller root execution rejected'
    return 1
  fi
  log "execution identity: uid=$CONTROLLER_EUID user=$current_user"
}

ownership_invariant_gate() {
  local path
  for path in "$ROOT" "$REPORT_DIR" "$BACKUP_ROOT"; do
    [[ -e "$path" ]] || continue
    [[ "$(stat -c %u -- "$path")" == "$CONTROLLER_EUID" ]] || { fail "founder path not founder-owned: $path"; return 1; }
    [[ -w "$path" ]] || { fail "founder path not writable: $path"; return 1; }
  done
  for path in "$PROD" "$PROD/lib" "$PROD/node_modules"; do
    [[ -e "$path" ]] || { fail "production path missing: $path"; return 1; }
    log "production parent permissions: $(stat -c '%U:%G %a %n' -- "$path")"
  done
}

filesystem_permission_gate() {
  local path
  local parent
  for path in "${runtime_files[@]}" package.json package-lock.json; do
    parent="$PROD/$(dirname -- "$path")"
    if [[ -w "$parent" ]]; then
      log "founder mutation path: writable parent=$parent"
    else
      log "privileged mutation path: non-writable parent=$parent"
    fi
  done
  if [[ -w "$PROD" ]]; then
    log "founder mutation path: writable production root"
  else
    log "privileged mutation path: non-writable production root"
  fi
}

privilege_preflight() {
  [[ "$SERVICE" == crossingkey-revenue-mcp.service ]] || { fail 'service name is not canonical'; return 1; }
  [[ "$UNIT_PATH" == "$CANONICAL_UNIT_PATH" ]] || { fail 'unit path is not canonical'; return 1; }
  command -v sudo >/dev/null 2>&1 || { fail sudo-missing; return 1; }
  sudo -n -l /usr/bin/install >/dev/null 2>&1 || { fail 'sudo install privilege unavailable'; return 1; }
  sudo -n -l /usr/bin/systemctl >/dev/null 2>&1 || { fail 'sudo systemctl privilege unavailable'; return 1; }
  sudo -n -l /usr/bin/mv >/dev/null 2>&1 || { fail 'sudo mv privilege unavailable'; return 1; }
  log 'privilege preflight: narrow install/systemctl authorization available'
}

install_systemd_unit() {
  local source="$BACKUP_DIR/unit.v24"
  if [[ "$UNIT_PATH" != "$CANONICAL_UNIT_PATH" ]]; then
    fail 'unit install destination is not canonical'
    return 1
  fi
  [[ "$source" == "$BACKUP_DIR/unit.v24" ]] || { fail 'unit source invariant failed'; return 1; }
  [[ -f "$source" ]] || { fail unit-candidate-missing; return 1; }
  [[ "$(sha "$source")" == "$(sha "$BACKUP_DIR/unit.v24")" ]] || { fail unit-candidate-changed; return 1; }
  sudo -n /usr/bin/install -o root -g root -m "$UNIT_MODE_BEFORE" -- "$source" "$UNIT_PATH" || return 1
  [[ "$(sha "$UNIT_PATH")" == "$(sha "$source")" ]] || { fail unit-install-hash-mismatch; return 1; }
}

install_application_file() {
  local source="$1"
  local relative_path="$2"
  local destination="$PROD/$relative_path"
  local mode
  case "$relative_path" in
    server.mjs|package.json|package-lock.json|lib/machine-commerce.mjs|lib/discovery.mjs|lib/onchain-verifier.mjs) ;;
    *) fail 'application destination is not reviewed' ; return 1 ;;
  esac
  [[ "$source" == "$BACKUP_DIR/"* ]] || { fail 'application source is not staged'; return 1; }
  [[ -f "$source" ]] || { fail application-source-missing; return 1; }
  mode="$(stat -c %a -- "$source")"
  sudo -n /usr/bin/install -o founder -g founder -m "$mode" -- "$source" "$destination" || return 1
  [[ "$(stat -c '%U:%G' -- "$destination")" == founder:founder ]] || { fail application-owner-mismatch; return 1; }
}

restore_systemd_unit() {
  local source="$BACKUP_DIR/unit.v23"
  if [[ "$UNIT_PATH" != "$CANONICAL_UNIT_PATH" ]]; then
    fail 'unit restore destination is not canonical'
    return 1
  fi
  [[ "$source" == "$BACKUP_DIR/unit.v23" ]] || { fail 'unit restore source invariant failed'; return 1; }
  [[ -f "$source" ]] || { fail unit-backup-missing; return 1; }
  [[ "$(sha "$source")" == "$UNIT_HASH_BEFORE" ]] || { fail unit-restore-backup-hash-mismatch; return 1; }
  sudo -n /usr/bin/install -o root -g root -m "$UNIT_MODE_BEFORE" -- "$source" "$UNIT_PATH" || return 1
  [[ "$(sha "$UNIT_PATH")" == "$UNIT_HASH_BEFORE" ]] || { fail unit-restore-live-hash-mismatch; return 1; }
}

systemd_daemon_reload() {
  sudo -n /usr/bin/systemctl daemon-reload
}

systemd_restart_service() {
  if [[ "$SERVICE" != crossingkey-revenue-mcp.service ]]; then
    fail 'restart service invariant failed'
    return 1
  fi
  sudo -n /usr/bin/systemctl restart crossingkey-revenue-mcp.service
}

activate_unit() {
  build_unit_candidate || return 1
  log "mutation boundary: systemd unit activation: start"
  install_systemd_unit || return 1
  SYSTEMD_UNIT_ACTIVATED=1
  systemd_daemon_reload || return 1
  DAEMON_RELOADED=1
  log "mutation boundary: systemd unit activation: complete"
}

activate_dependencies() {
  local old_tree="$PROD/.node_modules.v23.$TRANSACTION_ID"
  local failed_tree="$PROD/.node_modules.failed-v24.$TRANSACTION_ID"
  local prepared_tree="$BACKUP_DIR/prepared/node_modules"
  DEPENDENCIES_ROLLBACK_COMPLETE=0
  DEPENDENCY_STATE=ORIGINAL
  log "mutation boundary: dependency activation: start"
  [[ -n "$TRANSACTION_ID" ]] || { fail transaction-id-missing; return 1; }
  [[ -n "$BACKUP_DIR" ]] || { fail dependency-backup-dir-missing; return 1; }
  [[ -d "$PROD/node_modules" ]] || { fail active-dependency-tree-missing; return 1; }
  [[ -d "$prepared_tree" ]] || { fail prepared-dependency-tree-missing; return 1; }
  assert_rename_preconditions "$PROD/node_modules" "$old_tree" || return 1
  [[ ! -e "$failed_tree" ]] || { fail failed-dependency-path-already-exists; return 1; }
  printf '%s\n' "$old_tree" >"$BACKUP_DIR/active-v23-path" || return 1
  printf '%s\n' "$failed_tree" >"$BACKUP_DIR/failed-v24-path" || return 1
  [[ -s "$BACKUP_DIR/active-v23-path" ]] || { fail active-dependency-metadata-missing; return 1; }
  [[ -s "$BACKUP_DIR/failed-v24-path" ]] || { fail failed-dependency-metadata-missing; return 1; }
  sudo -n /usr/bin/mv -- "$PROD/node_modules" "$old_tree" || return 1
  V23_DEPENDENCIES_MOVED=1
  DEPENDENCY_STATE=V23_MOVED
  assert_rename_preconditions "$prepared_tree" "$PROD/node_modules" || return 1
  sudo -n /usr/bin/mv -- "$prepared_tree" "$PROD/node_modules" || return 1
  V24_DEPENDENCIES_ACTIVATED=1
  DEPENDENCY_STATE=V24_ACTIVE
  if [[ "$(tree_hash "$PROD/node_modules")" != "$PREPARED_NODE_MODULES_HASH" ]]; then
    fail active-prepared-dependency-hash-mismatch
    return 1
  fi
  verify_critical_dependency_files "$PROD/node_modules" || { fail active-critical-dependency-hash-mismatch; return 1; }
  for path in zod/v4/mini/iso.js zod/v4/mini/schemas.js @x402/extensions/dist/esm/bazaar/index.mjs; do
    [[ -f "$PROD/node_modules/$path" ]] || { fail "active critical dependency missing: $path"; return 1; }
    log "active dependency file: $path sha256=$(sha "$PROD/node_modules/$path")"
  done
  [[ "$(stat -c '%U:%G' -- "$PROD/node_modules")" == founder:founder ]] || { fail prepared-dependency-owner-mismatch; return 1; }
  log "mutation boundary: dependency activation: complete"
}

rollback_dependencies() {
  local old_tree
  local failed_tree

  if [[ "$DEPENDENCY_STATE" == ROLLED_BACK ]]; then
    if [[ ! -d "$PROD/node_modules" ]]; then
      fail rollback-dependency-active-tree-missing
      return 1
    fi
    if [[ "$(tree_hash "$PROD/node_modules")" != "$DEPENDENCY_HASH_BEFORE" ]]; then
      fail rollback-dependency-hash-mismatch
      return 1
    fi
    DEPENDENCIES_ROLLBACK_COMPLETE=1
    V24_DEPENDENCIES_ACTIVATED=0
    V23_DEPENDENCIES_MOVED=0
    log "rollback dependency phase: already complete"
    return 0
  fi

  if (( DEPENDENCIES_ROLLBACK_COMPLETE )); then
    if [[ "$(tree_hash "$PROD/node_modules")" != "$DEPENDENCY_HASH_BEFORE" ]]; then
      fail rollback-dependency-hash-mismatch
      return 1
    fi
    log "rollback dependency phase: already complete"
    return 0
  fi

  if (( ! V23_DEPENDENCIES_MOVED && ! V24_DEPENDENCIES_ACTIVATED )); then
    log "rollback dependency phase: no dependency mutation occurred"
    return 0
  fi
  [[ -f "$BACKUP_DIR/active-v23-path" ]] || { fail active-dependency-metadata-missing; return 1; }
  [[ -f "$BACKUP_DIR/failed-v24-path" ]] || { fail failed-dependency-metadata-missing; return 1; }
  old_tree="$(cat "$BACKUP_DIR/active-v23-path")"
  failed_tree="$(cat "$BACKUP_DIR/failed-v24-path")"
  [[ -n "$old_tree" && -n "$failed_tree" ]] || { fail dependency-rollback-metadata-empty; return 1; }
  log "rollback dependency phase: start"
  if (( V24_DEPENDENCIES_ACTIVATED )); then
    if [[ -e "$failed_tree" && "$DEPENDENCY_STATE" != ROLLED_BACK ]]; then
      fail failed-dependency-quarantine-already-exists
      return 1
    fi
    if ! assert_rename_preconditions "$PROD/node_modules" "$failed_tree"; then return 1; fi
    if ! sudo -n /usr/bin/mv -- "$PROD/node_modules" "$failed_tree"; then return 1; fi
    V24_DEPENDENCIES_ACTIVATED=0
  fi
  if (( V23_DEPENDENCIES_MOVED )); then
    if ! assert_rename_preconditions "$old_tree" "$PROD/node_modules"; then return 1; fi
    if ! sudo -n /usr/bin/mv -- "$old_tree" "$PROD/node_modules"; then return 1; fi
    V23_DEPENDENCIES_MOVED=0
  fi
  if [[ "$(tree_hash "$PROD/node_modules")" != "$DEPENDENCY_HASH_BEFORE" ]]; then
    fail rollback-dependency-hash-mismatch
    return 1
  fi
  DEPENDENCIES_ROLLBACK_COMPLETE=1
  DEPENDENCY_STATE=ROLLED_BACK
  log "rollback dependency phase: complete"
  return 0
}

wait_ready() {
  local expected="$1"
  local base="${2:-http://127.0.0.1:3000}"
  local attempt
  local body
  for attempt in {1..30}; do
    body="$(curl -fsS --max-time 3 "$base/health" 2>/dev/null || true)"
    if node -e 'const b=JSON.parse(process.argv[1]);process.exit(b.ok===true&&b.version===process.argv[2]?0:1)' "$body" "$expected" 2>/dev/null; then
      return 0
    fi
    (( attempt < 30 )) && sleep 1
  done
  [[ "$base" != http://127.0.0.1:3000 ]] || log_startup_diagnostics
  fail "readiness failed for version $expected"
}

verify_health_response() {
  local body="$1"
  local mode="${2:-production}"
  local reason
  case "$mode" in production|candidate) ;; *) fail health-mode-invalid; return 1;; esac
  reason="$(node - "$body" "$mode" "$RECEIVER" <<'NODE'
const [text, mode, receiver] = process.argv.slice(2);
let b;
try { b = JSON.parse(text); } catch { process.stdout.write('health-json-invalid'); process.exit(0); }
if (!b || typeof b !== 'object' || Array.isArray(b)) { process.stdout.write('health-json-invalid'); process.exit(0); }
if (b.ok !== true) { process.stdout.write('health-ok-mismatch'); process.exit(0); }
if (b.service !== 'crossingkey-mcp') { process.stdout.write('health-service-mismatch'); process.exit(0); }
if (b.version !== '2.4.0') { process.stdout.write('health-version-mismatch'); process.exit(0); }
if (!b.machine_commerce || typeof b.machine_commerce !== 'object') { process.stdout.write('health-machine-commerce-missing'); process.exit(0); }
const m = b.machine_commerce;
if (m.walletMode !== 'receiver-only') { process.stdout.write('health-wallet-mode-mismatch'); process.exit(0); }
if (m.receiver !== receiver) { process.stdout.write('health-receiver-mismatch'); process.exit(0); }
const production = mode === 'production';
if (production && m.network !== 'eip155:8453') { process.stdout.write('health-network-mismatch'); process.exit(0); }
if (!production && m.network !== 'eip155:84532') { process.stdout.write('health-network-mismatch'); process.exit(0); }
if (production && m.mainnetEnabled !== true) { process.stdout.write('health-mainnet-disabled'); process.exit(0); }
if (!production && m.mainnetEnabled !== false) { process.stdout.write('health-mainnet-enabled-in-candidate'); process.exit(0); }
if (m.aiRequired !== false) { process.stdout.write('health-ai-required-mismatch'); process.exit(0); }
if (!Array.isArray(m.x402Versions) || !m.x402Versions.includes(1) || !m.x402Versions.includes(2)) { process.stdout.write('health-x402-versions-mismatch'); process.exit(0); }
process.stdout.write('ok');
NODE
)" || { fail health-validator-internal-error; return 1; }
  [[ "$reason" == ok ]] || { fail "$reason"; return 1; }
  return 0
}

verify_well_known_response() {
  local body="$1"
  if ! node - "$body" <<'NODE'
const b=JSON.parse(process.argv[2]);
if (b.version !== '2.4.0') process.exit(1);
NODE
  then
    fail well-known-version-mismatch
    return 1
  fi
  return 0
}

log_startup_diagnostics() {
  local state
  log "startup diagnostics: service=$(systemctl is-active "$SERVICE" 2>/dev/null || true)"
  state="$(systemctl show "$SERVICE" -p ActiveState -p SubState -p Result -p ExecMainStatus 2>/dev/null || true)"
  while IFS= read -r line; do
    [[ -n "$line" ]] && log "startup diagnostics: $line"
  done <<<"$state"
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u "$SERVICE" -n 40 --no-pager --no-hostname --output=short-iso 2>/dev/null \
      | sed -E 's/(sk_(live|test)_[A-Za-z0-9_-]+|PRIVATE_KEY[=:][^ ]+|SECRET[=:][^ ]+)/[REDACTED]/g' \
      | while IFS= read -r line; do
          [[ -n "$line" ]] && log "startup journal: $line"
        done
  fi
}

verify_runtime_spend_authority() {
  if ! node --input-type=module - "$1" <<'NODE'
const base = process.argv[2];
const headers = {'content-type':'application/json', accept:'application/json, text/event-stream'};
let session;
try {
  const call = async body => {
    const response = await fetch(`${base}/mcp`, {method:'POST', headers, body:JSON.stringify(body), signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('mcp-authority-request-failed');
    if (response.headers.get('mcp-session-id')) {
      session = response.headers.get('mcp-session-id');
      headers['mcp-session-id'] = session;
    }
    const text = await response.text();
    if (!text) return {};
    const data = text.startsWith('event:') || text.startsWith('data:') ? text.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n') : text;
    const result = JSON.parse(data);
    if (result.error) throw new Error('mcp-authority-rpc-failed');
    return result;
  };
  await call({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'release-authority-verifier',version:'1'}}});
  await call({jsonrpc:'2.0',method:'notifications/initialized'});
  const result = await call({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'payment.methods',arguments:{}}});
  if (result.result?.isError || result.result?.structuredContent?.wallet_authority?.agent_spend !== false) throw new Error('mcp-agent-spend-authority-mismatch');
} catch {
  process.exitCode = 1;
} finally {
  if (session) await fetch(`${base}/mcp`,{method:'DELETE',headers,signal:AbortSignal.timeout(5000)}).catch(()=>{});
}
NODE
  then
    fail mcp-agent-spend-authority-verification-failed
    return 1
  fi
  return 0
}

verify_mcp_contract() {
  local base="${1:-http://127.0.0.1:3000}"
  local mode="${2:-production}"
  node "$SCRIPT_DIR/verify-v240-mcp.mjs" "$base" "$mode" \
    "$STAGING/prepared-dependency-state/node_modules" "${CROSSINGKEY_MCP_CAPTURE_FILE:-}" || return 1
  return 0
}

verify_release() {
  local base="${1:-http://127.0.0.1:3000}"
  local mode="${2:-production}"
  case "$mode" in
    production) [[ "$base" == http://127.0.0.1:3000 ]] || { fail verification-production-target-invalid; return 1; } ;;
    candidate) [[ "$base" =~ ^http://127\.0\.0\.1:[0-9]+$ && "$base" != http://127.0.0.1:3000 && "$PROD" == "${TMPDIR:-/tmp}"/crossingkey-v240-candidate-boot.*/runtime ]] || { fail verification-candidate-target-invalid; return 1; } ;;
    *) fail verification-mode-invalid; return 1 ;;
  esac
  local health
  local well_known
  wait_ready 2.4.0 "$base" || return 1
  log "verification phase: local health"
  health="$(curl -fsS --max-time 5 "$base/health")" || { fail health-request-failed; return 1; }
  verify_health_response "$health" "$mode" || return 1
  log "verification phase: well-known"
  well_known="$(curl -fsS --max-time 5 "$base/.well-known/mcp.json")" || { fail well-known-request-failed; return 1; }
  verify_well_known_response "$well_known" || return 1
  log "verification phase: MCP initialize, tools/list, free/read-only verifier, Bazaar, x402, Base contract"
  verify_mcp_contract "$base" "$mode" || return 1
  [[ "$(sha "$PROD/.env")" == "$ENV_HASH_BEFORE" ]] || { fail env-mutated; return 1; }
  [[ "$(tree_hash "$PROD/data")" == "$DATA_HASH_BEFORE" ]] || { fail data-mutated; return 1; }
  [[ "$(sha "$PROD/data/machine_commerce.json")" == "$COMMERCE_HASH_BEFORE" ]] || { fail commerce-state-mutated; return 1; }
  log "verification phase: state and zero-capital invariants: PASS"
}

verify_rollback_state() {
  local path
  local existed
  local expected_hash
  local expected_mode
  while IFS=$'\t' read -r path existed expected_hash expected_mode; do
    if [[ "$existed" == true ]]; then
      if [[ ! -f "$PROD/$path" ]]; then
        fail "rollback runtime missing: $path"
        return 1
      fi
      if [[ "$(sha "$PROD/$path")" != "$expected_hash" ]]; then
        fail "rollback runtime hash mismatch: $path"
        return 1
      fi
      if [[ "$(stat -c %a -- "$PROD/$path")" != "$expected_mode" ]]; then
        fail "rollback runtime mode mismatch: $path"
        return 1
      fi
    else
      if [[ -e "$PROD/$path" ]]; then
        fail "rollback orphaned runtime path: $path"
        return 1
      fi
    fi
  done <"$BACKUP_DIR/runtime-manifest.tsv"
  if [[ "$(sha "$PROD/package.json")" != "$(sha "$BACKUP_DIR/package.json")" ]]; then
    fail rollback-package-json
    return 1
  fi
  if [[ "$(sha "$PROD/package-lock.json")" != "$(sha "$BACKUP_DIR/package-lock.json")" ]]; then
    fail rollback-package-lock
    return 1
  fi
  if [[ "$(tree_hash "$PROD/node_modules")" != "$DEPENDENCY_HASH_BEFORE" ]]; then
    fail rollback-dependency-tree
    return 1
  fi
  if [[ "$(sha "$UNIT_PATH")" != "$UNIT_HASH_BEFORE" ]]; then
    fail rollback-unit-hash
    return 1
  fi
  if [[ "$(stat -c %a -- "$UNIT_PATH")" != "$UNIT_MODE_BEFORE" ]]; then
    fail rollback-unit-mode
    return 1
  fi
  if [[ "$(sha "$PROD/.env")" != "$ENV_HASH_BEFORE" ]]; then
    fail rollback-env
    return 1
  fi
  if [[ "$(tree_hash "$PROD/data")" != "$DATA_HASH_BEFORE" ]]; then
    fail rollback-data
    return 1
  fi
  return 0
}

rollback() {
  local path
  local existed
  if (( ROLLBACK_RUNNING )); then
    fail rollback-reentry
    return 1
  fi
  if (( ROLLBACK_COMPLETE )); then
    if ! verify_rollback_state; then
      return 1
    fi
    log "rollback phase: already complete"
    return 0
  fi
  ROLLBACK_RUNNING=1
  log "rollback phase: start backup=$BACKUP_DIR"
  if [[ ! -d "$BACKUP_DIR" ]]; then
    fail rollback-backup-missing
    ROLLBACK_RUNNING=0
    ROLLBACK_COMPLETE=0
    return 1
  fi
  if (( RUNTIME_ACTIVATED )); then
    while IFS=$'\t' read -r path existed _ _; do
    if [[ "$existed" == true ]]; then
      mkdir -p "$PROD/$(dirname -- "$path")"
      if ! install_application_file "$BACKUP_DIR/runtime/$path" "$path"; then
        ROLLBACK_RUNNING=0
        ROLLBACK_COMPLETE=0
        return 1
      fi
      log "rollback runtime restored: $path"
    else
      if ! rm -f -- "$PROD/$path"; then
        fail "rollback introduced runtime removal failed: $path"
        ROLLBACK_RUNNING=0
        ROLLBACK_COMPLETE=0
        return 1
      fi
      log "rollback introduced runtime removed: $path"
    fi
    done <"$BACKUP_DIR/runtime-manifest.tsv"
  fi
  if (( MANIFESTS_ACTIVATED )); then
    if ! install_application_file "$BACKUP_DIR/package.json" package.json; then
      ROLLBACK_RUNNING=0
      ROLLBACK_COMPLETE=0
      return 1
    fi
    if ! install_application_file "$BACKUP_DIR/package-lock.json" package-lock.json; then
      ROLLBACK_RUNNING=0
      ROLLBACK_COMPLETE=0
      return 1
    fi
  fi
  if ! rollback_dependencies; then
    ROLLBACK_RUNNING=0
    ROLLBACK_COMPLETE=0
    return 1
  fi
  if (( SYSTEMD_UNIT_ACTIVATED )); then
    if ! restore_systemd_unit; then
      ROLLBACK_RUNNING=0
      ROLLBACK_COMPLETE=0
      return 1
    fi
    if ! systemd_daemon_reload; then
      ROLLBACK_RUNNING=0
      ROLLBACK_COMPLETE=0
      return 1
    fi
    DAEMON_RELOADED=1
    if ! systemd_restart_service; then
      ROLLBACK_RUNNING=0
      ROLLBACK_COMPLETE=0
      return 1
    fi
    SERVICE_RESTARTED=1
    if [[ "$UNIT_PATH" == /etc/systemd/system/* ]]; then
      if ! wait_ready 2.3.0; then
        ROLLBACK_RUNNING=0
        ROLLBACK_COMPLETE=0
        return 1
      fi
    fi
  fi
  if ! verify_rollback_state; then
    ROLLBACK_RUNNING=0
    ROLLBACK_COMPLETE=0
    return 1
  fi
  ROLLBACK_COMPLETE=1
  ROLLBACK_RUNNING=0
  log "rollback phase: complete"
  return 0
}

transaction_deploy() {
  TRANSACTION_COMPLETED=0
  [[ "${CROSSINGKEY_ALLOW_DEPLOY:-}" == "EXPLICIT_CURRENT_APPROVAL_REQUIRED" ]] || { fail deployment-authorization-gate-closed; return 1; }
  TRANSACTION_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  LOG_FILE="$REPORT_DIR/deploy-$TRANSACTION_ID.log"
  mkdir -p "$REPORT_DIR" || return 1
  : >"$LOG_FILE" || return 1
  [[ -f "$LOG_FILE" && -w "$LOG_FILE" ]] || { fail deploy-log-create-failed; return 1; }
  log "transaction phase: start id=$TRANSACTION_ID"
  if [[ -n "${CROSSINGKEY_TEST_PID_FILE:-}" ]]; then
    printf '%s\n' "$$" >"$CROSSINGKEY_TEST_PID_FILE" || return 1
  fi
  if [[ "${CROSSINGKEY_TEST_HOLD:-0}" == 1 ]]; then
    while :; do
      :
    done
  fi
  candidate_gate || return 1
  manifest_gate || return 1
  prepared_gate || return 1
  state_gate || return 1
  execution_identity_gate || return 1
  mkdir -p "$BACKUP_ROOT" || return 1
  ownership_invariant_gate || return 1
  filesystem_permission_gate || return 1
  privilege_preflight || return 1
  BACKUP_DIR="$BACKUP_ROOT/$TRANSACTION_ID"
  mkdir -p "$BACKUP_DIR" || return 1
  create_backup "$BACKUP_DIR" || return 1
  stage_release "$BACKUP_DIR" || return 1
  candidate_boot_gate || return 1
  # Final host-attestation TOCTOU barrier: candidate boot may not be promoted
  # unless the same retained host tree still matches a fresh recomputation.
  operator_host_artifact_gate || return 1
  MUTATION_STARTED=1
  for path in "${runtime_files[@]}"; do
    install_application_file "$BACKUP_DIR/candidate/$path" "$path" || return 1
    RUNTIME_ACTIVATED=1
  done
  install_application_file "$BACKUP_DIR/candidate/package.json" package.json || return 1
  MANIFESTS_ACTIVATED=1
  install_application_file "$BACKUP_DIR/candidate/package-lock.json" package-lock.json || return 1
  activate_dependencies || return 1
  activate_unit || return 1
  log "mutation boundary: service restart: start"
  systemd_restart_service || return 1
  log "mutation boundary: service restart: complete"
  SERVICE_RESTARTED=1
  verify_release || return 1
  log "transaction phase: PASS; retain $PROD/.node_modules.v23.$TRANSACTION_ID pending operator cleanup decision"
  TRANSACTION_COMPLETED=1
  return 0
}

dry_run() {
  DRY_RUN_MODE=1
  candidate_gate || return 1
  manifest_gate || return 1
  prepared_gate || return 1
  state_gate || return 1
  log "dry-run gates: candidate, prepared release, imports, topology, state hashes: PASS evidence_source=$EVIDENCE_SOURCE"
  log "dry-run policy: receiver-only, agentSpendAuthority=false, operatorReleaseCostUSD=0"
  log "dry-run mutations: NONE"
  printf '%s\n' READY_FOR_OPERATOR_DEPLOY_REVIEW
}

on_error() {
  local transaction_status=$?
  local rollback_status=0
  trap - ERR
  if (( ERROR_REPORTED )); then
    exit "$transaction_status"
  fi
  ERROR_REPORTED=1
  if (( MUTATION_STARTED )) && (( ! ROLLBACK_RUNNING )) && (( ! ROLLBACK_ATTEMPTED )) && (( ! ROLLBACK_COMPLETE )); then
    ROLLBACK_ATTEMPTED=1
    if rollback; then
      rollback_status=0
    else
      rollback_status=$?
    fi
  fi
  if (( rollback_status != 0 )); then
    log "ROLLBACK_INCOMPLETE - MANUAL INTERVENTION REQUIRED"
    log "transaction phase: FAILED original_exit=$transaction_status rollback_exit=$rollback_status"
    exit "$ROLLBACK_FAILURE_EXIT"
  fi
  if (( transaction_status == 2 )); then
    transaction_status=1
  fi
  if (( MUTATION_STARTED )); then
    log "rollback phase: verified"
  fi
  log "transaction phase: FAILED original_exit=$transaction_status"
  exit "$transaction_status"
}

on_dry_run_error() {
  local status=$?
  trap - ERR
  if (( ERROR_REPORTED )); then
    exit 1
  fi
  ERROR_REPORTED=1
  log "dry-run phase: FAILED exit=1"
  exit 1
}

on_signal() {
  local signal="$1"
  local status="$2"
  trap - ERR INT TERM HUP
  if (( SIGNAL_REPORTED == 0 )); then
    SIGNAL_REPORTED=1
    log "transaction phase: SIGNAL signal=$signal exit=$status"
  fi
  exit "$status"
}

main() {
  case "${1:-}" in
    --dry-run)
      LOG_FILE="$REPORT_DIR/dry-run.log"
      mkdir -p "$REPORT_DIR"
      dry_run
      ;;
    --deploy)
      transaction_deploy
      local transaction_rc=$?
      if (( transaction_rc == 0 && TRANSACTION_COMPLETED != 1 )); then
        fail 'deploy exited without completed transaction'
        return 1
      fi
      return "$transaction_rc"
      ;;
    *)
      echo 'usage: --dry-run | --deploy' >&2
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" && "${CROSSINGKEY_DEPLOY_LIB_ONLY:-0}" == 1 ]]; then
  printf '%s\n' 'FAIL: CROSSINGKEY_DEPLOY_LIB_ONLY invalid during direct controller execution' >&2
  exit 1
fi

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  : # Sourced library mode: load functions and never dispatch CLI arguments.
elif [[ "${CROSSINGKEY_DEPLOY_LIB_ONLY:-0}" != 1 ]]; then
  case "${1:-}" in
    --dry-run)
      trap on_dry_run_error ERR
      main "$@"
      ;;
    --deploy)
      trap on_error ERR
      trap 'on_signal INT 130' INT
      trap 'on_signal TERM 143' TERM
      trap 'on_signal HUP 129' HUP
      main "$@"
      ;;
    *)
      printf '%s\n' 'usage: --dry-run | --deploy' >&2
      exit 2
      ;;
  esac
fi
