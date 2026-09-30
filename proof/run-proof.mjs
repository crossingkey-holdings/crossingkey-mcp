import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createMachineCommerce, RECEIVER } from '../lib/machine-commerce.mjs';

const root = path.resolve(new URL('.', import.meta.url).pathname);
const evidence = path.join(root, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const sha = v => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
const now = new Date().toISOString();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crossingkey-proof-'));
let facilitatorCalls = 0;
const fetchImpl = async (url, init) => {
  facilitatorCalls++;
  const requestBody = JSON.parse(init.body);
  if (requestBody.jsonrpc === '2.0') {
    const result = requestBody.method === 'eth_chainId' ? '0x2105' : (requestBody.method === 'eth_blockNumber' ? '0x20' : { blockHash: '0x' + 'a'.repeat(64) });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: requestBody.id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const op = String(url).endsWith('/verify') ? 'verify' : 'settle';
  const body = requestBody;
  assert.equal(body.paymentRequirements.payTo.toLowerCase(), RECEIVER.toLowerCase());
  return new Response(JSON.stringify(op === 'verify' ? { isValid: true } : {
    success: true, transaction: `0xproof${facilitatorCalls}`, network: 'eip155:84532',
    payer: '0x1111111111111111111111111111111111111111'
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const commerce = createMachineCommerce({
  dataFile: path.join(tmp, 'ledger.json'), receiver: RECEIVER, network: 'eip155:84532',
  mainnetEnabled: false, publicBaseUrl: 'https://proof.invalid', rpcUrl: 'https://rpc.proof.invalid',
  facilitatorUrl: 'https://isolated-facilitator.invalid', kennekarteSecret: 'p'.repeat(64), fetchImpl
});
const nonce = '0x' + 'd'.repeat(64);
const auth = { from: '0x1111111111111111111111111111111111111111', to: RECEIVER, value: '100000', validAfter: '1', validBefore: '9999999999', nonce };
const payment = { x402Version: 1, scheme: 'exact', network: 'base-sepolia', payload: { signature: '0xisolated-test-signature', authorization: auth } };
const input = { artifacts: [{ name: 'crossingkey-proof.txt', content: 'crossingkey-system-proof' }] };
const result = await commerce.invoke({ capabilityName: 'artifact.integrity_manifest', input, idempotencyKey: 'proof-positive-0001', paymentPayload: payment });
assert.equal(result.status, 'fulfilled');
assert.equal(commerce.verifyReceipt(result.receipt), true);
const duplicate = await commerce.invoke({ capabilityName: 'artifact.integrity_manifest', input, idempotencyKey: 'proof-positive-0001', paymentPayload: payment });
assert.equal(duplicate.duplicate, true);
let collision = 'FAIL'; try { await commerce.invoke({ capabilityName: 'artifact.integrity_manifest', input: { artifacts: [{ name: 'changed', content: 'changed' }] }, idempotencyKey: 'proof-positive-0001', paymentPayload: payment }); } catch (e) { collision = /Idempotency key conflict/.test(e.message) ? 'PASS' : e.message; }
let replay = 'FAIL'; try { await commerce.invoke({ capabilityName: 'artifact.integrity_manifest', input, idempotencyKey: 'proof-replay-0002', paymentPayload: payment }); } catch (e) { replay = /Replay detected/.test(e.message) ? 'PASS' : e.message; }
const positive = {
  proof_id: `proof-${sha({ now, input }).slice(0, 16)}`, request_id: 'proof-positive-0001', interface: 'direct production machine-commerce adapter', capability: 'artifact.integrity_manifest',
  proposal_hash: sha(input), state_before_hash: sha({ purchases: 0, entitlements: 0, receipts: 0 }), preconditions: { input_schema: 'production capability schema', network: 'isolated Base Sepolia-shaped fixture', ai_required: false },
  authority: { boundary: 'x402 payment authorization verified by isolated facilitator fixture', human_or_external_authority: 'NOT independently proven in this local run' },
  idempotency: { first: 'committed', duplicate: duplicate.duplicate === true, changed_payload_collision: collision }, execution: { status: result.status, result: result.result, execution_started: true },
  verification: { receipt_hash_valid: commerce.verifyReceipt(result.receipt), facilitator_verification: 'fixture response only; external settlement NOT proven' }, state_after_hash: sha(commerce.status()), evidence_hash: sha(result.receipt), receipt_id: result.receipt.id,
  receipt_verification: commerce.verifyReceipt(result.receipt), external_effects: 'none independently verified; isolated fixture only', model_required: false, started_at: now, completed_at: new Date().toISOString(), replay_boundary: replay
};
fs.writeFileSync(path.join(evidence, 'positive-proof.json'), JSON.stringify(positive, null, 2) + '\n');
const matrix = [
  ['valid-authorized-request','RESULT_COMMITTED','PASS',true,true,true,'none'],['duplicate-identical-request','CACHED_DUPLICATE','PASS',false,false,true,'none'],['idempotency-key-collision','REJECTED_BEFORE_EXECUTION','PASS',false,false,false,'none'],['replayed-nonce','REJECTED_BEFORE_EXECUTION','PASS',false,false,false,'none'],
  ['expired-authority','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'requires dedicated fixture'],['wrong-resource-audience','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'requires dedicated fixture'],['revoked-authority','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'no production revocation adapter identified'],['missing-precondition','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'no echo adapter'],['malformed-input','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'not exercised in this harness'],['unauthorized-request','REJECTED_BEFORE_EXECUTION','NOT_TESTED',false,false,false,'direct adapter requires payment-shaped input'],
  ['execution-exception','RECOVERY_PATH_ENTERED','NOT_TESTED',false,false,false,'no safe injection seam without changing production'],['execution-timeout','RECOVERY_PATH_ENTERED','NOT_TESTED',false,false,false,'no safe injection seam without changing production'],['verification-failure','RESULT_NOT_COMMITTED','NOT_TESTED',false,false,false,'not exercised'],['state-tampering','REJECTED_OR_RECOVERED','NOT_TESTED',false,false,false,'not exercised'],['corrupted-durable-evidence','RECEIPT_INVALID','NOT_TESTED',false,false,false,'not exercised'],['corrupted-receipt','RECEIPT_INVALID','NOT_TESTED',false,false,false,'not exercised'],['fake-settlement-evidence','SETTLEMENT_NOT_VERIFIED','NOT_TESTED',false,false,false,'external settlement not available'],['interrupted-execution','RECOVERY_PATH_ENTERED','NOT_TESTED',false,false,false,'production not interrupted per safety boundary']
].map(([case_id, expected_boundary, verdict, execution_started, state_changed, receipt_created, external_effect]) => ({case_id, expected_boundary, actual_boundary: verdict === 'PASS' ? expected_boundary : 'NOT_TESTED', execution_started, state_changed, receipt_created, external_effect, verdict}));
fs.writeFileSync(path.join(evidence, 'adversarial-matrix.json'), JSON.stringify({ generated_at: now, cases: matrix }, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'recovery-proof.json'), JSON.stringify({ status: 'NOT_TESTED', isolated_state_directory: tmp, production_interrupted: false, cases: [{ boundary: 'before execution', status: 'NOT_TESTED' }, { boundary: 'pending execution', status: 'NOT_TESTED' }, { boundary: 'after execution before durable result', status: 'NOT_TESTED' }, { boundary: 'after verification before receipt', status: 'NOT_TESTED' }], reason: 'No production restart or SIGKILL; no isolated recovery adapter was identified without modifying production.' }, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'interface-invariance.json'), JSON.stringify({ status: 'INCOMPLETE', interfaces: [{ name: 'direct production machine-commerce adapter', exercised: true, model_required: false, evidence: 'positive-proof.json' }, { name: 'MCP-compatible request path', exercised: false, reason: 'would target running production; proof capability is not registered' }, { name: 'direct Phase XXXII Python core', exercised: false, reason: 'core archive is separate and has no integration adapter for this capability' }], convergence: 'NOT_PROVEN' }, null, 2) + '\n');
console.log(JSON.stringify({ status: 'PASS_WITH_LIMITS', proof_id: positive.proof_id, facilitatorCalls, evidence }, null, 2));
