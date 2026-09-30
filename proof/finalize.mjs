import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(new URL('.', import.meta.url).pathname);
const evidence = path.join(root, 'evidence');
for (const name of ['system-map.json','system-map.md','crossingkey-proof-contract.json','positive-proof.json','adversarial-matrix.json','interface-invariance.json','recovery-proof.json']) {
  const source = path.join(root, name);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(evidence, name));
}
const read = p => fs.readFileSync(p, 'utf8');
const sha = p => crypto.createHash('sha256').update(read(p)).digest('hex');
const results = { generated_at: new Date().toISOString(), production: { npm_test: { command: 'npm test', exit_code: 0, status: 'PASS_WITH_ZERO_TESTS_DISCOVERED', note: 'Configured glob tests/*.test.mjs matched no files.' }, machine_commerce: { command: 'node --test tests/test-machine-commerce.mjs', exit_code: 1, status: 'FAIL', failure: 'TLS RPC authority is required' } }, core: { command: 'python3 -m pytest -q crossingkey_core/tests', exit_code: 1, status: 'BLOCKED', failure: 'No module named pytest', expected_baseline: 122, observed: 'not executed' }, scope: { production_modified: false, production_restarted: false, payments: false, blockchain_transactions: false } };
fs.writeFileSync(path.join(evidence, 'regression-results.json'), JSON.stringify(results, null, 2) + '\n');
const files = fs.readdirSync(evidence).filter(x => x !== 'SHA256SUMS').sort();
fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), verdict: 'CROSSINGKEY_SYSTEM_PROOF_INCOMPLETE', files, scope: results.scope }, null, 2) + '\n');
const manifestHash = sha(path.join(evidence, 'manifest.json'));
const sums = files.sort().map(x => `${sha(path.join(evidence, x))}  ${x}`).join('\n') + '\n';
fs.writeFileSync(path.join(evidence, 'SHA256SUMS'), sums);
console.log(JSON.stringify({ manifest_sha256: manifestHash, files: [...files, 'manifest.json', 'SHA256SUMS'].sort() }, null, 2));
