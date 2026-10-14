import { z } from 'zod';

const x402 = ({
  name,
  title,
  description,
  priceUsd,
  amount,
  tags,
  inputSchema,
  inputJsonSchema,
  output
}) => Object.freeze({
  name,
  title,
  description,
  rail:'x402',
  chargingModel:'x402_exact',
  priceUsd,
  amount,
  asset:'USDC',
  executionPath:`/api/x402/${encodeURIComponent(name)}`,
  tags:Object.freeze(tags),
  inputSchema,
  inputJsonSchema:Object.freeze(inputJsonSchema),
  output:Object.freeze(output),
  public:true,
  paid:true
});

export const X402_CAPABILITIES = Object.freeze([
  x402({
    name:'x402.compatibility_audit',
    title:'Purchase x402 Compatibility Audit',
    description:'PAID $1.00 USDC on Base via x402. Audits an x402 endpoint for v1/v2 compatibility defects. Calling this MCP tool does not spend funds; it returns the exact PAYMENT-REQUIRED challenge and canonical paid execution endpoint.',
    priceUsd:'1.00',
    amount:'1000000',
    tags:['x402','audit','compatibility'],
    inputSchema:{
      url:z.string().url().describe('Public HTTP(S) x402 endpoint to audit.')
    },
    inputJsonSchema:{
      type:'object',
      required:['url'],
      additionalProperties:false,
      properties:{
        url:{
          type:'string',
          format:'uri',
          description:'Public HTTP(S) x402 endpoint to audit.'
        }
      }
    },
    output:{
      type:'object',
      description:'Compatibility result including status, detected x402 version, findings and pass/fail state.'
    }
  }),

  x402({
    name:'mcp.schema_audit',
    title:'Purchase MCP Schema Audit',
    description:'PAID $1.00 USDC on Base via x402. Scores supplied MCP tool schemas for discoverability, descriptions, and bounded input contracts. Calling this MCP tool does not spend funds; it returns the exact PAYMENT-REQUIRED challenge and canonical paid execution endpoint.',
    priceUsd:'1.00',
    amount:'1000000',
    tags:['mcp','schema','audit'],
    inputSchema:{
      tools:z.array(z.record(z.unknown())).min(1)
        .describe('MCP tool definitions to audit.')
    },
    inputJsonSchema:{
      type:'object',
      required:['tools'],
      additionalProperties:false,
      properties:{
        tools:{
          type:'array',
          minItems:1,
          items:{type:'object'},
          description:'MCP tool definitions to audit.'
        }
      }
    },
    output:{
      type:'object',
      description:'Aggregate MCP schema score plus per-tool findings.'
    }
  }),

  x402({
    name:'openapi.quality_audit',
    title:'Purchase OpenAPI Quality Audit',
    description:'PAID $1.00 USDC on Base via x402. Evaluates structural quality and required fields in an OpenAPI document. Calling this MCP tool does not spend funds; it returns the exact PAYMENT-REQUIRED challenge and canonical paid execution endpoint.',
    priceUsd:'1.00',
    amount:'1000000',
    tags:['openapi','api','audit'],
    inputSchema:{
      spec:z.record(z.unknown())
        .describe('Parsed OpenAPI document to audit.')
    },
    inputJsonSchema:{
      type:'object',
      required:['spec'],
      additionalProperties:false,
      properties:{
        spec:{
          type:'object',
          description:'Parsed OpenAPI document to audit.'
        }
      }
    },
    output:{
      type:'object',
      description:'OpenAPI quality score, operation count and structural findings.'
    }
  }),

  x402({
    name:'machine_commerce.readiness_audit',
    title:'Purchase Machine-Commerce Readiness Audit',
    description:'PAID $2.00 USDC on Base via x402. Checks machine-commerce discovery and health surfaces. Calling this MCP tool does not spend funds; it returns the exact PAYMENT-REQUIRED challenge and canonical paid execution endpoint.',
    priceUsd:'2.00',
    amount:'2000000',
    tags:['machine-commerce','audit','readiness'],
    inputSchema:{
      url:z.string().url()
        .describe('Base URL of the machine-commerce service to audit.')
    },
    inputJsonSchema:{
      type:'object',
      required:['url'],
      additionalProperties:false,
      properties:{
        url:{
          type:'string',
          format:'uri',
          description:'Base URL of the machine-commerce service to audit.'
        }
      }
    },
    output:{
      type:'object',
      description:'Machine-commerce readiness score and endpoint checks.'
    }
  }),

  x402({
    name:'artifact.integrity_manifest',
    title:'Purchase Artifact Integrity Manifest',
    description:'PAID $0.10 USDC on Base via x402. Creates deterministic SHA-256 entries and a root manifest hash for supplied text artifacts. Calling this MCP tool does not spend funds; it returns the exact PAYMENT-REQUIRED challenge and canonical paid execution endpoint.',
    priceUsd:'0.10',
    amount:'100000',
    tags:['artifact','integrity','sha256','manifest'],
    inputSchema:{
      artifacts:z.array(
        z.object({
          name:z.string().min(1).max(300)
            .describe('Artifact name.'),
          content:z.string()
            .describe('Text content to hash.')
        }).strict()
      ).min(1).describe('Artifacts to include in the integrity manifest.')
    },
    inputJsonSchema:{
      type:'object',
      required:['artifacts'],
      additionalProperties:false,
      properties:{
        artifacts:{
          type:'array',
          minItems:1,
          items:{
            type:'object',
            required:['name','content'],
            additionalProperties:false,
            properties:{
              name:{type:'string',minLength:1,maxLength:300},
              content:{type:'string'}
            }
          }
        }
      }
    },
    output:{
      type:'object',
      description:'Deterministic artifact hashes and root manifest hash.'
    }
  }),
  x402({
    name:'hash.encode',
    title:'Purchase SHA-256 Text Hash',
    description:'PAID $0.01 USDC on Base via x402. Computes a SHA-256 digest and UTF-8 byte count for supplied text. Calling this MCP tool returns a payment challenge and does not autonomously spend funds.',
    priceUsd:'0.01',
    amount:'10000',
    tags:['hash', 'sha256', 'integrity'],
    inputSchema:{text:z.string().max(65536).describe('Input text, maximum 65536 UTF-8 bytes.')},
    inputJsonSchema:{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',maxLength:65536,description:'Input text, maximum 65536 UTF-8 bytes.'}}},
    output:{type:'object',description:'Deterministic hash.encode result.'}
  }),

  x402({
    name:'secret.scan',
    title:'Purchase Secret Pattern Scan',
    description:'PAID $0.01 USDC on Base via x402. Detects selected credential patterns and returns classifications and positions, not matched values. Heuristic, not comprehensive. Calling this MCP tool returns a payment challenge and does not autonomously spend funds.',
    priceUsd:'0.01',
    amount:'10000',
    tags:['secrets', 'scan', 'security'],
    inputSchema:{text:z.string().max(65536).describe('Input text, maximum 65536 UTF-8 bytes.')},
    inputJsonSchema:{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',maxLength:65536,description:'Input text, maximum 65536 UTF-8 bytes.'}}},
    output:{type:'object',description:'Deterministic secret.scan result.'}
  }),

  x402({
    name:'pii.scan',
    title:'Purchase PII Pattern Scan',
    description:'PAID $0.01 USDC on Base via x402. Detects selected personal-data patterns and returns classifications and positions, not matched values. Heuristic, not comprehensive. Calling this MCP tool returns a payment challenge and does not autonomously spend funds.',
    priceUsd:'0.01',
    amount:'10000',
    tags:['pii', 'scan', 'privacy'],
    inputSchema:{text:z.string().max(65536).describe('Input text, maximum 65536 UTF-8 bytes.')},
    inputJsonSchema:{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',maxLength:65536,description:'Input text, maximum 65536 UTF-8 bytes.'}}},
    output:{type:'object',description:'Deterministic pii.scan result.'}
  }),

  x402({
    name:'json.repair',
    title:'Purchase Conservative JSON Repair',
    description:'PAID $0.01 USDC on Base via x402. Validates JSON and repairs a limited set of formatting errors. May return supplied content. Calling this MCP tool returns a payment challenge and does not autonomously spend funds.',
    priceUsd:'0.01',
    amount:'10000',
    tags:['json', 'repair', 'validation'],
    inputSchema:{text:z.string().max(65536).describe('Input text, maximum 65536 UTF-8 bytes.')},
    inputJsonSchema:{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',maxLength:65536,description:'Input text, maximum 65536 UTF-8 bytes.'}}},
    output:{type:'object',description:'Deterministic json.repair result.'}
  }),

  x402({
    name:'prompt.audit',
    title:'Purchase Prompt Heuristic Audit',
    description:'PAID $0.01 USDC on Base via x402. Scores selected prompt structure signals using deterministic heuristics. Calling this MCP tool returns a payment challenge and does not autonomously spend funds.',
    priceUsd:'0.01',
    amount:'10000',
    tags:['prompt', 'audit', 'heuristics'],
    inputSchema:{text:z.string().max(65536).describe('Input text, maximum 65536 UTF-8 bytes.')},
    inputJsonSchema:{type:'object',required:['text'],additionalProperties:false,properties:{text:{type:'string',maxLength:65536,description:'Input text, maximum 65536 UTF-8 bytes.'}}},
    output:{type:'object',description:'Deterministic prompt.audit result.'}
  }),
  x402({
    name:'mcp.launch_audit',
    title:'MCP Launch Audit',
    description:'PAID $9.00 USDC on Base via x402. Performs bounded live MCP discovery, health, transport, schema, and receiver-only checks against a public endpoint. No payment is attempted by the audit.',
    priceUsd:'9.00', amount:'9000000', tags:['mcp','launch','audit','readiness'],
    inputSchema:{url:z.string().url().describe('Public HTTP(S) MCP service base URL to audit.')},
    inputJsonSchema:{type:'object',required:['url'],additionalProperties:false,properties:{url:{type:'string',format:'uri',description:'Public HTTP(S) MCP service base URL to audit.'}}},
    output:{type:'object',description:'Deterministic launch score, checks, findings, and pass/fail status.'}
  }),
  x402({
    name:'x402.purchase_path_audit',
    title:'x402 Purchase-Path Audit',
    description:'PAID $19.00 USDC on Base via x402. Performs a bounded no-payment purchase-challenge audit for a selected capability, validating status, requirements, destination, amount, and receiver-only controls.',
    priceUsd:'19.00', amount:'19000000', tags:['x402','purchase','audit','payments'],
    inputSchema:{url:z.string().url().describe('Public HTTP(S) x402 service base URL.'),capability:z.string().min(1).max(160).describe('Capability name whose no-payment challenge should be audited.')},
    inputJsonSchema:{type:'object',required:['url','capability'],additionalProperties:false,properties:{url:{type:'string',format:'uri',description:'Public HTTP(S) x402 service base URL.'},capability:{type:'string',minLength:1,maxLength:160,description:'Capability name whose no-payment challenge should be audited.'}}},
    output:{type:'object',description:'Purchase-path score, challenge checks, findings, and explicit no-payment status.'}
  }),
  x402({
    name:'xkey.validate',
    title:'XKEY Intake Validation',
    description:'PAID $0.10 USDC on Base via x402. Validates and normalizes one bounded XKEY intake payload. Calling this MCP tool returns the exact PAYMENT-REQUIRED challenge and does not spend funds.',
    priceUsd:'0.10', amount:'100000', tags:['xkey','validation','structured-intake'],
    inputSchema:{
      idempotency_key:z.string().min(8).max(160).regex(/^[A-Za-z0-9._:-]+$/).describe('Unique client-generated idempotency key; 8-160 ASCII characters.'),
      raw_intake:z.string().min(2).max(100000).describe('Raw intake text to validate and normalize; 2-100000 characters.')
    },
    inputJsonSchema:{type:'object',required:['idempotency_key','raw_intake'],additionalProperties:false,properties:{
      idempotency_key:{type:'string',minLength:8,maxLength:160,pattern:'^[A-Za-z0-9._:-]+'},
      raw_intake:{type:'string',minLength:2,maxLength:100000}
    }},
    output:{type:'object',description:'Validated normalized XKEY intake with shared x402 purchase, entitlement, and receipt references.'}
  })
]);

// Legacy credit redemption is intentionally not part of the current paid catalog.
// Historical credit records remain supported by the separately named compatibility path.
export const PREPAID_CAPABILITIES = Object.freeze([]);

export const PAID_CAPABILITIES =
  Object.freeze([...X402_CAPABILITIES,...PREPAID_CAPABILITIES]);

export const PAID_CAPABILITY_NAMES =
  Object.freeze(PAID_CAPABILITIES.map(x=>x.name));

export function paidCapability(name){
  return PAID_CAPABILITIES.find(x=>x.name===name) || null;
}

export function x402Capability(name){
  return X402_CAPABILITIES.find(x=>x.name===name) || null;
}

export function publicCapabilityDescriptor(cap,baseUrl,network){
  const result={
    name:cap.name,
    title:cap.title,
    description:cap.description,
    paid:true,
    rail:cap.rail,
    chargingModel:cap.chargingModel,
    inputSchema:cap.inputJsonSchema,
    output:cap.output,
    tags:cap.tags
  };

  if(cap.rail==='x402'){
    result.price={
      amountUsd:cap.priceUsd,
      amountAtomic:cap.amount,
      asset:'USDC',
      network
    };
    result.execution=
      `${String(baseUrl).replace(/\/+$/,'')}${cap.executionPath}`;
  }

  if(cap.rail==='prepaid_request_credit'){
    result.price={
      credits:cap.priceCredits
    };
    result.authentication='Bearer ck_ prepaid-credit credential';
  }

  return result;
}

export function assertPaidCatalog(){
  const names=new Set();

  for(const cap of PAID_CAPABILITIES){
    if(!cap.name || !/^[a-z0-9_.-]+$/.test(cap.name))
      throw new Error(`Invalid capability name: ${cap.name}`);

    if(names.has(cap.name))
      throw new Error(`Duplicate paid capability: ${cap.name}`);

    names.add(cap.name);

    if(!cap.title || !cap.description)
      throw new Error(`Missing discovery metadata: ${cap.name}`);

    if(!cap.inputSchema || !cap.inputJsonSchema || !cap.output)
      throw new Error(`Missing schema contract: ${cap.name}`);

    if(cap.rail==='x402'){
      if(!/^[0-9]+$/.test(cap.amount) || BigInt(cap.amount)<=0n)
        throw new Error(`Invalid x402 amount: ${cap.name}`);

      if(!/^[0-9]+\.[0-9]{2}$/.test(cap.priceUsd))
        throw new Error(`Invalid USD display price: ${cap.name}`);

      if(!cap.executionPath?.startsWith('/api/x402/'))
        throw new Error(`Invalid execution path: ${cap.name}`);
    }
  }

  if(X402_CAPABILITIES.length!==13)
    throw new Error(
      `Current v4 requires exactly 13 x402 capabilities, got ${X402_CAPABILITIES.length}`
    );

  if(PREPAID_CAPABILITIES.length!==0)
    throw new Error('Current v4 catalog must not advertise new prepaid capabilities');

  if(PAID_CAPABILITIES.length!==13)
    throw new Error(
      `Baseline requires exactly 13 paid capabilities, got ${PAID_CAPABILITIES.length}`
    );

  return true;
}

assertPaidCatalog();
