import {FREE_DISCOVERY_TOOL_NAMES,PAID_TOOL_NAMES} from '../lib/mcp-manifest.mjs';

const FORBIDDEN_TOOL_PATTERNS=/(^|\.)(payment|purchase|settle|checkout|credit|entitlement|receipt|x402)(\.|$)/i;
// Read-only exceptions to the forbidden-pattern heuristic: tools that are
// free, non-mutating discovery despite matching a forbidden substring.
const PROOF_SAFE_EXCEPTIONS=new Set(['credits.options']);

export function validateProofAllowlist(allowlist) {
  if(!Array.isArray(allowlist)||allowlist.length!==FREE_DISCOVERY_TOOL_NAMES.length||new Set(allowlist).size!==allowlist.length) throw new Error(`Proof allowlist must contain exactly the ${FREE_DISCOVERY_TOOL_NAMES.length} free discovery tools.`);
  for(const name of allowlist){
    if(!FREE_DISCOVERY_TOOL_NAMES.includes(name)||PAID_TOOL_NAMES.includes(name)||(FORBIDDEN_TOOL_PATTERNS.test(name)&&!PROOF_SAFE_EXCEPTIONS.has(name))) throw new Error(`Unsafe proof tool allowlist entry: ${name}`);
  }
  return true;
}

export const ZERO_SPEND_PROOF_ALLOWLIST=Object.freeze([...FREE_DISCOVERY_TOOL_NAMES]);

export function buildProofRequest({apiKey,serverUrl='https://mcp.crossingkeyintelligence.com/mcp'}={}) {
  validateProofAllowlist(ZERO_SPEND_PROOF_ALLOWLIST);
  if(!apiKey) throw new Error('OPENAI_API_KEY is required only when the live proof is explicitly enabled.');
  return {model:process.env.OPENAI_PROOF_MODEL||'gpt-5.6',tools:[{type:'mcp',server_label:'crossingkey',server_description:'CrossingKey commercial discovery; stop before payment or execution.',server_url:serverUrl,allowed_tools:ZERO_SPEND_PROOF_ALLOWLIST,require_approval:'always'}],input:'Discover a relevant CrossingKey capability, check requirements, estimate cost, preview the result, run execution preflight, then STOP_BEFORE_PAYMENT. Do not purchase, pay, sign, transfer, spend, create an entitlement, or execute.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  validateProofAllowlist(ZERO_SPEND_PROOF_ALLOWLIST);
  if(process.env.RUN_OPENAI_PROOF!=='1'){
    console.log('OPENAI_PROOF_READY');
    console.log(JSON.stringify({serverUrl:'https://mcp.crossingkeyintelligence.com/mcp',allowedTools:ZERO_SPEND_PROOF_ALLOWLIST,stopState:'STOPPED_BEFORE_PAYMENT'}));
    process.exit(0);
  }
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey) throw new Error('RUN_OPENAI_PROOF=1 requires OPENAI_API_KEY in the environment.');
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify(buildProofRequest({apiKey}))});
  const body=await response.json();
  if(!response.ok) throw new Error(`OpenAI proof failed with HTTP ${response.status}`);
  const calls=(body.output||[]).filter(item=>item.type==='mcp_call');
  if(calls.some(item=>!FREE_DISCOVERY_TOOL_NAMES.includes(item.name))) throw new Error('OpenAI proof attempted a non-free tool.');
  console.log(JSON.stringify({status:'STOPPED_BEFORE_PAYMENT',mcpCalls:calls.map(item=>item.name),responseId:body.id||null}));
}
