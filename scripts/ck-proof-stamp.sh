#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MANIFEST=${CK_PROOF_MANIFEST:-"$ROOT/proof/evidence/SHA256SUMS"}
OTS=${CK_PROOF_OTS:-"$MANIFEST.ots"}
[[ -f "$MANIFEST" ]] || { echo "MANIFEST_MISSING: $MANIFEST" >&2; exit 1; }
(cd "$ROOT" && sha256sum -c "${MANIFEST#$ROOT/}")
SUBJECT_SHA=$(sha256sum "$MANIFEST" | awk '{print $1}')
echo "SUBJECT_SHA256=$SUBJECT_SHA"
echo "SUBJECT=$MANIFEST"
if [[ -f "$OTS" ]]; then
  echo "OTS_PROOF=$OTS"
  if command -v ots >/dev/null 2>&1 && ots verify "$OTS" >/dev/null 2>&1; then
    echo "OTS_STATUS=VERIFIED_EXISTING"
  else
    echo "OTS_STATUS=PENDING_OR_UNVERIFIED_EXISTING"
  fi
  exit 0
fi
if ! command -v ots >/dev/null 2>&1; then
  echo "OTS_STATUS=NOT_AVAILABLE"
  echo "STAMP_SUBMITTED=false"
  exit 0
fi
ots stamp "$MANIFEST"
echo "OTS_PROOF=$OTS"
echo "OTS_STATUS=STAMP_SUBMITTED"
echo "STAMP_SUBMITTED=true"
echo "BITCOIN_VERIFIED=false"
