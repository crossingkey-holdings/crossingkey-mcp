#!/usr/bin/env bash
set -Eeuo pipefail
# Only disposable PostgreSQL: env vars must refer to CI's ephemeral DB.
if [[ "$PGDATABASE" != "ck_phase1c" ]]; then
  echo "Refusing concurrency fixture outside ephemeral CI database" >&2
  exit 2
fi
sql_a="select public.dock_fulfill_stripe_event('evt_parallel_a','checkout.session.completed',true,'plink_fixture','cs_parallel','pi_parallel',null,500,'usd','hash',null);"
sql_b="select public.dock_fulfill_stripe_event('evt_parallel_b','checkout.session.completed',true,'plink_fixture','cs_parallel','pi_parallel',null,500,'usd','hash',null);"
psql -X -v ON_ERROR_STOP=1 -qAt -c "$sql_a" >/tmp/ck-a.out &
a=$!
psql -X -v ON_ERROR_STOP=1 -qAt -c "$sql_b" >/tmp/ck-b.out &
b=$!
wait "$a"
wait "$b"
count="$(psql -X -v ON_ERROR_STOP=1 -qAt -c "select count(*) from public.dock_entitlements where stripe_checkout_session_id='cs_parallel';")"
if [[ "$count" != "1" ]]; then
 echo "FAIL: expected exactly one entitlement for concurrent deliveries, got $count" >&2
 exit 1
fi
echo "PASS: real PostgreSQL concurrent deliveries for same checkout granted exactly one entitlement"
