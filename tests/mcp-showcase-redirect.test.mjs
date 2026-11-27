import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../server-runtime.mjs', import.meta.url), 'utf8');
const routeStart = source.indexOf("app.get('/mcp',async(req,res)=>{");
const routeEnd = source.indexOf("app.delete('/mcp'", routeStart);
const browserGetRoute = source.slice(routeStart, routeEnd);

test('sessionless browser GET to /mcp redirects to the Exchange showcase', () => {
  assert.ok(routeStart >= 0, 'GET /mcp route exists');
  assert.match(browserGetRoute, /if\(!t\)\{/);
  assert.match(browserGetRoute, /Cache-Control','no-store/);
  assert.match(browserGetRoute, /res\.redirect\(302,'https:\/\/crossingkeyintelligence\.com\/mcp\/'\)/);
});

test('MCP protocol methods remain available and session-bound', () => {
  assert.match(source, /app\.post\('\/mcp',async\(req,res\)=>\{/);
  assert.match(browserGetRoute, /if\(!sessionAuthorizationMatches\(sid,req\)\)/);
  assert.match(browserGetRoute, /await t\.handleRequest\(req,res\)/);
  assert.match(source, /app\.delete\('\/mcp',async\(req,res\)=>\{/);
});
