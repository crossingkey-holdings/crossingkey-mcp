import {z} from 'zod';

export const DELIVERY_TYPES = ['mcp_tool','api','digital_asset','workflow','service','dataset','content','software','other'];
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/);
export const atomic = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const network = z.enum(['eip155:8453','eip155:84532']);
const text = z.string().min(1).max(2000);
export const rightsSchema = z.object({
  ownershipRepresentation: text,
  distributionPermission: z.literal(true), commercializationPermission: z.literal(true),
  aiTrainingPermission: z.boolean().default(false), derivativePermission: z.boolean().default(false),
  revocationPolicy: text, affirmed: z.literal(true)
}).strict();
export const providerSchema = z.object({displayName:z.string().min(1).max(120),slug:id,description:text,
  website:z.string().url().max(500).optional(),contact:z.string().min(3).max(300)}).strict();
export const capabilitySchema = z.object({providerId:id,name:id,slug:id,description:text,category:id,
  version:z.string().regex(/^\d+\.\d+\.\d+$/),inputSchema:z.record(z.unknown()),outputSchema:z.record(z.unknown()),
  deliveryType:z.enum(DELIVERY_TYPES),executionEndpoint:z.string().url().max(500).optional(),
  price:atomic.refine(x=>BigInt(x)>0n),currency:z.literal('USDC'),network,license:text,
  visibility:z.enum(['public','private']).default('private'),rights:rightsSchema,
  contentHash:z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
  sourceProvenance:z.string().min(1).max(1000)
}).strict();

export function boundedJson(value, maxBytes=65536) {
  const encoded=JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded)>maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  let nodes=0;
  function walk(v,depth) {
    if (++nodes>4000 || depth>16) throw new Error('PAYLOAD_TOO_LARGE');
    if (v && typeof v==='object') for (const [key,item] of Object.entries(v)) {
      if (['__proto__','constructor','prototype'].includes(key)) throw new Error('INVALID_INPUT');
      walk(item,depth+1);
    }
  }
  walk(value,0); return value;
}

// Deliberately small JSON Schema subset, not a permissive incomplete general validator.
// Unsupported keywords, remote refs and regexes are rejected at registration.
export function validateSchema(schema, depth=0) {
  boundedJson(schema,16384);
  if(depth>6 || !schema || typeof schema!=='object' || Array.isArray(schema)) throw new Error('INVALID_SCHEMA');
  const allowed=['type','description','properties','required','additionalProperties','items','maxItems','minItems','maxLength','minLength','minimum','maximum','enum'];
  if(Object.keys(schema).some(k=>!allowed.includes(k))) throw new Error('UNSUPPORTED_SCHEMA_KEYWORD');
  if(!['object','array','string','number','integer','boolean','null'].includes(schema.type)) throw new Error('INVALID_SCHEMA');
  if(schema.description!==undefined && (typeof schema.description!=='string'||schema.description.length>2000)) throw new Error('INVALID_SCHEMA');
  if(schema.enum && (!Array.isArray(schema.enum)||schema.enum.length>50||schema.enum.some(x=>x!==null&&typeof x==='object'))) throw new Error('INVALID_SCHEMA');
  for(const key of ['minimum','maximum','maxLength','minLength','maxItems','minItems']) if(schema[key]!==undefined && (!Number.isFinite(schema[key])||(['maxLength','minLength','maxItems','minItems'].includes(key)&&(!Number.isInteger(schema[key])||schema[key]<0)))) throw new Error('INVALID_SCHEMA');
  if(schema.type==='object') {
    if(schema.additionalProperties!==false||!schema.properties||typeof schema.properties!=='object'||Array.isArray(schema.properties)||Object.keys(schema.properties).length>100) throw new Error('INVALID_SCHEMA');
    if(schema.required && (!Array.isArray(schema.required)||schema.required.some(k=>typeof k!=='string'||!Object.hasOwn(schema.properties,k)))) throw new Error('INVALID_SCHEMA');
    Object.values(schema.properties).forEach(x=>validateSchema(x,depth+1));
  }
  if(schema.type==='array') {
    if(!Number.isInteger(schema.maxItems)||schema.maxItems<0||schema.maxItems>1000) throw new Error('INVALID_SCHEMA');
    validateSchema(schema.items,depth+1);
  }
  if(schema.type==='string'&&(!Number.isInteger(schema.maxLength)||schema.maxLength>32768||schema.maxLength<0)) throw new Error('INVALID_SCHEMA');
  return schema;
}

export function validateValue(schema,value) {
  let valid=true;
  if(schema.enum&&!schema.enum.some(x=>Object.is(x,value))) valid=false;
  if(schema.type==='null') valid &&= value===null;
  if(schema.type==='boolean') valid &&= typeof value==='boolean';
  if(['integer','number'].includes(schema.type)) valid &&= typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isInteger(value))&&(schema.minimum===undefined||value>=schema.minimum)&&(schema.maximum===undefined||value<=schema.maximum);
  if(schema.type==='string') valid &&= typeof value==='string'&&value.length<=schema.maxLength&&value.length>=(schema.minLength||0);
  if(schema.type==='array') {
    valid &&= Array.isArray(value)&&value.length<=schema.maxItems&&value.length>=(schema.minItems||0);
    if(valid) value.forEach(x=>validateValue(schema.items,x));
  }
  if(schema.type==='object') {
    valid &&= !!value&&typeof value==='object'&&!Array.isArray(value);
    if(valid) {
      valid &&= Object.keys(value).every(k=>Object.hasOwn(schema.properties,k))&&(schema.required||[]).every(k=>Object.hasOwn(value,k));
      if(valid) Object.entries(value).forEach(([k,v])=>validateValue(schema.properties[k],v));
    }
  }
  if(!valid) throw new Error('SCHEMA_VALIDATION_FAILED');
}

export function splitAmount(amount,bps) {
  atomic.parse(amount);
  if(!Number.isInteger(bps)||bps<0||bps>10000) throw new Error('INVALID_FEE_BPS');
  const gross=BigInt(amount),platform=gross*BigInt(bps)/10000n,provider=gross-platform;
  if(platform+provider!==gross) throw new Error('ALLOCATION_MISMATCH');
  return {grossAmount:String(gross),platformAmount:String(platform),providerAmount:String(provider)};
}
