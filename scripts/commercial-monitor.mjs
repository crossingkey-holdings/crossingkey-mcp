#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const command = process.argv[2] || 'status';
const dbPath = path.resolve(
  process.env.CK_FUNNEL_DB || process.argv[3] || 'data/commerce_funnel.sqlite3'
);
const allowed = new Set([
  'status',
  'funnel',
  'recent-failures',
  'unconverted',
  'facilitator-errors'
]);

if (!allowed.has(command)) {
  console.error('Usage: commercial-monitor.mjs status|funnel|recent-failures|unconverted|facilitator-errors [database]');
  process.exit(2);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Monitoring database not found: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });

function rows(sql, ...params) {
  return db.prepare(sql).all(...params);
}

function snapshot() {
  const row = db.prepare(
    'SELECT updated_at, state_json FROM funnel_snapshots WHERE id=1'
  ).get();
  return row ? { updated_at: row.updated_at, ...JSON.parse(row.state_json) } : null;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

try {
  if (command === 'status') {
    const stat = fs.statSync(dbPath);
    const recent = db.prepare(`
      SELECT timestamp, classification, final_http_status, synthetic
      FROM payment_attempts ORDER BY id DESC LIMIT 1
    `).get() || null;
    print({
      database: dbPath,
      permissions: (stat.mode & 0o777).toString(8).padStart(3, '0'),
      bytes: stat.size,
      snapshot_updated_at: snapshot()?.updated_at || null,
      attempt_rows: db.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get().count,
      actionable_rows: db.prepare('SELECT COUNT(*) AS count FROM payment_attempts WHERE actionable=1').get().count,
      latest_attempt: recent
    });
  }

  if (command === 'funnel') {
    const state = snapshot();
    print({
      updated_at: state?.updated_at || null,
      commercial: state?.commercial || {},
      failures: state?.failure_categories || {},
      revenue: state?.revenue || {},
      observable_stages: {
        discovery: 'OBSERVABLE',
        paid_capability_inquiry: 'OBSERVABLE',
        challenge_issued: 'OBSERVABLE',
        payment_proof_submitted: 'OBSERVABLE',
        verification: 'OBSERVABLE',
        settlement: 'OBSERVABLE',
        receipt: 'OBSERVABLE',
        entitlement: 'OBSERVABLE',
        paid_execution: 'OBSERVABLE',
        external_buyer_intent: 'NOT_OBSERVABLE',
        buyer_abandonment: 'NOT_OBSERVABLE',
        agent_activity_outside_crossingkey: 'NOT_OBSERVABLE'
      }
    });
  }

  if (command === 'recent-failures') {
    print(rows(`
      SELECT timestamp, request_id, capability, public_route, transport,
             synthetic, payment_proof_submitted, verification_outcome,
             settlement_outcome, receipt_creation_outcome,
             entitlement_creation_outcome, final_http_status, latency_ms,
             classification, safe_reference, application_version
      FROM payment_attempts
      WHERE actionable=1
      ORDER BY id DESC LIMIT 50
    `));
  }

  if (command === 'unconverted') {
    print(rows(`
      SELECT capability, synthetic, COUNT(*) AS challenges,
             MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen
      FROM payment_attempts
      WHERE commercial_state='UNCONVERTED_CHALLENGE'
      GROUP BY capability, synthetic
      ORDER BY challenges DESC, capability
    `));
  }

  if (command === 'facilitator-errors') {
    print(rows(`
      SELECT timestamp, request_id, capability, public_route, transport,
             synthetic, verification_outcome, settlement_outcome,
             final_http_status, latency_ms, classification, application_version
      FROM payment_attempts
      WHERE classification='FACILITATOR_FAILURE'
      ORDER BY id DESC LIMIT 50
    `));
  }
} finally {
  db.close();
}
