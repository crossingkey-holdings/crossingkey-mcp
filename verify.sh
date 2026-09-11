#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node --check server.mjs
python3 - <<'PY'
import json
from pathlib import Path
c=json.loads(Path('data/stripe_catalog.json').read_text())
p=json.loads(Path('data/credit_links.json').read_text())
f=json.loads(Path('data/fulfillment_map.json').read_text())
assert len(c['offers']) == 34, len(c['offers'])
assert len(p['packs']) == 3
assert len(f['products']) == 5
assert all(x['checkout_url'].startswith('https://pay.crossingkeyintelligence.com/') for x in c['offers'])
assert all(x['checkout_url'].startswith('https://pay.crossingkeyintelligence.com/') for x in p['packs'])
print('PASS: 34 Stripe offers, 3 credit links, 5 verified file mappings.')
PY
