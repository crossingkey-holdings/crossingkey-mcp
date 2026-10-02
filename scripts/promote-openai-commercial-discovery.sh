#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

EXPECTED_COMMIT="$(git rev-parse HEAD)"
EXPECTED_SERVICE='crossingkey-revenue-mcp.service'
EXPECTED_WORKDIR='/home/founder/Downloads/crossingkey_developer_revenue_app'
EXPECTED_PUBLIC_MCP='https://mcp.crossingkeyintelligence.com/mcp'
EXPECTED_PUBLIC_HEALTH='https://mcp.crossingkeyintelligence.com/health'
REPO_ROOT=$(git rev-parse --show-toplevel)
BACKUP_ROOT="$EXPECTED_WORKDIR/.promotion-backups"
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR="$BACKUP_ROOT/openai-commercial-discovery-$RUN_ID"
STAGE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/crossingkey-promote.XXXXXX")
CERT_JSON=''
PROMOTED_FILES=()
ROLLING_BACK=0

cleanup(){ rm -rf -- "$STAGE_DIR"; [[ -z "$CERT_JSON" ]] || rm -f -- "$CERT_JSON"; }
rollback(){
  local status=${1:?rollback status is required}
  if (( status == 0 || ROLLING_BACK == 1 )); then return "$status"; fi
  if (( ${#PROMOTED_FILES[@]} == 0 )); then return "$status"; fi
  ROLLING_BACK=1
  echo 'PROMOTION_ROLLBACK_START' >&2
  set +e
  local rollback_status=0
  for rel in "${PROMOTED_FILES[@]}"; do
    destination="$EXPECTED_WORKDIR/$rel"
    if [[ "${DEST_STATE[$rel]}" == 'EXISTING' ]]; then
      cp -a -- "$BACKUP_DIR/$rel" "$destination"
      (( $? == 0 )) || rollback_status=1
    elif [[ "${DEST_STATE[$rel]}" == 'ABSENT' ]]; then
      rm -f -- "$destination"
      (( $? == 0 )) || rollback_status=1
      parent="$(dirname "$destination")"
      if [[ "${PARENT_CREATED[$rel]:-0}" == '1' && -d "$parent" ]] && [[ -z "$(find "$parent" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
        rmdir -- "$parent"
        (( $? == 0 )) || rollback_status=1
      fi
    fi
  done
  systemctl restart "$EXPECTED_SERVICE"
  (( $? == 0 )) || rollback_status=1
  systemctl is-active --quiet "$EXPECTED_SERVICE"
  (( $? == 0 )) || rollback_status=1
  curl --fail --silent --show-error --max-time 15 "$EXPECTED_PUBLIC_HEALTH" >/dev/null
  (( $? == 0 )) || rollback_status=1
  if (( rollback_status == 0 )); then
    echo 'PROMOTION_ROLLED_BACK' >&2
  else
    echo 'PROMOTION_BLOCKED: rollback verification failed' >&2
  fi
  return "$rollback_status"
}
trap cleanup EXIT
on_error(){
  local status=$?
  if (( status == 0 )); then exit 0; fi
  if (( ${#PROMOTED_FILES[@]} == 0 )); then
    echo 'PROMOTION_BLOCKED' >&2
    exit "$status"
  fi
  rollback "$status"
  local rollback_status=$?
  if (( rollback_status != 0 )); then exit "$rollback_status"; fi
  exit "$status"
}
trap on_error ERR

die(){ echo "PROMOTION_ERROR: $*" >&2; return 1; }

[[ "$(git rev-parse HEAD)" == "$EXPECTED_COMMIT" ]] || die "HEAD is not the required candidate commit"
[[ "$(git branch --show-current)" == 'fix/crossingkey-openai-agent-commercial-discovery' ]] || die 'unexpected candidate branch'
[[ "$(git status --porcelain)" != *'server.mjs'* ]] || die 'dirty server.mjs would make promotion ambiguous'
[[ "$(git status --porcelain)" != *'lib/mcp-manifest.mjs'* ]] || die 'dirty manifest would make promotion ambiguous'

service_workdir=$(systemctl show "$EXPECTED_SERVICE" --value --property=WorkingDirectory)
service_exec=$(systemctl show "$EXPECTED_SERVICE" --value --property=ExecStart)
[[ "$service_workdir" == "$EXPECTED_WORKDIR" ]] || die "service working directory mismatch: $service_workdir"
[[ "$service_exec" == *'/usr/bin/node /home/founder/Downloads/crossingkey_developer_revenue_app/server.mjs'* ]] || die 'service ExecStart mismatch'
[[ "$(systemctl show "$EXPECTED_SERVICE" --value --property=User)" == 'founder' ]] || die 'service user mismatch'

RUNTIME_FILES=(server.mjs lib/mcp-manifest.mjs server.json)
REQUIRED_EXISTING_FILES=(server.mjs server.json)
EXPECTED_NEW_FILES=(lib/mcp-manifest.mjs)
declare -A DEST_STATE DEST_MODE DEST_UID DEST_GID PARENT_CREATED

is_expected_new_file(){
  local candidate
  for candidate in "${EXPECTED_NEW_FILES[@]}"; do
    [[ "$candidate" == "$1" ]] && return 0
  done
  return 1
}

for rel in "${REQUIRED_EXISTING_FILES[@]}"; do
  [[ -f "$EXPECTED_WORKDIR/$rel" ]] || die "production file missing: $rel"
done

for rel in "${RUNTIME_FILES[@]}"; do
  git cat-file -e "$EXPECTED_COMMIT:$rel"
  mkdir -p "$STAGE_DIR/$(dirname "$rel")"
  git show "$EXPECTED_COMMIT:$rel" > "$STAGE_DIR/$rel"
done
expected_server_hash="$(git show "$EXPECTED_COMMIT:server.mjs" | sha256sum | awk '{print $1}')"
expected_manifest_hash="$(git show "$EXPECTED_COMMIT:lib/mcp-manifest.mjs" | sha256sum | awk '{print $1}')"
[[ "$(sha256sum "$STAGE_DIR/server.mjs" | awk '{print $1}')" == "$expected_server_hash" ]] || die 'candidate server hash mismatch'
[[ "$(sha256sum "$STAGE_DIR/lib/mcp-manifest.mjs" | awk '{print $1}')" == "$expected_manifest_hash" ]] || die 'candidate manifest hash mismatch'
/usr/bin/node --check "$STAGE_DIR/server.mjs"
/usr/bin/node --check "$STAGE_DIR/lib/mcp-manifest.mjs"
/usr/bin/node --input-type=module -e "import fs from 'node:fs'; const x=await import(process.argv[1]); if(x.MCP_RELEASE_VERSION!=='3.0.0'||x.MCP_PROTOCOL_VERSION!=='2025-11-25'||x.FREE_DISCOVERY_TOOL_NAMES.length!==6||x.PAID_TOOL_NAMES.length!==6) process.exit(1); if(!fs.readFileSync(process.argv[2],'utf8').includes('MCP_SERVER_INSTRUCTIONS')) process.exit(1);" "$STAGE_DIR/lib/mcp-manifest.mjs" "$STAGE_DIR/server.mjs"

mkdir -p "$BACKUP_DIR"
for rel in "${RUNTIME_FILES[@]}"; do
  destination="$EXPECTED_WORKDIR/$rel"
  if [[ -e "$destination" || -L "$destination" ]]; then
    [[ -f "$destination" ]] || die "production destination is not a regular file: $rel"
    DEST_STATE["$rel"]='EXISTING'
    DEST_MODE["$rel"]="$(stat -c '%a' "$destination")"
    DEST_UID["$rel"]="$(stat -c '%u' "$destination")"
    DEST_GID["$rel"]="$(stat -c '%g' "$destination")"
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -a -- "$destination" "$BACKUP_DIR/$rel"
  elif is_expected_new_file "$rel"; then
    DEST_STATE["$rel"]='ABSENT'
    DEST_MODE["$rel"]="$(stat -c '%a' "$EXPECTED_WORKDIR/server.mjs")"
    DEST_UID["$rel"]="$(stat -c '%u' "$EXPECTED_WORKDIR/server.mjs")"
    DEST_GID["$rel"]="$(stat -c '%g' "$EXPECTED_WORKDIR/server.mjs")"
  else
    die "production file missing: $rel"
  fi
done
printf '%s\n' "$EXPECTED_COMMIT" > "$BACKUP_DIR/CANDIDATE_COMMIT"
printf '%s\n' "${RUNTIME_FILES[@]}" > "$BACKUP_DIR/FILES"
for rel in "${RUNTIME_FILES[@]}"; do
  printf '%s\t%s\n' "$rel" "${DEST_STATE[$rel]}"
done > "$BACKUP_DIR/DESTINATION_STATE"

for rel in "${RUNTIME_FILES[@]}"; do
  destination="$EXPECTED_WORKDIR/$rel"
  parent="$(dirname "$destination")"
  if [[ ! -d "$parent" ]]; then
    is_expected_new_file "$rel" || die "production parent directory missing: $rel"
    mkdir -p "$parent"
    PARENT_CREATED["$rel"]=1
  else
    PARENT_CREATED["$rel"]=0
  fi
  PROMOTED_FILES+=("$rel")
  install -o "${DEST_UID[$rel]}" -g "${DEST_GID[$rel]}" -m "${DEST_MODE[$rel]}" "$STAGE_DIR/$rel" "$destination"
done

systemctl restart "$EXPECTED_SERVICE"
for _ in {1..30}; do systemctl is-active --quiet "$EXPECTED_SERVICE" && break; sleep 1; done
systemctl is-active --quiet "$EXPECTED_SERVICE"
[[ "$(systemctl show "$EXPECTED_SERVICE" --value --property=SubState)" == 'running' ]] || die 'service is not running'
local_health_ok=0
for _ in {1..30}; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3000/health >/dev/null; then
    local_health_ok=1
    break
  fi
  sleep 1
done
[[ "$local_health_ok" == '1' ]] || die 'local health did not become ready'
curl --fail --silent --show-error --max-time 15 "$EXPECTED_PUBLIC_HEALTH" >/dev/null
curl --fail --silent --show-error --max-time 15 "$EXPECTED_PUBLIC_HEALTH" >/dev/null

CERT_JSON=$(mktemp "${TMPDIR:-/tmp}/crossingkey-cert.XXXXXX.json")
/usr/bin/node "$REPO_ROOT/scripts/certify-public-mcp.mjs" > "$CERT_JSON"
[[ -s "$CERT_JSON" ]] || die 'public certification returned empty output'
/usr/bin/node --input-type=module -e "import fs from 'node:fs'; const x=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(x.status!=='PASS'||x.stopState!=='STOPPED_BEFORE_PAYMENT'||x.tools.count!==12||x.zeroSpend.paidToolCalls!==0||x.zeroSpend.paymentHeadersSubmitted!==0||x.zeroSpend.paymentSignaturesSubmitted!==0||x.zeroSpend.creditsConsumed!==0||x.zeroSpend.facilitatorCalls!==0||x.zeroSpend.entitlementsCreated!==0||x.zeroSpend.receiptsCreated!==0||x.zeroSpend.paidExecutions!==0) process.exit(1);" "$CERT_JSON"
echo 'PROMOTION_PASS'
echo "BACKUP_DIR=$BACKUP_DIR"
echo "CANDIDATE_COMMIT=$EXPECTED_COMMIT"
