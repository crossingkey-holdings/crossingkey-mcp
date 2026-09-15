export const BASE_CHAIN_ID = '0x2105';
export const BASE_CHAIN = 'eip155:8453';
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55aeb4b4e4dc';
const DEFAULT_MIN_CONFIRMATIONS = 2n;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;

const result = (code, extra = {}) => ({
  verified: false, verificationVersion: 'ck/onchain-1', errorCode: code, ...extra
});
const address = value => String(value || '').toLowerCase();
const hexNumber = (v, field) => {
  if (typeof v !== 'string' || !/^0x[0-9a-fA-F]+$/.test(v)) throw new Error(`Malformed ${field}`);
  return BigInt(v);
};
const topicAddress = topic => {
  if (typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic)) throw new Error('Malformed indexed address');
  return `0x${topic.slice(-40)}`.toLowerCase();
};

export function parseMinConfirmations(value) {
  if (value === undefined || value === '') return DEFAULT_MIN_CONFIRMATIONS;
  if (!/^[0-9]+$/.test(String(value)) || BigInt(value) > 1000000n) throw new Error('Invalid CK_ONCHAIN_MIN_CONFIRMATIONS');
  return BigInt(value);
}

export function decodeTransfers(receipt, receiver) {
  const transfers = [];
  for (const log of Array.isArray(receipt?.logs) ? receipt.logs : []) {
    if (address(log?.address) !== address(BASE_USDC)) continue;
    try {
      if (!Array.isArray(log.topics) || log.topics.length !== 3 || address(log.topics[0]) !== TRANSFER_TOPIC || typeof log.data !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(log.data)) throw new Error('Malformed Transfer log');
      transfers.push({ payer: topicAddress(log.topics[1]), receiver: topicAddress(log.topics[2]), amountAtomic: hexNumber(log.data, 'Transfer value').toString(), logIndex: Number(log.logIndex ?? transfers.length) });
    } catch (e) { return { error: 'VERIFICATION_UNKNOWN', message: e.message }; }
  }
  return { transfers, matching: transfers.filter(x => x.receiver === address(receiver)) };
}

async function rpc(url, method, params, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (!body || body.jsonrpc !== '2.0' || body.error) throw new Error(body?.error?.message || 'Invalid JSON-RPC response');
    return body.result;
  } finally { clearTimeout(timer); }
}

export async function verifyOnchain({txHash, receiptId, expected = {}, receiver, rpcUrl, fallbackRpcUrl, minConfirmations, timeoutMs = 8000, fetchImpl = fetch, getReceipt, bindProof}) {
  if (!txHash && !receiptId) return result('MISSING_VERIFICATION_TARGET');
  if (txHash !== undefined && (!HASH_RE.test(String(txHash)))) return result('MALFORMED_TX_HASH');
  if (receiptId !== undefined && (!/^ck_[A-Za-z0-9_-]{8,200}$/.test(String(receiptId)))) return result('MALFORMED_RECEIPT_ID');
  let stored = receiptId && getReceipt ? getReceipt(receiptId) : null;
  if (receiptId && !stored) return result('RECEIPT_NOT_FOUND', {receiptId});
  const storedHash = stored?.payment?.transaction || stored?.payment?.txHash;
  if (txHash && storedHash && address(txHash) !== address(storedHash)) return result('RECEIPT_MISMATCH', {txHash, receiptId});
  txHash = txHash || storedHash;
  if (!txHash) return result('RECEIPT_MISMATCH', {receiptId, verificationVersion:'ck/onchain-1'});
  const expectedAmount = expected.amountAtomic || stored?.payment?.amount;
  const expectedReceiver = receiver || expected.receiver || stored?.payment?.payTo;
  const expectedNetwork = expected.network || stored?.payment?.network;
  const expectedToken = expected.token || stored?.payment?.asset;
  const expectedPayer = expected.payer || stored?.payment?.payer || stored?.holder;
  if (stored?.payment?.payTo && receiver && address(stored.payment.payTo) !== address(receiver)) return result('RECEIPT_MISMATCH', {txHash, receiptId});
  if (expectedNetwork && expectedNetwork !== BASE_CHAIN && expectedNetwork !== 'base') return result('RECEIPT_MISMATCH', {txHash, receiptId, network:BASE_CHAIN});
  if (expectedToken && address(expectedToken) !== address(BASE_USDC)) return result('RECEIPT_MISMATCH', {txHash, receiptId, asset:{contract:BASE_USDC}});
  if (!expectedReceiver) return result('VERIFICATION_UNKNOWN', {txHash, receiptId, message:'Receiver is not configured'});
  const urls = [rpcUrl, fallbackRpcUrl].filter(Boolean); if (!urls.length) return result('RPC_UNAVAILABLE', {txHash, receiptId});
  const observations = [];
  for (const url of urls) {
    try {
      const chain = await rpc(url, 'eth_chainId', [], timeoutMs, fetchImpl); if (chain !== BASE_CHAIN_ID) { observations.push({url, code:'WRONG_CHAIN'}); continue; }
      const tx = await rpc(url, 'eth_getTransactionReceipt', [txHash], timeoutMs, fetchImpl); if (!tx) { observations.push({url, code:'TX_NOT_FOUND'}); continue; }
      if (tx.status !== '0x1') { observations.push({url, code:'TX_REVERTED'}); continue; }
      const decoded = decodeTransfers(tx, expectedReceiver); if (decoded.error) { observations.push({url, code:decoded.error}); continue; }
      let candidates = decoded.matching; if (expectedPayer) candidates = candidates.filter(x => x.payer === address(expectedPayer)); if (expectedAmount) candidates = candidates.filter(x => x.amountAtomic === String(expectedAmount));
      if (candidates.length !== 1) { observations.push({url, code: candidates.length ? 'VERIFICATION_UNKNOWN' : (expectedAmount ? 'WRONG_AMOUNT' : 'NO_USDC_TRANSFER')}); continue; }
      const block = hexNumber(tx.blockNumber, 'receipt block'); const head = hexNumber(await rpc(url, 'eth_blockNumber', [], timeoutMs, fetchImpl), 'current block'); if (head < block) { observations.push({url, code:'VERIFICATION_UNKNOWN'}); continue; }
      const confirmations = head - block + 1n; let minimum; try { minimum=parseMinConfirmations(minConfirmations); } catch { return result('INVALID_CONFIGURATION',{txHash,receiptId}); } const proof = {verified: confirmations >= minimum, verificationVersion:'ck/onchain-1', errorCode: confirmations >= minimum ? undefined : 'INSUFFICIENT_CONFIRMATIONS', network:BASE_CHAIN, chainId:8453, txHash, blockNumber:block.toString(), confirmations:confirmations.toString(), transactionSuccess:true, asset:{symbol:'USDC',contract:BASE_USDC}, payment:{payer:candidates[0].payer,receiver:candidates[0].receiver,receiverMatch:true,amountAtomic:candidates[0].amountAtomic,amountMatch:expectedAmount ? candidates[0].amountAtomic === String(expectedAmount) : null,payerMatch:expectedPayer ? candidates[0].payer === address(expectedPayer) : null}, receiptId:receiptId || undefined, purchaseId:stored?.purchaseId ?? null, entitlementId:stored?.entitlementId ?? null, capability:stored?.capability ?? null, purchaseMatch:receiptId ? true : null, entitlementMatch:receiptId ? true : null, receiptMatch:receiptId ? true : null, source:{baseRpc:'used',fallbackRpc:url === fallbackRpcUrl ? 'used' : fallbackRpcUrl ? 'not_used' : 'not_configured',explorer:'not_used'} };
      observations.push({url, proof});
    } catch (e) { observations.push({url, code:'RPC_UNAVAILABLE', message:e.name === 'AbortError' ? 'RPC timeout' : e.message.slice(0,160)}); }
  }
  const proofs = observations.filter(x => x.proof).map(x => x.proof); const comparable = p => { const copy = {...p}; delete copy.source; return JSON.stringify(copy); }; if (proofs.length > 1 && comparable(proofs[0]) !== comparable(proofs[1])) return result('RPC_INCONSISTENT', {txHash, receiptId, source:{baseRpc:'inconsistent',fallbackRpc:'used',explorer:'not_used'}});
  const found = proofs[0]; if (!found) return result(observations[0]?.code || 'VERIFICATION_UNKNOWN', {txHash, receiptId, source:{baseRpc:'failed',fallbackRpc:observations.length>1?'failed':'not_configured',explorer:'not_used'}});
  if (bindProof && receiptId) bindProof(receiptId, found);
  return found;
}
