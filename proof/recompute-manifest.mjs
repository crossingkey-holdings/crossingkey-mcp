import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const e=path.resolve(new URL('.',import.meta.url).pathname,'evidence');
const m=JSON.parse(fs.readFileSync(path.join(e,'manifest.json')));
m.generated_at=new Date().toISOString();
m.verdict='CROSSINGKEY_SYSTEM_PROOF_INCOMPLETE';
m.system_state='PRODUCTION_FEATURE_WORK_REQUIRED';
m.files=fs.readdirSync(e).filter(f=>f!=='SHA256SUMS'&&f!=='manifest.json'&&fs.statSync(path.join(e,f)).isFile()).sort();
m.closure={status:'COMBINED_PAYMENT_RECOVERY_EXECUTED',remaining:'MCP convergence, remaining system-proof gates, and complete fresh core regression remain incomplete'};
fs.writeFileSync(path.join(e,'manifest.json'),JSON.stringify(m,null,2)+'\n');
const sums=fs.readdirSync(e).filter(f=>f!=='SHA256SUMS'&&fs.statSync(path.join(e,f)).isFile()).sort().map(f=>`${crypto.createHash('sha256').update(fs.readFileSync(path.join(e,f))).digest('hex')}  proof/evidence/${f}`).join('\n')+'\n';
fs.writeFileSync(path.join(e,'SHA256SUMS'),sums);
console.log(crypto.createHash('sha256').update(fs.readFileSync(path.join(e,'manifest.json'))).digest('hex'));
