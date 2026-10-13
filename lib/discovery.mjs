import { declareDiscoveryExtension } from '@x402/extensions/bazaar';

const object = properties => ({type:'object',properties,additionalProperties:false});

const contracts = {

  'hash.encode': {
    input:{text:'abc'},
    inputSchema:{...object({text:{type:'string',maxLength:65536,description:'Text to SHA-256 hash; at most 65536 UTF-8 bytes.'}}),required:['text']},
    output:{capability:'hash.encode',algorithm:'sha256',encoding:'hex',bytes:3,digest:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}
  },
  'secret.scan': {
    input:{text:'Example public text without credentials.'},
    inputSchema:{...object({text:{type:'string',maxLength:65536,description:'Text to scan for credential patterns; at most 65536 UTF-8 bytes. Do not submit live secrets until the data retention policy is approved.'}}),required:['text']},
    output:{capability:'secret.scan',count:0,counts:{},findings:[]}
  },
  'pii.scan': {
    input:{text:'Example public text without personal information.'},
    inputSchema:{...object({text:{type:'string',maxLength:65536,description:'Text to scan for personal-data patterns; at most 65536 UTF-8 bytes. Do not submit real personal data until the data retention policy is approved.'}}),required:['text']},
    output:{capability:'pii.scan',count:0,counts:{},findings:[]}
  },
  'json.repair': {
    input:{text:'{"example":true,}'},
    inputSchema:{...object({text:{type:'string',maxLength:65536,description:'JSON-like text to validate or conservatively repair; at most 65536 UTF-8 bytes.'}}),required:['text']},
    output:{capability:'json.repair',repaired:true,json:'{"example":true}',changes:['removed_trailing_comma']}
  },
  'prompt.audit': {
    input:{text:'Return a JSON object summarizing the public example. Only include facts.'},
    inputSchema:{...object({text:{type:'string',maxLength:65536,description:'Prompt text to audit heuristically; at most 65536 UTF-8 bytes.'}}),required:['text']},
    output:{capability:'prompt.audit',score:80,findings:[{code:'NO_EXAMPLES',recommendation:'Include an example when precision matters.'}],method:'deterministic_heuristics_v1'}
  },
  'mcp.launch_audit': {
    input:{url:'https://merchant.example'},
    inputSchema:{...object({url:{type:'string',maxLength:2048,pattern:'^https?://',description:'Public MCP service base URL to audit.'}}),required:['url']},
    output:{capability:'mcp.launch_audit',target:'https://merchant.example/',score:100,passed:true,checks:[],findings:[],method:'crossingkey_mcp_launch_audit_v1'}
  },
  'x402.purchase_path_audit': {
    input:{url:'https://merchant.example',capability:'mcp.launch_audit'},
    inputSchema:{...object({url:{type:'string',maxLength:2048,pattern:'^https?://',description:'Public x402 service base URL.'},capability:{type:'string',minLength:1,maxLength:160,description:'Capability name whose no-payment challenge should be audited.'}}),required:['url','capability']},
    output:{capability:'x402.purchase_path_audit',target:'https://merchant.example/',auditedCapability:'mcp.launch_audit',score:100,passed:true,checks:[],findings:[],paymentAttempted:false,settlementAttempted:false,method:'crossingkey_x402_purchase_path_audit_v1'}
  },
  'x402.compatibility_audit': {
    input: {url:'https://merchant.example/api/report'},
    inputSchema: {
      ...object({url:{type:'string',maxLength:2048,pattern:'^https?://',description:'Public HTTP(S) resource whose unpaid response should expose an x402 challenge.'}}),
      required:['url']
    },
    output: {capability:'x402.compatibility_audit',target:'https://merchant.example/api/report',status:402,detectedVersion:2,findings:[],passed:true}
  },
  'mcp.schema_audit': {
    input: {tools:[{name:'catalog.search',description:'Search a bounded product catalog by a buyer-provided query.',inputSchema:{type:'object',properties:{query:{type:'string',description:'Search query.'}},required:['query'],additionalProperties:false}}]},
    inputSchema: {
      ...object({tools:{type:'array',minItems:1,maxItems:100,description:'MCP tool definitions to score for agent discoverability and bounded input contracts.',items:{
        ...object({
          name:{type:'string',minLength:1,maxLength:160},
          description:{type:'string',minLength:1,maxLength:1000},
          inputSchema:{type:'object',maxProperties:100}
        }),
        required:['name','description','inputSchema']
      }}}),
      required:['tools']
    },
    output: {capability:'mcp.schema_audit',score:100,tools:[{name:'catalog.search',score:100,findings:[]}]}
  },
  'openapi.quality_audit': {
    input: {spec:{openapi:'3.1.0',info:{title:'Catalog API',version:'1.0.0'},paths:{'/health':{get:{operationId:'health',responses:{'200':{description:'Healthy'}}}}}}},
    inputSchema: {
      ...object({spec:{type:'object',minProperties:3,maxProperties:50,description:'OpenAPI document to inspect; the complete request body remains capped by the server at 1 MB.',required:['openapi','info','paths']}}),
      required:['spec']
    },
    output: {capability:'openapi.quality_audit',score:100,operationCount:1,findings:[]}
  },
  'machine_commerce.readiness_audit': {
    input: {url:'https://merchant.example'},
    inputSchema: {
      ...object({url:{type:'string',maxLength:2048,pattern:'^https?://',description:'Public service base URL whose machine-commerce health and discovery surfaces should be checked.'}}),
      required:['url']
    },
    output: {capability:'machine_commerce.readiness_audit',score:100,checks:[{path:'/health',status:200,ok:true}]}
  },
  'artifact.integrity_manifest': {
    input: {artifacts:[{name:'release.json',content:'{"version":"1.0.0"}'}]},
    inputSchema: {
      ...object({artifacts:{type:'array',minItems:1,maxItems:100,description:'Named text artifacts to hash deterministically.',items:{
        ...object({name:{type:'string',minLength:1,maxLength:256},content:{type:'string',maxLength:100000}}),
        required:['name','content']
      }}}),
      required:['artifacts']
    },
    output: {capability:'artifact.integrity_manifest',manifest:[{name:'release.json',bytes:19,sha256:'2afa0f3c420ac37f226ceed715865e390c67593793f413018af33d8a79f56b9f'}],manifestSha256:'2f718528279725d69c1911fc55e7a29f6c930903d3ec060a4dd2f8f40295d702'}
  }
};

export const DISCOVERY_CAPABILITIES = Object.freeze(Object.keys(contracts));

function paidRequestSchema(inputSchema){
  return {
    ...object({
      idempotency_key:{type:'string',minLength:8,maxLength:160,pattern:'^[A-Za-z0-9._:-]+$',description:'Buyer-generated logical request key for duplicate-settlement and duplicate-fulfillment protection.'},
      input:inputSchema
    }),
    required:['idempotency_key','input']
  };
}

export function getDiscoveryContract(capabilityName){
  const contract=contracts[capabilityName];
  if(!contract) throw new Error('Unknown discovery capability');
  return structuredClone(contract);
}

export function buildBazaarExtension(capabilityName){
  const contract=getDiscoveryContract(capabilityName);
  return declareDiscoveryExtension({
    method:'POST',
    bodyType:'json',
    input:{idempotency_key:'buyer-request-001',input:contract.input},
    inputSchema:paidRequestSchema(contract.inputSchema),
    output:{example:contract.output}
  }).bazaar;
}

function isObject(value){return Boolean(value)&&typeof value==='object'&&!Array.isArray(value);}
function validPublicUrl(value){
  if(typeof value!=='string'||value.length>2048) return false;
  try { const url=new URL(value); return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password; }
  catch { return false; }
}

export function validatePaidCapabilityInput(capabilityName,input){
  if(!isObject(input)) return {ok:false,code:'input_object_required'};
  if(capabilityName==='x402.compatibility_audit'||capabilityName==='machine_commerce.readiness_audit'){
    return validPublicUrl(input.url)&&Object.keys(input).length===1?{ok:true}:{ok:false,code:'bounded_public_url_required'};
  }
  if(capabilityName==='mcp.schema_audit'){
    const tools=input.tools;
    const valid=Array.isArray(tools)&&tools.length>=1&&tools.length<=100&&Object.keys(input).length===1&&tools.every(tool=>
      isObject(tool)&&Object.keys(tool).every(key=>['name','description','inputSchema'].includes(key))&&
      typeof tool.name==='string'&&tool.name.length>=1&&tool.name.length<=160&&
      typeof tool.description==='string'&&tool.description.length>=1&&tool.description.length<=1000&&
      isObject(tool.inputSchema)&&Object.keys(tool.inputSchema).length<=100
    );
    return valid?{ok:true}:{ok:false,code:'bounded_tools_array_required'};
  }
  if(capabilityName==='openapi.quality_audit'){
    let bytes=Infinity;
    try { bytes=Buffer.byteLength(JSON.stringify(input.spec)); } catch {}
    const valid=Object.keys(input).length===1&&isObject(input.spec)&&Object.keys(input.spec).length<=50&&bytes<=500000&&
      typeof input.spec.openapi==='string'&&isObject(input.spec.info)&&isObject(input.spec.paths);
    return valid?{ok:true}:{ok:false,code:'bounded_openapi_spec_required'};
  }
  if(capabilityName==='artifact.integrity_manifest'){
    const artifacts=input.artifacts;
    const valid=Array.isArray(artifacts)&&artifacts.length>=1&&artifacts.length<=100&&Object.keys(input).length===1&&artifacts.every(artifact=>
      isObject(artifact)&&Object.keys(artifact).length===2&&typeof artifact.name==='string'&&artifact.name.length>=1&&artifact.name.length<=256&&
      typeof artifact.content==='string'&&artifact.content.length<=100000
    );
    return valid?{ok:true}:{ok:false,code:'bounded_artifacts_required'};
  }
  if(['hash.encode','secret.scan','pii.scan','json.repair','prompt.audit'].includes(capabilityName)){
    const valid=Object.keys(input).length===1&&typeof input.text==='string'&&Buffer.byteLength(input.text,'utf8')<=65536;
    return valid?{ok:true}:{ok:false,code:'bounded_text_required'};
  }
  if(capabilityName==='mcp.launch_audit'){
    const valid=Object.keys(input).length===1&&typeof input.url==='string'&&/^https?:\/\//.test(input.url)&&input.url.length<=2048;
    return valid?{ok:true}:{ok:false,code:'bounded_launch_audit_required'};
  }
  if(capabilityName==='x402.purchase_path_audit'){
    const valid=Object.keys(input).length===2&&typeof input.url==='string'&&/^https?:\/\//.test(input.url)&&input.url.length<=2048&&typeof input.capability==='string'&&input.capability.length>=1&&input.capability.length<=160;
    return valid?{ok:true}:{ok:false,code:'bounded_purchase_audit_required'};
  }
  return {ok:false,code:'unknown_capability'};
}
