export const EFFECT_CONFIRMED='EFFECT_CONFIRMED';
export const EFFECT_NOT_OBSERVED='EFFECT_NOT_OBSERVED';
export const EFFECT_UNKNOWN='EFFECT_UNKNOWN';

export function validateEffectWitness(result){
  if(!result||typeof result!=='object') throw new Error('Execution witness must be an object');
  if(![EFFECT_CONFIRMED,EFFECT_NOT_OBSERVED,EFFECT_UNKNOWN].includes(result.outcome)) throw new Error('Invalid execution witness outcome');
  if(result.outcome===EFFECT_UNKNOWN && result.evidence) throw new Error('Unknown witness cannot claim authoritative evidence');
  return result;
}

export function executionIdentity(tx){
  return tx?.executionIdentity || tx?.owner?.token || tx?.context?.executionIdentity || tx?.context?.idempotencyKey || null;
}
