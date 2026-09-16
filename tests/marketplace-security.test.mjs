import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {requestJson,createAdapters,publicIp} from '../lib/marketplace-adapters.mjs';

const publicLookup=async()=>[{address:'8.8.8.8',family:4}];
function mockRequest({status=200,chunks=['{}'],onOptions=()=>{}}={}) {
  return (_url,options,callback)=>{
    onOptions(options);const req=new EventEmitter();req.destroy=()=>{};
    req.end=()=>{queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers={};callback(response);for(const chunk of chunks)response.write(chunk);response.end();});};
    return req;
  };
}
test('HTTPS requests pin the validated DNS address and reject response-size overflow',async()=>{
  let pinned;
  const result=await requestJson('https://provider.example',{}, {lookup:publicLookup,requestImpl:mockRequest({chunks:['{"ok":true}'],onOptions:options=>{
    assert.equal(options.agent,false);options.lookup('provider.example',{},(_error,address)=>{pinned=address;});
  }})});assert.equal(pinned,'8.8.8.8');assert.deepEqual(result.data,{ok:true});
  await assert.rejects(()=>requestJson('https://provider.example',{}, {lookup:publicLookup,maxBytes:10,requestImpl:mockRequest({chunks:['x'.repeat(100)]})}),/INVALID_PROVIDER_RESPONSE/);
});
test('HTTP redirects, non-JSON and insecure URLs cannot route provider execution',async()=>{
  await assert.rejects(()=>requestJson('https://provider.example',{}, {lookup:publicLookup,requestImpl:mockRequest({status:302})}),/PROVIDER_UNAVAILABLE/);
  await assert.rejects(()=>requestJson('https://provider.example',{}, {lookup:publicLookup,requestImpl:mockRequest({chunks:['not json']})}),/INVALID_PROVIDER_RESPONSE/);
  await assert.rejects(()=>requestJson('http://provider.example',{}, {lookup:publicLookup,requestImpl:mockRequest()}),/INVALID_ENDPOINT/);
  for(const address of ['2001::1','2001:0:0:1::1','3fff::1'])assert.equal(publicIp(address),false);
});
test('MCP adapter initializes, calls only the operator-bound tool, validates output and closes session',async()=>{
  const calls=[];const adapters=createAdapters({bindings:{cap:{type:'mcp',endpoint:'https://provider.example/mcp',tool:'echo'}},request:async(_url,body,options)=>{
    calls.push(body?.method||options.method);
    if(body?.method==='initialize')return {session:'remote-test-session',data:{result:{serverInfo:{name:'fixture'}}}};
    if(body?.method==='tools/call'){assert.equal(body.params.name,'echo');assert.equal(options.headers['mcp-session-id'],'remote-test-session');return {data:{result:{structuredContent:{echo:'test'}}}};}
    return {data:null};
  }});
  const result=await adapters.executeCapability({capability:{capabilityId:'cap',outputSchema:{type:'object',properties:{echo:{type:'string',maxLength:30}},required:['echo'],additionalProperties:false}},input:{echo:'test'},job:{jobId:'fixture'},entitlement:{}});
  assert.deepEqual(result,{echo:'test'});assert.deepEqual(calls,['initialize','notifications/initialized','tools/call','DELETE']);
});
test('HTTP adapter validates actual result against the registered output schema',async()=>{
  const adapters=createAdapters({bindings:{cap:{type:'http',endpoint:'https://provider.example'}},request:async()=>({data:{secret:'unexpected output'}})});
  await assert.rejects(()=>adapters.executeCapability({capability:{capabilityId:'cap',outputSchema:{type:'object',properties:{ok:{type:'boolean'}},additionalProperties:false}},input:{},job:{},entitlement:{}}),/INVALID_PROVIDER_RESPONSE/);
});
