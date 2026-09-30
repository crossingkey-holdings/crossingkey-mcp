import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExternalEffectAdapter } from './harness/external-effect-adapter.mjs';
import { EFFECT_CONFIRMED, EFFECT_NOT_OBSERVED, EFFECT_UNKNOWN, validateEffectWitness } from '../lib/recovery/external-effect-witness.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ck-witness-'));
const file=path.join(dir,'provider.json');
const adapter=createExternalEffectAdapter(file);
const operation='ck-operation-stable-1';
adapter.execute(operation,{message:'crossingkey-recovery'});
const confirmed=validateEffectWitness(adapter.reconcile(operation));
if(confirmed.outcome!==EFFECT_CONFIRMED||adapter.count(operation)!==1) throw new Error('confirmed witness invariant failed');
const absent=createExternalEffectAdapter(path.join(dir,'absent.json'),{mode:'not_observed'});
if(validateEffectWitness(absent.reconcile('never-started')).outcome!==EFFECT_NOT_OBSERVED) throw new Error('not-observed witness invariant failed');
const unknown=createExternalEffectAdapter(path.join(dir,'unknown.json'),{mode:'unknown'});
if(validateEffectWitness(unknown.reconcile('ambiguous')).outcome!==EFFECT_UNKNOWN) throw new Error('unknown witness invariant failed');
console.log(JSON.stringify({status:'FRESH_EXECUTION',test_infrastructure:'TEST_ONLY',confirmed:confirmed.outcome,not_observed:EFFECT_NOT_OBSERVED,unknown:EFFECT_UNKNOWN,effect_count:adapter.count(operation),verdict:'PASS'}));
