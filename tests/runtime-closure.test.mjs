import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const MANIFEST=path.join(ROOT,'release/runtime-files-v2.4-marketplace.txt');

const imports=[
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g,
  /import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g,
];

function resolveLocal(parent,spec){
  const raw=path.resolve(parent,spec);
  assert.ok(raw===ROOT || raw.startsWith(ROOT+path.sep),`runtime import escapes repository: ${spec}`);
  const candidates=path.extname(raw)
    ? [raw]
    : [raw,`${raw}.mjs`,`${raw}.js`,path.join(raw,'index.mjs'),path.join(raw,'index.js')];
  const hit=candidates.find(x=>fs.existsSync(x) && fs.statSync(x).isFile());
  assert.ok(hit,`unresolved local runtime import: ${spec}`);
  return hit;
}

function expectedClosure(){
  const queue=[path.join(ROOT,'server.mjs')];
  const seen=new Set();
  while(queue.length){
    const file=queue.shift();
    const rel=path.relative(ROOT,file).split(path.sep).join('/');
    if(seen.has(rel)) continue;
    seen.add(rel);
    if(!/\.(?:mjs|js|cjs)$/.test(file)) continue;
    const source=fs.readFileSync(file,'utf8');
    for(const pattern of imports){
      pattern.lastIndex=0;
      for(const match of source.matchAll(pattern)){
        const child=resolveLocal(path.dirname(file),match[1]);
        const childRel=path.relative(ROOT,child).split(path.sep).join('/');
        if(!seen.has(childRel)) queue.push(child);
      }
    }
  }
  return seen;
}

test('runtime manifest exactly matches reconciled local import closure',()=>{
  assert.ok(fs.existsSync(MANIFEST),'runtime manifest missing');
  const lines=fs.readFileSync(MANIFEST,'utf8').split(/\r?\n/).filter(Boolean);
  const actual=new Set(lines);
  assert.equal(actual.size,lines.length,'runtime manifest contains duplicates');

  for(const rel of lines){
    assert.ok(!path.isAbsolute(rel),`absolute runtime path forbidden: ${rel}`);
    assert.ok(!rel.startsWith('../') && !rel.includes('/../'),`path traversal forbidden: ${rel}`);
    assert.ok(fs.existsSync(path.join(ROOT,rel)),`manifest file missing: ${rel}`);
  }

  const expected=expectedClosure();
  assert.deepEqual([...actual].sort(),[...expected].sort());

  for(const required of [
    'server.mjs',
    'lib/machine-commerce.mjs',
    'lib/discovery.mjs',
    'lib/onchain-verifier.mjs',
    'lib/marketplace.mjs',
    'lib/marketplace-adapters.mjs',
    'lib/marketplace-storage.mjs',
    'lib/marketplace-tools.mjs'
  ]) assert.ok(actual.has(required),`runtime manifest missing ${required}`);
});
