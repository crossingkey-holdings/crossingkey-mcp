import fs from 'node:fs';
import path from 'node:path';
import { readState, withProcessLock } from '../gate1b-store.mjs';
import { EFFECT_CONFIRMED, EFFECT_NOT_OBSERVED, EFFECT_UNKNOWN, validateEffectWitness, executionIdentity } from './external-effect-witness.mjs';

const TERMINAL = new Set(['fulfilled', 'failed', 'resolved']);

export function scanRecoverableOperations(dataFile) {
  const state = readState(dataFile);
  return Object.entries(state.idempotency || {}).map(([idempotencyKey, record]) => {
    const tx = record?.gate1b;
    const stateName = tx?.state || (record?.response ? 'fulfilled' : 'unknown');
    let disposition = 'REMAIN_EXECUTION_UNKNOWN';
    if (TERMINAL.has(stateName) || record?.response) disposition = 'ALREADY_TERMINAL';
    else if (stateName === 'settlement_unknown' || stateName === 'unresolved') disposition = 'RECONCILE_EXTERNAL_EFFECT';
    else if (stateName === 'pending_fulfillment') disposition = 'SAFE_TO_RESUME';
    else if (stateName === 'finalization_pending' && tx?.durableResult?.verified === true) disposition = 'FINALIZE_LOCAL_STATE';
    else if (stateName === 'executing' || stateName === 'execution_unknown') disposition = 'REMAIN_EXECUTION_UNKNOWN';
    return { idempotencyKey, state: stateName, disposition, purchaseId: tx?.purchaseId || null, executionId: tx?.owner?.token || null, settlementId: tx?.settlement?.transaction || null, receiptId: tx?.receiptId || null, hasResponse: Boolean(record?.response), hasReceipt: Boolean(tx?.receiptId && state.receipts?.[tx.receiptId]) };
  });
}

export async function recoverInterruptedOperations({ dataFile, reconcileSettlement, finalizeLocalState, reconcileExecutionEffect, resumeSafeOperation }) {
  const operations = scanRecoverableOperations(dataFile);
  const finalizationResults = new Map();
  // The canonical finalizer owns the store lock because it is the same
  // Gate1B authority used by normal invocation. Do not nest a recovery lock
  // around it.
  if (typeof finalizeLocalState === 'function') {
    for (const operation of operations.filter(x => x.disposition === 'FINALIZE_LOCAL_STATE')) {
      finalizationResults.set(operation.idempotencyKey, await finalizeLocalState(operation.idempotencyKey));
    }
  }
  return withProcessLock(dataFile, async () => {
    const results = [];
    for (const operation of operations) {
      if (operation.disposition === 'FINALIZE_LOCAL_STATE') {
        if (typeof finalizeLocalState !== 'function') {
          results.push({ ...operation, action: 'FINALIZATION_REQUIRES_CANONICAL_RECEIPT_FINALIZER' });
        } else {
          const finalized = finalizationResults.get(operation.idempotencyKey);
          results.push({ ...operation, ...finalized });
        }
        continue;
      }
      if (operation.disposition === 'REMAIN_EXECUTION_UNKNOWN' && typeof reconcileExecutionEffect === 'function') {
        const witness=validateEffectWitness(await reconcileExecutionEffect({idempotencyKey:operation.idempotencyKey,executionIdentity:operation.executionId}));
        if(witness.outcome===EFFECT_CONFIRMED){
          results.push({...operation,action:'EFFECT_CONFIRMED_REQUIRES_CANONICAL_RESULT_RECONSTRUCTION',witness});
        } else if(witness.outcome===EFFECT_NOT_OBSERVED && typeof resumeSafeOperation==='function'){
          results.push({...operation,action:'SAFE_TO_RESUME_REQUIRES_PRECONDITION_REVALIDATION',witness});
        } else {
          results.push({...operation,action:'REMAIN_EXECUTION_UNKNOWN',witness});
        }
        continue;
      }
      if (operation.disposition !== 'RECONCILE_EXTERNAL_EFFECT' || typeof reconcileSettlement !== 'function') {
        results.push({ ...operation, action: 'NO_AUTOMATIC_MUTATION' });
        continue;
      }
      const proof = await reconcileSettlement(operation);
      results.push({ ...operation, action: proof?.outcome === 'settled' ? 'EXTERNAL_EFFECT_RECONCILED_REQUIRES_CANONICAL_FINALIZATION' : 'REMAIN_EXECUTION_UNKNOWN', proof: proof || null });
    }
    return results;
  });
}
