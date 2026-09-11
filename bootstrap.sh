#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
if [[ ! -f .env ]]; then
  cp .env.example .env
  secret="$(openssl rand -hex 32)"
  python3 - "$secret" <<'PY'
from pathlib import Path
import sys
p=Path(".env")
s=p.read_text().replace("REPLACE_WITH_RANDOM_64_HEX_CHARS",sys.argv[1])
p.write_text(s)
PY
  chmod 600 .env
  echo "Created .env with a random CLAIM_SECRET."
  echo "Edit only STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET when ready."
fi
npm install
npm run check
echo
echo "Start with:"
echo "  set -a; source .env; set +a; npm start"
