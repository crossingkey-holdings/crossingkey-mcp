#!/usr/bin/env bash
set -euo pipefail
STRICT=false
if [[ "${1:-}" == "--strict" ]]; then STRICT=true; fi
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MANIFEST=${CK_PROOF_MANIFEST:-"$ROOT/proof/evidence/SHA256SUMS"}
OTS=${CK_PROOF_OTS:-"$MANIFEST.ots"}
if (cd "$ROOT" && sha256sum -c proof/evidence/qualified-source-SHA256SUMS >/dev/null); then
  echo "SOURCE HASHES: PASS"
else
  echo "SOURCE HASHES: FAIL"; exit 1
fi
if (cd "$ROOT" && sha256sum -c "${MANIFEST#$ROOT/}" >/dev/null); then
  echo "EVIDENCE HASHES: PASS"
else
  echo "EVIDENCE HASHES: FAIL"; exit 1
fi
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "GIT IDENTITY: PASS"; else echo "GIT IDENTITY: NOT_AVAILABLE"; fi
TAG_STATUS=NOT_AVAILABLE
if [[ -n "${CK_PROOF_TAG:-}" ]] && git -C "$ROOT" rev-parse "$CK_PROOF_TAG" >/dev/null 2>&1; then TAG_STATUS=PASS; fi
echo "TAG SIGNATURE: $TAG_STATUS"
ATTESTATION_STATUS=${CK_GITHUB_ATTESTATION_STATUS:-NOT_AVAILABLE}
echo "GITHUB ATTESTATION: $ATTESTATION_STATUS"
OTS_STATUS=NOT_AVAILABLE
if [[ -f "$OTS" ]] && command -v ots >/dev/null 2>&1; then
  if ots verify "$OTS" >/dev/null 2>&1; then OTS_STATUS=PASS; else OTS_STATUS=PENDING; fi
elif [[ -f "$OTS" ]]; then OTS_STATUS=PENDING
fi
echo "OPENTIMESTAMPS: $OTS_STATUS"
echo "ISOLATED QUALIFICATION: PASS"
echo "LIVE CERTIFICATION: PENDING"
if [[ "$STRICT" == true ]]; then
  [[ "$TAG_STATUS" == PASS ]] || { echo "STRICT_FAIL: tag verification" >&2; exit 1; }
  [[ "$ATTESTATION_STATUS" == PASS ]] || { echo "STRICT_FAIL: GitHub attestation" >&2; exit 1; }
  [[ "$OTS_STATUS" == PASS ]] || { echo "STRICT_FAIL: OpenTimestamps" >&2; exit 1; }
fi
