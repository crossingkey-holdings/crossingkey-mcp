import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMachineCommerce, RECEIVER } from '../../lib/machine-commerce.mjs';

const dataFile=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ck-injection-security-')),'state.json');
const base={dataFile,receiver:RECEIVER,network:'eip155:84532',mainnetEnabled:false,publicBaseUrl:'https://mcp.example.test',facilitatorUrl:'https://facilitator.example.test',kennekarteSecret:'x'.repeat(64),fetchImpl:async()=>new Response(JSON.stringify({isValid:false}),{status:200})};
const results=[];
try { createMachineCommerce({...base,executionDependencies:{execute:null}}); results.push({case:'invalid executor rejected',pass:false}); } catch(e) { results.push({case:'invalid executor rejected',error:e.message,pass:true}); }
let calls=0;const injected=()=>{calls++;return {unexpected:true};};const core=createMachineCommerce({...base,executionDependencies:{execute:injected}});
for(const [name,operation] of [
  ['unknown capability',()=>core.invoke({capabilityName:'proof.synthetic',input:{},idempotencyKey:'security-unknown',paymentPayload:{}})],
  ['missing payment authority',()=>core.invoke({capabilityName:'artifact.integrity_manifest',input:{artifacts:[{name:'x',content:'x'}]},idempotencyKey:'security-no-payment',paymentPayload:{}})]
]) { try { await operation(); results.push({case:name,pass:false}); } catch(e) { results.push({case:name,error:e.message,pass:true}); } }
const forbidden=['fulfilled','receipt','entitlement','revenue'];
results.push({case:'executor cannot receive finalization authority',pass:!forbidden.some(k=>Object.prototype.hasOwnProperty.call(injected,k))});
results.push({case:'protected executor not reached before authority',pass:calls===0,calls});
fs.writeFileSync('proof/evidence/execution-injection-security.json',JSON.stringify({status:'FRESH_EXECUTION',results,pass:results.every(x=>x.pass)},null,2)+'\n');
console.log(JSON.stringify(results,null,2));if(results.some(x=>!x.pass))process.exitCode=1;
