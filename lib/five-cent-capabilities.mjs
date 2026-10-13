import crypto from 'node:crypto';

const MAX_BYTES = 65536;
const byteLength = value => Buffer.byteLength(value, 'utf8');
function boundedText(input, key = 'text') {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input[key] !== 'string') throw new TypeError(`${key} must be a string`);
  if (byteLength(input[key]) > MAX_BYTES) throw new RangeError(`${key} exceeds ${MAX_BYTES} UTF-8 bytes`);
  return input[key];
}
function positions(text, pattern, type, max = 100) {
  const matches = [];
  for (const match of text.matchAll(pattern)) {
    if (matches.length >= max) break;
    matches.push({ type, start: match.index, end: match.index + match[0].length });
  }
  return matches;
}
const sortFindings = findings => findings.sort((a, b) => a.start - b.start || a.end - b.end || a.type.localeCompare(b.type));
function summarize(capability, findings) {
  const counts = {};
  for (const item of findings) counts[item.type] = (counts[item.type] || 0) + 1;
  return { capability, count: findings.length, counts, findings };
}
export function hashEncode(input) {
  const text = boundedText(input);
  return { capability: 'hash.encode', algorithm: 'sha256', encoding: 'hex', bytes: byteLength(text), digest: crypto.createHash('sha256').update(text, 'utf8').digest('hex') };
}
export function secretScan(input) {
  const text = boundedText(input);
  const findings = [
    ...positions(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'private_key_header'),
    ...positions(text, /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, 'aws_access_key_id'),
    ...positions(text, /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, 'github_token'),
    ...positions(text, /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, 'api_key_candidate'),
    ...positions(text, /\b(?:password|api[_-]?key|secret|token)\s*[:=]\s*["']?[^\s"',;]{8,}/gi, 'credential_assignment')
  ];
  return summarize('secret.scan', sortFindings(findings).slice(0, 100));
}
export function piiScan(input) {
  const text = boundedText(input);
  const findings = [
    ...positions(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'email'),
    ...positions(text, /\b\d{3}-\d{2}-\d{4}\b/g, 'ssn_format'),
    ...positions(text, /(?<!\d)(?:\+1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)/g, 'north_american_phone')
  ];
  return summarize('pii.scan', sortFindings(findings).slice(0, 100));
}
export function jsonRepair(input) {
  const text = boundedText(input);
  try { const value = JSON.parse(text); return { capability: 'json.repair', repaired: false, json: JSON.stringify(value), changes: [] }; }
  catch { /* bounded, conservative transformations only */ }
  let candidate = text;
  const changes = [];
  const withoutFence = candidate.match(/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (withoutFence) { candidate = withoutFence[1]; changes.push('removed_code_fence'); }
  const withoutTrailingComma = candidate.replace(/,\s*(?=[}\]])/g, '');
  if (withoutTrailingComma !== candidate) { candidate = withoutTrailingComma; changes.push('removed_trailing_comma'); }
  try { return { capability: 'json.repair', repaired: changes.length > 0, json: JSON.stringify(JSON.parse(candidate)), changes }; }
  catch { return { capability: 'json.repair', repaired: false, valid: false, error: 'unsupported_or_invalid_json', changes: [] }; }
}
export function promptAudit(input) {
  const text = boundedText(input);
  const findings = [];
  if (text.trim().length < 30) findings.push({ code: 'SHORT_PROMPT', recommendation: 'Describe the task and expected result in more detail.' });
  if (!/\b(?:output|return|format|json|table|list|respond)\b/i.test(text)) findings.push({ code: 'OUTPUT_FORMAT_UNSPECIFIED', recommendation: 'Specify the required output format.' });
  if (!/\b(?:must|should|avoid|never|only|limit|maximum|at most|constraint)\b/i.test(text)) findings.push({ code: 'CONSTRAINTS_UNSPECIFIED', recommendation: 'State important limits and exclusions.' });
  if (!/\b(?:example|sample|e\.g\.|for instance)\b/i.test(text)) findings.push({ code: 'NO_EXAMPLES', recommendation: 'Include an example when precision matters.' });
  return { capability: 'prompt.audit', score: Math.max(0, 100 - 20 * findings.length), findings, method: 'deterministic_heuristics_v1' };
}
export const CAPABILITY_EXECUTORS = Object.freeze({
  'hash.encode': hashEncode,
  'secret.scan': secretScan,
  'pii.scan': piiScan,
  'json.repair': jsonRepair,
  'prompt.audit': promptAudit
});
export function executeFiveCentCapability(name, input) {
  const fn = Object.hasOwn(CAPABILITY_EXECUTORS, name) ? CAPABILITY_EXECUTORS[name] : null;
  if (!fn) throw new Error('Unknown capability');
  return fn(input);
}
