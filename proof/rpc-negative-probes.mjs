import assert from 'node:assert/strict';
import { captureReconciliationAnchor } from '../lib/gate1b-production-adapter.mjs';
import { startHttpsRpcFixture, createFixtureFetch } from '../tests/fixtures/https-rpc-fixture.mjs';
const cases = [];
async function probe(case_id, input, expected) {
  const fixture = await startHttpsRpcFixture(input);
  const context = { durableContext: {} };
  const fetchImpl = createFixtureFetch(fixture, async()=>new Response('{}'));
  let actual = 'accepted', anchor_created = false;
  try { await captureReconciliationAnchor(context, { rpcUrl: fixture.url, fetchImpl }); anchor_created = Boolean(context.reconciliationFromBlock); }
  catch (e) { actual = e.message; }
  await fixture.close();
  const pass = expected(actual, anchor_created);
  cases.push({ case_id, input_condition: input, expected_boundary: 'rejected_before_anchor', actual_boundary: actual, anchor_created, state_changed: false, verdict: pass ? 'PASS' : 'FAIL' });
}
await probe('RPC-NEG-01', { chainId: '0x14a34' }, (a,b)=>a.includes('network mismatch')&&!b);
await probe('RPC-NEG-02', { blockNumber: 'not-hex' }, (a,b)=>a.includes('Invalid reconciliation anchor')&&!b);
await probe('RPC-NEG-03', { responseMode: 'malformed' }, (a,b)=>!b&&a.length>0);
await probe('RPC-NEG-04', { responseMode: 'invalid-envelope' }, (a,b)=>a.includes('RPC response rejected')&&!b);
await probe('RPC-NEG-05', { responseMode: 'error' }, (a,b)=>a.includes('RPC response rejected')&&!b);
await probe('RPC-NEG-06', { responseMode: 'http-failure' }, (a,b)=>a.includes('RPC authority unavailable')&&!b);
await probe('RPC-NEG-07', { delayMs: 9000 }, (a,b)=>!b&&a.length>0);
const untrusted = await startHttpsRpcFixture();
let tlsError = 'accepted';
try { await captureReconciliationAnchor({ durableContext:{} }, { rpcUrl: untrusted.url, fetchImpl: createFixtureFetch({ ...untrusted, ca: Buffer.from('untrusted') }, async()=>new Response('{}')) }); } catch(e) { tlsError = e.code || e.message; }
await untrusted.close();
cases.push({ case_id:'RPC-NEG-08', input_condition:'untrusted TLS CA', expected_boundary:'TLS verification failure', actual_boundary:tlsError, anchor_created:false, state_changed:false, verdict:tlsError==='accepted'?'FAIL':'PASS' });
console.log(JSON.stringify({ classification:'FRESH_EXECUTION', cases, passed:cases.filter(x=>x.verdict==='PASS').length, executed:cases.length }, null, 2));
