import assert from 'node:assert/strict';
import test from 'node:test';
import {validateDiscoveryExtension,validateDiscoveryExtensionSpec} from '@x402/extensions/bazaar';
import {CAPABILITIES, BASE_USDC, RECEIVER, createMachineCommerce} from '../lib/machine-commerce.mjs';
import {DISCOVERY_CAPABILITIES, buildBazaarExtension, getDiscoveryContract, validatePaidCapabilityInput} from '../lib/discovery.mjs';

test('every paid capability has a current, valid Bazaar contract',()=>{
  assert.deepEqual([...DISCOVERY_CAPABILITIES].sort(),CAPABILITIES.map(x=>x.name).sort());
  for(const capability of DISCOVERY_CAPABILITIES){
    const extension=buildBazaarExtension(capability);
    assert.deepEqual(validateDiscoveryExtensionSpec(extension),{valid:true},capability);
    assert.deepEqual(validateDiscoveryExtension(extension),{valid:true},capability);
    assert.equal(extension.info.input.method,'POST');
    assert.equal(extension.info.input.bodyType,'json');
    assert.ok(extension.info.output.example);
    assert.equal(validatePaidCapabilityInput(capability,getDiscoveryContract(capability).input).ok,true);
  }
});

test('Bazaar request schemas bound logical keys, arrays, strings and nested objects',()=>{
  for(const capability of DISCOVERY_CAPABILITIES){
    const body=buildBazaarExtension(capability).schema.properties.input.properties.body;
    assert.equal(body.additionalProperties,false,capability);
    assert.equal(body.properties.idempotency_key.maxLength,160,capability);
    const input=body.properties.input;
    assert.equal(input.additionalProperties,false,capability);
    for(const property of Object.values(input.properties)){
      if(property.type==='string') assert.ok(Number.isInteger(property.maxLength),capability);
      if(property.type==='array'){
        assert.ok(Number.isInteger(property.maxItems),capability);
        assert.equal(property.items.additionalProperties,false,capability);
      }
      if(property.type==='object') assert.ok(Number.isInteger(property.maxProperties),capability);
    }
  }
});

test('v2 challenge carries Bazaar metadata while v1 compatibility is preserved',()=>{
  const core=createMachineCommerce({dataFile:'/tmp/ck-discovery-unused.json',receiver:RECEIVER,network:'eip155:8453',mainnetEnabled:true,publicBaseUrl:'https://mcp.test',facilitatorUrl:'https://fac.test',kennekarteSecret:'k'.repeat(64)});
  for(const capability of DISCOVERY_CAPABILITIES){
    const v2=JSON.parse(Buffer.from(core.paymentRequired(capability,2).headers['PAYMENT-REQUIRED'],'base64').toString());
    assert.equal(v2.accepts[0].network,'eip155:8453');
    assert.equal(v2.accepts[0].asset,BASE_USDC);
    assert.equal(v2.accepts[0].payTo,RECEIVER);
    assert.deepEqual(validateDiscoveryExtension(v2.extensions.bazaar),{valid:true});
    const v1=core.paymentRequired(capability,1);
    assert.equal(v1.body.x402Version,1);
    assert.equal(v1.body.accepts[0].network,'base');
    assert.deepEqual(v1.headers,{});
  }
});

test('paid-input validator rejects malformed and unbounded inputs',()=>{
  assert.equal(validatePaidCapabilityInput('artifact.integrity_manifest',{artifacts:[]}).ok,false);
  assert.equal(validatePaidCapabilityInput('artifact.integrity_manifest',{artifacts:[{name:'a',content:'x'.repeat(100001)}]}).ok,false);
  assert.equal(validatePaidCapabilityInput('mcp.schema_audit',{tools:Array.from({length:101},()=>({name:'a',description:'bounded description',inputSchema:{type:'object'}}))}).ok,false);
  assert.equal(validatePaidCapabilityInput('openapi.quality_audit',{spec:{openapi:'3.1.0',info:{},paths:{},extra:'x'.repeat(500001)}}).ok,false);
  assert.equal(validatePaidCapabilityInput('x402.compatibility_audit',{url:'file:///etc/passwd'}).ok,false);
});
