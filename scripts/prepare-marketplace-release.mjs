import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeJson} from '../lib/marketplace-storage.mjs';

// Preparation only: no systemctl, production writes, credentials, network or deployments.
const destination=process.argv[2];
if(!destination||fs.existsSync(destination))throw new Error('Supply a new, non-existing release output directory.');
const source=process.cwd(),target=path.resolve(destination);
if(target===source||target.startsWith(path.join(source,'.git')+path.sep))throw new Error('INVALID_TARGET');
const files=['server.mjs','package.json','package-lock.json','server.json','live-status.json',
  'lib/machine-commerce.mjs','lib/discovery.mjs','lib/onchain-verifier.mjs',
  'lib/marketplace.mjs','lib/marketplace-adapters.mjs','lib/marketplace-schema.mjs','lib/marketplace-storage.mjs','lib/marketplace-tools.mjs'];
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const manifest={version:JSON.parse(fs.readFileSync('package.json')).version,sourceCommit:commit,preparedAt:new Date().toISOString(),status:'PREPARED_NOT_DEPLOYED',files:[],excluded:['.env','data','delivery','node_modules','tests','private adapter/auth files','release archives']};
for(const file of files){
  const bytes=fs.readFileSync(file),committed=execFileSync('git',['show',`${commit}:${file}`],{maxBuffer:8*1024*1024});
  if(!bytes.equals(committed))throw new Error(`UNCOMMITTED_RUNTIME:${file}`);
  manifest.files.push({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.mkdirSync(target,{recursive:true,mode:0o700});
for(const entry of manifest.files){const out=path.join(target,entry.file);fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700});fs.copyFileSync(entry.file,out);if(crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')!==entry.sha256)throw new Error('COPY_HASH_MISMATCH');}
writeJson(path.join(target,'PREPARED_MARKETPLACE_RELEASE.json'),manifest);
console.log(JSON.stringify({status:manifest.status,version:manifest.version,sourceCommit:commit,fileCount:manifest.files.length,target},null,2));
