import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const tools=fs.readFileSync('lib/marketplace-tools.mjs','utf8');
const store=fs.readFileSync('lib/marketplace.mjs','utf8');
const runtime=fs.readFileSync('server-runtime.mjs','utf8');
test('anonymous public intake distinct from admin-only registration',()=>{
 assert.match(tools,/adminOnly=new Set\(\['provider\.register'/);
 assert.match(tools,/add\('provider\.apply'/);
 assert.match(tools,/add\('provider\.register'[^\n]*requireAdmin:true/);
 assert.match(store,/if\(requireAdmin\)admin\(principal\)/);
 assert.match(store,/status:'pending'/);
});
test('pending duplicate contact and slug checks exist',()=>{
 assert.match(store,/x\.slug===p\.slug\|\|\(!requireAdmin&&x\.contact===p\.contact&&x\.status==='pending'\)/);
});
test('intake limiter includes both tools',()=>{
 assert.match(runtime,/\['provider\.apply','provider\.register','creator\.apply','capability\.register'\]/);
});
test('in-memory rate limiter rejects excessive requests and resets window',()=>{
 const match=tools.match(/export function createRateLimit\([\s\S]*?\n\}/);
 assert.ok(match);
 const context=vm.createContext({Map,Date,Error});
 const limiter=vm.runInContext('('+match[0].replace('export ','')+')',context)({max:2,windowMs:60000,maxKeys:2});
 limiter('a');limiter('a');assert.throws(()=>limiter('a'),/RATE_LIMITED/);
 limiter('b');assert.throws(()=>limiter('c'),/RATE_LIMITED/);
});
