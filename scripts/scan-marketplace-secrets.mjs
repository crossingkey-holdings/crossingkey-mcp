import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

// Report filenames/categories only, never matching secret material.
const staged=process.argv.includes('--staged');
const files=execFileSync('git',staged?['diff','--cached','--name-only','--diff-filter=ACMR','-z']:['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const rules=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['stripe-secret',/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],['cloudflare-token-assignment',/(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[=:]\s*["']?[A-Za-z0-9_-]{30,}/],['secret-assignment',/(?:PRIVATE_KEY|MNEMONIC|SEED_PHRASE|STRIPE_SECRET_KEY|CLAIM_SECRET|CK_KENNEKARTE_HMAC_SECRET)\s*[=:]\s*["'][^"'\n]{32,}["']/]];
const findings=[];
for(const file of files){
  if(/(^|\/)\.env(?:\.|$)/.test(file)&&!file.endsWith('.env.example'))findings.push({file,category:'environment-file'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())continue;
  const content=staged?execFileSync('git',['show',`:${file}`],{encoding:'utf8',maxBuffer:8*1024*1024}):fs.readFileSync(file,'utf8');
  for(const [category,pattern]of rules)if(pattern.test(content))findings.push({file,category});
}
console.log(JSON.stringify({scope:staged?'staged-index':'tracked-files',filesScanned:files.length,findings,limitations:'Pattern scan; not proof that all possible secrets or private data are absent. Generated test credentials are ephemeral. Ignored runtime data and .env files are never staged.'},null,2));
if(findings.length)process.exitCode=1;
