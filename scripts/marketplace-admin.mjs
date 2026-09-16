import fs from 'node:fs';
import path from 'node:path';
import {createMachineCommerce} from '../lib/machine-commerce.mjs';
import {createMarketplace} from '../lib/marketplace.mjs';
import {createAdapters} from '../lib/marketplace-adapters.mjs';
import {readJson} from '../lib/marketplace-storage.mjs';

// Local operator tool. Never register approval creation on MCP or HTTP.
const [operation,inputFile]=process.argv.slice(2);
if(!['approve-purchase','provider-status','capability-status','mark-settled'].includes(operation)||!inputFile) {
  console.error('Usage: node scripts/marketplace-admin.mjs <approve-purchase|provider-status|capability-status|mark-settled> <private-json-file>');process.exit(2);
}
const stat=fs.statSync(inputFile);
if(!stat.isFile()||stat.size>65536)throw new Error('INVALID_INPUT_FILE');
const args=JSON.parse(fs.readFileSync(inputFile,'utf8'));
const secret=process.env.CK_KENNEKARTE_HMAC_SECRET||process.env.CLAIM_SECRET||'';
const core=secret.length>=32?createMachineCommerce({dataFile:process.env.MACHINE_COMMERCE_FILE,network:process.env.CK_ENABLE_MAINNET==='true'?'eip155:8453':'eip155:84532',mainnetEnabled:process.env.CK_ENABLE_MAINNET==='true',kennekarteSecret:secret,facilitatorUrl:process.env.X402_FACILITATOR_URL,publicBaseUrl:process.env.PUBLIC_BASE_URL}):null;
const marketplace=createMarketplace({core,dataFile:process.env.MARKETPLACE_FILE||path.resolve('data/marketplace.json'),feeBps:Number(process.env.MARKETPLACE_FEE_BPS||1000),adapters:createAdapters({bindings:process.env.MARKETPLACE_ADAPTERS_FILE?readJson(process.env.MARKETPLACE_ADAPTERS_FILE,{}):{},assetRoot:process.env.MARKETPLACE_ASSET_ROOT})});
const admin={role:'admin',id:'local-human-operator'};
let result;
if(operation==='approve-purchase')result=await marketplace.approvePurchase(args,admin);
if(operation==='provider-status')result=await marketplace.setProviderStatus(args.providerId,args.status,admin);
if(operation==='capability-status')result=await marketplace.setCapabilityStatus(args.capabilityId,args.status,admin,args.visibility);
if(operation==='mark-settled')result=await marketplace.markSettled(args.allocationId,args.reference,admin);
console.log(JSON.stringify(result,null,2));
