import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EFFECT_CONFIRMED, EFFECT_NOT_OBSERVED, EFFECT_UNKNOWN } from '../../lib/recovery/external-effect-witness.mjs';

// TEST INFRASTRUCTURE ONLY. This models an independent provider ledger; it is
// not a CrossingKey state store and is never used by production startup.
export function createExternalEffectAdapter(file, { mode='normal' } = {}) {
  const read=()=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code==='ENOENT')return {effects:{},counts:{}};throw e;}};
  const write=s=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(s));fs.renameSync(tmp,file);};
  function execute(operationId,input){
    const s=read();
    if(s.effects[operationId]) return {...s.effects[operationId],duplicate:true};
    const result={operationId,message:String(input?.message||''),sha256:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex')};
    s.effects[operationId]={operationId,result};s.counts[operationId]=(s.counts[operationId]||0)+1;write(s);return {...s.effects[operationId],duplicate:false};
  }
  function reconcile(operationId){
    if(mode==='unknown') return {outcome:EFFECT_UNKNOWN};
    const s=read();
    if(s.effects[operationId]) return {outcome:EFFECT_CONFIRMED,evidence:s.effects[operationId]};
    if(mode==='not_observed') return {outcome:EFFECT_NOT_OBSERVED,evidence:{authoritative:true,operationId}};
    return {outcome:EFFECT_UNKNOWN};
  }
  function count(operationId){return read().counts[operationId]||0;}
  return {execute,reconcile,count};
}
