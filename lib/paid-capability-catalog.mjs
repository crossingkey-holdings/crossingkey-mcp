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
  })
]);

export const PREPAID_CAPABILITIES = Object.freeze([
  Object.freeze({
    name:'xkey.validate',
    title:'Validate structured XKEY intake',
    description:'PAID prepaid-credit XKEY intake validation. Requires an authenticated ck_ principal and commits one credit only on verified success. Discovery is free; execution is not.',
    rail:'prepaid_request_credit',
    chargingModel:'prepaid_credit',
    priceCredits:1,
    public:true,
    paid:true,
    tags:Object.freeze(['xkey','validation','structured-intake']),
    inputSchema:{
      idempotency_key:z.string()
        .min(8).max(160)
        .regex(/^[A-Za-z0-9._:-]+$/)
        .describe('Unique client-generated idempotency key; 8-160 ASCII characters.'),
      raw_intake:z.string()
        .min(2).max(100000)
        .describe('Raw intake text to validate and normalize; 2-100000 characters.')
    },
    inputJsonSchema:Object.freeze({
      type:'object',
      required:['idempotency_key','raw_intake'],
      additionalProperties:false,
      properties:{
        idempotency_key:{
          type:'string',
          minLength:8,
          maxLength:160,
          pattern:'^[A-Za-z0-9._:-]+$'
        },
        raw_intake:{
          type:'string',
          minLength:2,
          maxLength:100000
        }
      }
    }),
    output:Object.freeze({
      type:'object',
      description:'Validated normalized XKEY intake plus paid execution receipt information.'
    })
  })
]);

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

  if(X402_CAPABILITIES.length!==5)
    throw new Error(
      `Baseline requires exactly 5 x402 capabilities, got ${X402_CAPABILITIES.length}`
    );

  if(PREPAID_CAPABILITIES.length!==1 ||
     PREPAID_CAPABILITIES[0].name!=='xkey.validate')
    throw new Error('Baseline requires xkey.validate as the sole prepaid capability');

  if(PAID_CAPABILITIES.length!==6)
    throw new Error(
      `Baseline requires exactly 6 paid capabilities, got ${PAID_CAPABILITIES.length}`
    );

  return true;
}

assertPaidCatalog();
