import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';

const root=path.resolve(import.meta.dirname,'..');
const secret='isolated-test-only-'.repeat(4);
function application(i,contact='contact@example.invalid') {return {displayName:`Isolated ${i}`,slug:`isolated-${i}`,description:'Disposable test application',contact};}
async function start(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-security-live-'));const data=path.join(dir,'data');fs.mkdirSync(data);
 const paths={marketplace:path.join(data,'marketplace.json'),auth:path.join(data,'auth.json')};
 fs.writeFileSync(paths.marketplace,JSON.stringify({providers:{},capabilities:{},purchases:{},jobs:{},receipts:{},entitlements:{},allocations:{}}));
 const adminToken=crypto.randomBytes(32).toString('hex');const hash=crypto.createHash('sha256').update(adminToken).digest('hex');
 fs.writeFileSync(paths.auth,JSON.stringify({principals:{[hash]:{id:'admin-test',role:'admin',expiresAt:new Date(Date.now()+3600000).toISOString()}}}));
 const reservation=http.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const env={PATH:process.env.PATH,HOME:dir,PORT:String(port),PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,MARKETPLACE_FILE:paths.marketplace,MARKETPLACE_AUTH_FILE:paths.auth,MACHINE_COMMERCE_FILE:path.join(data,'commerce.json'),CK_FUNNEL_DB:path.join(data,'funnel.sqlite3'),CK_KENNEKARTE_HMAC_SECRET:secret,CLAIM_SECRET:secret,STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:''};
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});let stderr='';child.stderr.on('data',d=>stderr+=String(d).slice(0,1000));
 t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}fs.rmSync(dir,{recursive:true,force:true});});
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(`http://127.0.0.1:${port}/health`)).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}
 assert.ok(ready,`isolated server failed to start: ${stderr.slice(-400)}`);
 function client(token=null){let session=null,id=0;return async(method,params={})=>{const headers={'content-type':'application/json',accept:'application/json, text/event-stream'};if(token)headers.authorization=`Bearer ${token}`;if(session)headers['mcp-session-id']=session;const response=await fetch(`http://127.0.0.1:${port}/mcp`,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params})});assert.equal(response.status,200);session=response.headers.get('mcp-session-id')||session;const body=await response.text();const data=body.split('\n').find(x=>x.startsWith('data:'))?.slice(5);return JSON.parse(data||body);};}
 async function init(c){await c('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'security-integration',version:'1'}});}
 return {client,init,adminToken,paths};
}
test('live anonymous intake, duplicate rejection, rate limit, and admin compatibility on disposable storage',async t=>{
 const {client,init,adminToken,paths}=await start(t);
 const anon=client();await init(anon);const admin=client(adminToken);await init(admin);
 const anonNames=(await anon('tools/list')).result.tools.map(x=>x.name);
 assert.ok(anonNames.includes('provider.apply'));assert.ok(!anonNames.includes('provider.register'));
 const forbidden=await anon('tools/call',{name:'provider.register',arguments:application('forbidden')});
 assert.ok(forbidden.error||forbidden.result?.isError,'anonymous must not invoke admin registration');
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(paths.marketplace)).providers).length,0);
 const adminNames=(await admin('tools/list')).result.tools.map(x=>x.name);assert.ok(adminNames.includes('provider.register'));
 const first=await anon('tools/call',{name:'provider.apply',arguments:application('first')});assert.ok(first.result && first.result.isError !== true,JSON.stringify(first));
 const duplicate=await anon('tools/call',{name:'provider.apply',arguments:application('duplicate')});assert.equal(duplicate.result?.isError,true);assert.equal(duplicate.result?.structuredContent?.errorCode,'SLUG_EXISTS');
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(paths.marketplace)).providers).length,1);
 let limited=false;for(let i=0;i<15;i++){const r=await anon('tools/call',{name:'provider.apply',arguments:application(`rate-${i}`,`contact-${i}@example.invalid`)});if(r.result?.structuredContent?.errorCode==='RATE_LIMITED'){limited=true;break;}}
 assert.ok(limited,'anonymous intake rate limiter must reject excessive calls');
 const count=Object.keys(JSON.parse(fs.readFileSync(paths.marketplace)).providers).length;assert.ok(count<=10,`rate limit allowed ${count} stored applications`);
 const registered=await admin('tools/call',{name:'provider.register',arguments:application('admin','admin@example.invalid')});assert.ok(registered.result && registered.result.isError !== true,JSON.stringify(registered));
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(paths.marketplace)).providers).length,count+1);
});
