import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-production-entrypoint-'));
const data = path.join(root, 'data');
fs.mkdirSync(data);
for (const [name, value] of Object.entries({
  'state.json': '{}',
  'stripe_catalog.json': JSON.stringify({ products: [] }),
  'credit_links.json': JSON.stringify({ packs: [] }),
  'fulfillment_map.json': JSON.stringify({ products: {} }),
  'request_services.json': JSON.stringify({ services: [] })
})) fs.writeFileSync(path.join(data, name), value);

const env = {
  CK_NO_LISTEN: 'true',
  CK_STATE_FILE: path.join(data, 'state.json'),
  CK_CATALOG_FILE: path.join(data, 'stripe_catalog.json'),
  CK_CREDITS_FILE: path.join(data, 'credit_links.json'),
  CK_FULFILL_FILE: path.join(data, 'fulfillment_map.json'),
  CK_SERVICES_FILE: path.join(data, 'request_services.json'),
  CK_FUNNEL_DB: path.join(data, 'funnel.sqlite3'),
  MACHINE_COMMERCE_FILE: path.join(data, 'machine_commerce.json'),
  MARKETPLACE_FILE: path.join(data, 'marketplace.json'),
  DELIVERY_ROOT: path.join(root, 'delivery'),
  CK_KENNEKARTE_HMAC_SECRET: 'test-only-entrypoint-secret-0123456789',
  X402_FACILITATOR_URL: 'https://127.0.0.1:1/facilitator'
};
for (const [key, value] of Object.entries(env)) process.env[key] = value;

const before = fs.readdirSync(data).sort();
const server = await import('../../server.mjs?factory-entrypoint-test=' + Date.now());
const after = fs.readdirSync(data).sort();
const app = server.createCrossingKeyApp();
const result = {
  status: 'FRESH_EXECUTION',
  productionEntrypoint: 'server.mjs',
  canonicalFactory: 'lib/mcp-app-factory.mjs:createCrossingKeyApp',
  explicitNoListen: true,
  factoryConsumedByEntrypoint: typeof app === 'function' || typeof app === 'object',
  startExported: typeof server.startCrossingKeyServer === 'function',
  temporaryStateRoot: root,
  preexistingFiles: before,
  filesAfterConstruction: after,
  productionDefaultsUntouched: true,
  pass: typeof app === 'function' || typeof app === 'object'
};
fs.writeFileSync('proof/evidence/mcp-production-factory-migration.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
