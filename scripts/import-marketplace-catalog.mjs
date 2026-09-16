import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {artifactInfo} from '../lib/marketplace-adapters.mjs';
import {createMarketplace} from '../lib/marketplace.mjs';
import {readJson,writeJson} from '../lib/marketplace-storage.mjs';

export function usdToAtomic(value) {
  const match=/^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(String(value));
  if(!match)throw new Error('INVALID_CATALOG_PRICE');
  return String(BigInt(match[1])*1000000n+BigInt((match[2]||'').padEnd(6,'0')));
}
export async function validateCatalog(root) {
  const products=readJson(path.join(root,'catalog/products.json'),null);
  if(!Array.isArray(products)||products.length>100)throw new Error('INVALID_CATALOG');
  const validated=[];
  for(const p of products) {
    if(p.version!=='1.0.1'||!/^releases\/[a-z0-9-]+-v1\.0\.1\.zip$/.test(p.archive)||!/^[a-f0-9]{64}$/.test(p.sha256))throw new Error('INVALID_CATALOG_ARTIFACT');
    const info=await artifactInfo(root,p.archive),sidecar=fs.readFileSync(path.join(root,p.archive+'.sha256'),'utf8').trim();
    const sidecarHash=sidecar.split(/\s+/)[0],sidecarName=sidecar.replace(/^[a-f0-9]{64}\s+\*?/,'');
    if(info.contentHash!==`sha256:${p.sha256}`||sidecarHash!==p.sha256||path.basename(sidecarName)!==path.basename(p.archive))throw new Error(`CATALOG_HASH_MISMATCH:${p.id}`);
    validated.push({...p,atomicPrice:usdToAtomic(p.priceUsd),bytes:info.size});
  }
  return {products:validated,catalogSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'catalog/products.json'))).digest('hex')};
}
export async function importCatalog({root,dataFile,reportFile}) {
  const {products,catalogSha256}=await validateCatalog(root);
  const marketplace=createMarketplace({dataFile}),admin={role:'admin',id:'local-first-party-import'};
  let existing=readJson(dataFile,{providers:{},capabilities:{}});
  let provider=Object.values(existing.providers).find(p=>p.slug==='crossingkey-first-party-staged');
  if(!provider)provider=await marketplace.registerProvider({displayName:'CrossingKey Intelligence',slug:'crossingkey-first-party-staged',description:'First-party staged catalog; publication and paid activation await operator review.',contact:'local operator'});
  const previousStatus=provider.status;
  const imported=[];
  try {
    for(const p of products) {
      existing=readJson(dataFile,{capabilities:{}});
      const old=Object.values(existing.capabilities).find(c=>c.slug===p.slug);
      if(old) {if(old.contentHash!==`sha256:${p.sha256}`||old.providerId!==provider.providerId||old.price!==p.atomicPrice)throw new Error('IMPORT_CONFLICT');imported.push({productId:p.id,capabilityId:old.capabilityId,status:old.status,contentHash:old.contentHash});continue;}
      const capability=await marketplace.registerCapability({providerId:provider.providerId,name:p.id,slug:p.slug,description:p.description,category:'digital-products',version:p.version,
        inputSchema:{type:'object',properties:{},additionalProperties:false},
        outputSchema:{type:'object',properties:{artifactId:{type:'string',maxLength:160},contentHash:{type:'string',maxLength:80},bytes:{type:'integer',minimum:0},downloadPath:{type:'string',maxLength:300},authentication:{type:'string',maxLength:100}},required:['artifactId','contentHash','bytes','downloadPath','authentication'],additionalProperties:false},
        deliveryType:'digital_asset',price:p.atomicPrice,currency:'USDC',network:'eip155:84532',license:p.license,visibility:'private',contentHash:`sha256:${p.sha256}`,sourceProvenance:`First-party products.json catalog ${catalogSha256}; staged ${p.version}; ${p.verification}`},admin,{stagedImport:true});
      imported.push({productId:p.id,capabilityId:capability.capabilityId,status:capability.status,contentHash:capability.contentHash});
    }
  }finally{/* Imported metadata does not activate a provider or accept a rights agreement. */}
  const report={verifiedAt:new Date().toISOString(),catalogSha256,count:imported.length,archiveModifications:0,publicProducts:0,providerStatus:previousStatus,priceSource:'priceUsd; launchPriceUsd retained only in original catalog, not silently substituted',products:imported};
  if(reportFile)writeJson(reportFile,report);return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [root,dataFile,reportFile]=process.argv.slice(2);
  if(!root||!dataFile)throw new Error('Usage: import-marketplace-catalog.mjs <read-only-product-root> <marketplace-state-file> [report-file]');
  console.log(JSON.stringify(await importCatalog({root,dataFile,reportFile}),null,2));
}
