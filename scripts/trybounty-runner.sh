#!/usr/bin/env bash
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV="$SRC/.secrets/trybounty.env"

cd "$SRC"

test -f "$ENV"

set -a
# shellcheck disable=SC1090
source "$ENV"
set +a

export TRYBOUNTY_POLL_MS=30000

exec /usr/bin/env node \
    "$SRC/scripts/trybounty-worker.mjs"
