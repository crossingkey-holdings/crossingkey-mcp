import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createMachineCommerce, RECEIVER } from '../lib/machine-commerce.mjs';
import { createProductionGate1B } from '../lib/gate1b-production-adapter.mjs';

async function unusedPort() {
  return await new Promise(resolve => {
    const server = http.createServer().listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('monitoring fixture did not become healthy');
}

test('privacy-safe commercial telemetry separates unpaid challenges from actionable failures', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-commercial-monitor-'));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const dbFile = path.join(dir, 'funnel.sqlite3');
  const commerceFile = path.join(dir, 'commerce.json');
  const marker = 'DO_NOT_PERSIST_PAYMENT_PROOF_MARKER';
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT:String(port),
      PUBLIC_BASE_URL:base,
      CK_ENABLE_MAINNET:'true',
      CK_FUNNEL_DB:dbFile,
      MACHINE_COMMERCE_FILE:commerceFile,
      MARKETPLACE_FILE:path.join(dir, 'marketplace.json'),
      CK_KENNEKARTE_HMAC_SECRET:'local-only-test-secret'.repeat(4),
      CLAIM_SECRET:'local-only-test-secret'.repeat(4),
      STRIPE_SECRET_KEY:'',
      STRIPE_WEBHOOK_SECRET:'',
      X402_FACILITATOR_URL:`${base}/must-not-be-called`
    },
    stdio:'ignore'
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    fs.rmSync(dir, {recursive:true, force:true});
  });
  await waitForHealth(base);

  const unpaid = await fetch(`${base}/api/x402/hash.encode`, {
    method:'POST',
    headers:{'content-type':'application/json', 'x-crossingkey-synthetic':'1'},
    body:JSON.stringify({input:{text:'safe fixture'}})
  });
  assert.equal(unpaid.status, 402);
  const requestId = unpaid.headers.get('x-crossingkey-request-id');
  assert.ok(requestId);

  const malformed = await fetch(`${base}/api/x402/hash.encode`, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-crossingkey-synthetic':'1',
      'payment-signature':Buffer.from(JSON.stringify({marker})).toString('base64')
    },
    body:JSON.stringify({idempotency_key:'monitor-invalid-001', input:{text:'safe fixture'}})
  });
  assert.equal(malformed.status, 400);

  const invalidInput = await fetch(`${base}/api/x402/hash.encode`, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'x-crossingkey-synthetic':'1',
      'payment-signature':Buffer.from(JSON.stringify({marker})).toString('base64')
    },
    body:JSON.stringify({idempotency_key:'monitor-invalid-002', input:{text:42}})
  });
  assert.equal(invalidInput.status, 400);
  await new Promise(resolve => setTimeout(resolve, 350));

  const db = new DatabaseSync(dbFile, {readOnly:true});
  const rows = db.prepare(`
    SELECT request_id, synthetic, challenge_issued, payment_proof_submitted,
           classification, commercial_state, actionable
    FROM payment_attempts ORDER BY id
  `).all();
  db.close();
  assert.equal(rows.length, 3);
  assert.deepEqual({...rows[0]}, {
    request_id:requestId,
    synthetic:1,
    challenge_issued:1,
    payment_proof_submitted:0,
    classification:'EXPECTED_UNPAID_402',
    commercial_state:'UNCONVERTED_CHALLENGE',
    actionable:0
  });
  assert.equal(rows[1].classification, 'INVALID_PAYMENT_PROOF');
  assert.equal(rows[1].actionable, 1);
  assert.equal(rows[1].payment_proof_submitted, 1);
  assert.equal(rows[2].classification, 'MALFORMED_REQUEST');
  assert.equal(rows[2].actionable, 0);
  const dbBytes = Buffer.concat(
    [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]
      .filter(file => fs.existsSync(file))
      .map(file => fs.readFileSync(file))
  ).toString('utf8');
  assert.equal(dbBytes.includes(marker), false, 'raw payment proof material must not enter monitoring storage');
  assert.equal(fs.existsSync(commerceFile), false, 'nonpaying monitoring must not mutate payment state');
  assert.equal((fs.statSync(dbFile).mode & 0o777).toString(8), '600');

  for (const command of ['status', 'funnel', 'recent-failures', 'unconverted']) {
    const report = spawnSync(
      process.execPath,
      ['scripts/commercial-monitor.mjs', command, dbFile],
      {cwd:process.cwd(), encoding:'utf8', timeout:10_000}
    );
    assert.equal(report.status, 0, report.stderr || report.stdout);
    assert.doesNotThrow(() => JSON.parse(report.stdout));
  }

  const synthetic = spawnSync(
    process.execPath,
    ['scripts/synthetic-commercial-monitor.mjs', base],
    {cwd:process.cwd(), encoding:'utf8', timeout:30_000}
  );
  assert.equal(synthetic.status, 0, synthetic.stderr || synthetic.stdout);
  const syntheticResult = JSON.parse(synthetic.stdout);
  assert.equal(syntheticResult.ok, true);
  assert.equal(syntheticResult.payment_proof_submitted, false);
  assert.equal(syntheticResult.live_settlement_attempted, false);
  assert.equal(syntheticResult.checks.find(check => check.name === 'mcp_tool_count')?.detail, 28);
  assert.equal(fs.existsSync(commerceFile), false, 'synthetic monitor must not mutate payment state');
});

function paymentFixture(core, nonce) {
  const challenge = JSON.parse(Buffer.from(
    core.paymentRequired('artifact.integrity_manifest', 2).headers['PAYMENT-REQUIRED'],
    'base64'
  ).toString('utf8'));
  return {
    x402Version:2,
    accepted:challenge.accepts[0],
    payload:{
      signature:'mock-only-signature',
      authorization:{
        from:'0x1111111111111111111111111111111111111111',
        to:RECEIVER,
        value:'100000',
        validAfter:'1',
        validBefore:'999999',
        nonce
      }
    }
  };
}

function rpcResponse(init) {
  const request = JSON.parse(init.body || '{}');
  return new Response(JSON.stringify({
    jsonrpc:'2.0',
    id:1,
    result:request.method === 'eth_chainId' ? '0x2105' : '0x100'
  }));
}

test('mocked payment lifecycle emits correlated verification, settlement, receipt, and entitlement stages', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-monitor-lifecycle-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const events = [];
  const core = createMachineCommerce({
    dataFile:path.join(dir, 'commerce.json'),
    receiver:RECEIVER,
    network:'eip155:8453',
    mainnetEnabled:true,
    rpcUrl:'https://rpc.test',
    publicBaseUrl:'https://mcp.test',
    facilitatorUrl:'https://fac.test',
    kennekarteSecret:'k'.repeat(64),
    onPaymentLifecycleEvent:event => events.push(event),
    fetchImpl:async (url, init) => {
      if (String(url) === 'https://rpc.test') return rpcResponse(init);
      if (String(url).endsWith('/verify')) return new Response(JSON.stringify({isValid:true}));
      return new Response(JSON.stringify({success:true, transaction:`0x${'a'.repeat(64)}`}));
    }
  });
  await core.invoke({
    capabilityName:'artifact.integrity_manifest',
    input:{artifacts:[{name:'a', content:'b'}]},
    idempotencyKey:'monitor-success-001',
    paymentPayload:paymentFixture(core, `0x${'1'.repeat(64)}`),
    telemetryContext:{requestId:'correlation-success', route:'/api/x402/artifact.integrity_manifest', synthetic:true}
  });
  assert.deepEqual(events.map(event => event.stage), [
    'VERIFICATION_ATTEMPTED',
    'VERIFICATION_SUCCEEDED',
    'SETTLEMENT_ATTEMPTED',
    'SETTLEMENT_SUCCEEDED',
    'FINALIZATION_ATTEMPTED',
    'FINALIZATION_SUCCEEDED'
  ]);
  assert.ok(events.every(event => event.telemetryContext?.requestId === 'correlation-success'));
  assert.equal(JSON.stringify(events).includes('mock-only-signature'), false);
});

test('mocked facilitator settlement failure is observable without spending funds', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-monitor-settlement-failure-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const events = [];
  const core = createMachineCommerce({
    dataFile:path.join(dir, 'commerce.json'),
    receiver:RECEIVER,
    network:'eip155:8453',
    mainnetEnabled:true,
    rpcUrl:'https://rpc.test',
    publicBaseUrl:'https://mcp.test',
    facilitatorUrl:'https://fac.test',
    kennekarteSecret:'k'.repeat(64),
    onPaymentLifecycleEvent:event => events.push(event),
    fetchImpl:async (url, init) => {
      if (String(url) === 'https://rpc.test') return rpcResponse(init);
      if (String(url).endsWith('/verify')) return new Response(JSON.stringify({isValid:true}));
      return new Response(JSON.stringify({error:'mock upstream unavailable'}), {status:503});
    }
  });
  await assert.rejects(() => core.invoke({
    capabilityName:'artifact.integrity_manifest',
    input:{artifacts:[{name:'a', content:'b'}]},
    idempotencyKey:'monitor-failure-001',
    paymentPayload:paymentFixture(core, `0x${'2'.repeat(64)}`),
    telemetryContext:{requestId:'correlation-failure', route:'/api/x402/artifact.integrity_manifest', synthetic:true}
  }), /reconciliation required/i);
  const failed = events.find(event => event.stage === 'SETTLEMENT_FAILED');
  assert.ok(failed);
  assert.equal(failed.failureKind, 'FACILITATOR_FAILURE');
  assert.equal(failed.telemetryContext.requestId, 'correlation-failure');
  assert.equal(events.some(event => event.stage === 'FINALIZATION_ATTEMPTED'), false);
  assert.equal(JSON.stringify(events).includes('mock-only-signature'), false);
});

test('mocked verification rejection is observable without reaching settlement', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-monitor-verification-failure-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const events = [];
  const core = createMachineCommerce({
    dataFile:path.join(dir, 'commerce.json'),
    receiver:RECEIVER,
    network:'eip155:8453',
    mainnetEnabled:true,
    rpcUrl:'https://rpc.test',
    publicBaseUrl:'https://mcp.test',
    facilitatorUrl:'https://fac.test',
    kennekarteSecret:'k'.repeat(64),
    onPaymentLifecycleEvent:event => events.push(event),
    fetchImpl:async (url, init) => {
      if (String(url) === 'https://rpc.test') return rpcResponse(init);
      return new Response(JSON.stringify({isValid:false}));
    }
  });
  await assert.rejects(() => core.invoke({
    capabilityName:'artifact.integrity_manifest',
    input:{artifacts:[{name:'a', content:'b'}]},
    idempotencyKey:'monitor-verify-failure-001',
    paymentPayload:paymentFixture(core, `0x${'3'.repeat(64)}`),
    telemetryContext:{requestId:'correlation-verify-failure', route:'/api/x402/artifact.integrity_manifest', synthetic:true}
  }), /verification failed/i);
  assert.deepEqual(events.map(event => event.stage), [
    'VERIFICATION_ATTEMPTED',
    'VERIFICATION_FAILED'
  ]);
  assert.equal(events[1].failureKind, 'VERIFICATION_FAILURE');
});

test('mocked receipt and entitlement finalization failure is observable', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-monitor-finalization-failure-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const events = [];
  const dataFile = path.join(dir, 'commerce.json');
  const gate = createProductionGate1B({
    dataFile,
    prepare:args => ({
      ...args,
      requestHash:'request-hash',
      paymentHash:'payment-hash',
      replayKey:'replay-key',
      durableContext:{...args, requestHash:'request-hash', paymentHash:'payment-hash', replayKey:'replay-key'}
    }),
    verify:async () => true,
    settle:async () => ({success:true, transaction:`0x${'4'.repeat(64)}`}),
    reconcile:async () => ({outcome:'unknown'}),
    execute:async () => ({ok:true}),
    finalize:() => { throw new Error('mock local persistence materialization failure'); },
    observe:(stage, context, details) => events.push({stage, context, details})
  });
  await assert.rejects(() => gate.invoke({
    capabilityName:'fixture.capability',
    input:{safe:true},
    idempotencyKey:'monitor-finalization-001',
    telemetryContext:{requestId:'correlation-finalization-failure'}
  }), /mock local persistence materialization failure/);
  assert.deepEqual(events.map(event => event.stage), [
    'FINALIZATION_ATTEMPTED',
    'FINALIZATION_FAILED'
  ]);
  assert.equal(events[1].details.failureKind, 'RECEIPT_OR_ENTITLEMENT_FAILURE');
});
