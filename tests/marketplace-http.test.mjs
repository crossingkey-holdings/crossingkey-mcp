import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createMachineCommerce,RECEIVER} from '../lib/machine-commerce.mjs';
import {createMarketplace} from '../lib/marketplace.mjs';
import {writeJson} from '../lib/marketplace-storage.mjs';

test('real MCP transport E2E: provider onboarding, digital delivery, human approval, receipt and allocation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-marketplace-http-'));
  const coreFile=path.join(dir,'core.json'),marketFile=path.join(dir,'marketplace.json'),authFile=path.join(dir,'auth.json'),bindingsFile=path.join(dir,'bindings.json');
  const asset=Buffer.from('LOCAL SANDBOX DIGITAL ARTIFACT'),contentHash=`sha256:${crypto.createHash('sha256').update(asset).digest('hex')}`;
  fs.mkdirSync(path.join(dir,'assets'));fs.writeFileSync(path.join(dir,'assets','echo.zip'),asset);
  let settlements=0;
  const facilitator=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=JSON.parse(text);assert.equal(body.paymentRequirements.payTo,RECEIVER);res.setHeader('content-type','application/json');
    if(req.url==='/verify')res.end(JSON.stringify({isValid:true}));else{settlements++;res.end(JSON.stringify({success:true,transaction:'0x'+'a'.repeat(64)}));}});
  facilitator.listen(0,'127.0.0.1');await once(facilitator,'listening');
  const facilitatorUrl=`http://127.0.0.1:${facilitator.address().port}`;
  const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const base=`http://127.0.0.1:${port}`,secret='sandbox-only'.repeat(8),tokens={},principals={};
  function credential(name,entry){const token=crypto.randomBytes(32).toString('hex');tokens[name]=token;principals[crypto.createHash('sha256').update(token).digest('hex')]={id:name,expiresAt:new Date(Date.now()+600000).toISOString(),...entry};writeJson(authFile,{principals});}
  credential('admin',{role:'admin'});credential('buyer',{role:'buyer',buyerReference:'sandbox-buyer'});
  writeJson(bindingsFile,{});
  const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),PUBLIC_BASE_URL:base,MACHINE_COMMERCE_FILE:coreFile,MARKETPLACE_FILE:marketFile,MARKETPLACE_AUTH_FILE:authFile,MARKETPLACE_ADAPTERS_FILE:bindingsFile,MARKETPLACE_ASSET_ROOT:path.join(dir,'assets'),CK_ENABLE_MAINNET:'false',CK_KENNEKARTE_HMAC_SECRET:secret,CLAIM_SECRET:secret,X402_FACILITATOR_URL:facilitatorUrl,STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}await new Promise(r=>facilitator.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(base+'/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.equal(ready,true);
  const sessions={};let sequence=0;
  async function rpc(who,method,params) {
    const headers={'content-type':'application/json',accept:'application/json, text/event-stream',...(tokens[who]?{authorization:`Bearer ${tokens[who]}`}:{})};
    if(sessions[who])headers['mcp-session-id']=sessions[who];
    const response=await fetch(base+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++sequence,method,params})});
    assert.equal(response.status,200);if(response.headers.get('mcp-session-id'))sessions[who]=response.headers.get('mcp-session-id');
    const text=await response.text(),data=text.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5)).join('\n');return JSON.parse(data||text);
  }
  async function initialize(who){return rpc(who,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'sandbox-test',version:'1'}});}
  async function call(who,name,args={}) {const result=await rpc(who,'tools/call',{name,arguments:args});assert.equal(result.error,undefined,JSON.stringify(result));assert.equal(result.result.isError,undefined,JSON.stringify(result));return result.result.structuredContent;}
  await initialize('anonymous');await initialize('admin');await initialize('buyer');
  const tools=(await rpc('anonymous','tools/list',{})).result.tools;
  assert.equal(tools.length,42);assert.equal(new Set(tools.map(x=>x.name)).size,42);
  assert.equal(tools.find(x=>x.name==='capability.purchase').execution.taskSupport,'forbidden');
  assert.equal(tools.find(x=>x.name==='provider.register').inputSchema.additionalProperties,false);
  const provider=await call('anonymous','provider.register',{displayName:'Provider A LOCAL SANDBOX',slug:'http-fixture-provider',description:'Local test only',contact:'sandbox fixture'});assert.equal(provider.status,'pending');
  const denied=await rpc('buyer','tools/call',{name:'provider.setStatus',arguments:{providerId:provider.providerId,status:'active'}});assert.equal(denied.result.structuredContent.errorCode,'UNAUTHORIZED');
  await call('admin','provider.setStatus',{providerId:provider.providerId,status:'active'});
  credential('provider',{role:'provider',providerId:provider.providerId});await initialize('provider');
  const outputSchema={type:'object',properties:{artifactId:{type:'string',maxLength:160},contentHash:{type:'string',maxLength:80},bytes:{type:'integer'},downloadPath:{type:'string',maxLength:300},authentication:{type:'string',maxLength:100}},required:['artifactId','contentHash','downloadPath','bytes','authentication'],additionalProperties:false};
  const capability=await call('provider','capability.register',{providerId:provider.providerId,name:'marketplace.echo',slug:'http-echo',description:'Local sandbox digital echo artifact',category:'test',version:'1.0.0',inputSchema:{type:'object',properties:{},additionalProperties:false},outputSchema,deliveryType:'digital_asset',price:'100000',currency:'USDC',network:'eip155:84532',license:'Test only',visibility:'public',contentHash,sourceProvenance:'LOCAL SANDBOX',rights:{ownershipRepresentation:'Test fixture',distributionPermission:true,commercializationPermission:true,revocationPolicy:'Local tests only',affirmed:true}});
  assert.equal(capability.rights.aiTrainingPermission,false);assert.equal((await call('anonymous','catalog.list')).total,0);
  writeJson(bindingsFile,{[capability.capabilityId]:{type:'digital_asset',file:'echo.zip'}});
  await call('admin','capability.setStatus',{capabilityId:capability.capabilityId,status:'active'});
  assert.equal((await call('anonymous','capability.search',{query:'marketplace.echo'})).total,1);
  const quote=await call('anonymous','commerce.quote',{capabilityId:capability.capabilityId});assert.equal(quote.providerAmount,'90000');
  const core=createMachineCommerce({dataFile:coreFile,network:'eip155:84532',kennekarteSecret:secret,publicBaseUrl:base,facilitatorUrl});
  const mp=createMarketplace({core,dataFile:marketFile});
  const approval=await mp.approvePurchase({capabilityId:capability.capabilityId,buyerReference:'sandbox-buyer',idempotencyKey:'http-sandbox-purchase',input:{},expiresAt:new Date(Date.now()+60000).toISOString()},{role:'admin',id:'local-human-fixture'});
  const args={capabilityId:capability.capabilityId,approvalId:approval.approvalId,idempotencyKey:'http-sandbox-purchase',input:{},paymentPayload:{x402Version:2,accepted:quote.paymentRequirement.v2,payload:{signature:'sandbox-only-no-real-signature',authorization:{from:'0x'+'b'.repeat(40),to:RECEIVER,value:'100000',validAfter:'1',validBefore:'9999999999',nonce:'0x'+'c'.repeat(64)}}}};
  const purchase=await call('buyer','capability.purchase',args);assert.equal(purchase.status,'verified');assert.equal(purchase.paymentStatus,'successful');assert.equal(settlements,1);
  assert.equal((await call('buyer','capability.purchase',args)).duplicate,true);assert.equal(settlements,1);
  const receipt=await call('buyer','receipt.get',{receiptId:purchase.receipt.id});assert.equal(BigInt(receipt.allocation.platformAmount)+BigInt(receipt.allocation.providerAmount),100000n);
  assert.equal((await call('buyer','job.status',{jobId:purchase.job.jobId})).job.status,'verified');
  assert.equal((await call('provider','settlement.getProviderBalance',{providerId:provider.providerId})).balances[0].payable,'90000');
  const download=await fetch(base+purchase.result.downloadPath,{headers:{authorization:`Bearer ${tokens.buyer}`}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),asset);
  const unauthorized=await fetch(base+purchase.result.downloadPath);assert.equal(unauthorized.status,403);
  const legacy=await call('anonymous','capability.get',{name:'artifact.integrity_manifest'});assert.equal(legacy.item.amount,'100000');
  const wrongSession=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','mcp-session-id':sessions.buyer},body:JSON.stringify({jsonrpc:'2.0',id:100,method:'tools/list',params:{}})});assert.equal(wrongSession.status,401);
  const discovery=await (await fetch(base+'/.well-known/mcp.json')).json();assert.equal(discovery.version,'2.5.0');assert.equal(discovery.marketplace,true);assert.equal(discovery.activeCapabilityCount,1);
});
