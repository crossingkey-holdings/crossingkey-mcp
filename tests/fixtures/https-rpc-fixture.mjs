import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

function makeTlsMaterial(dir) {
  const key = path.join(dir, 'fixture-key.pem');
  const cert = path.join(dir, 'fixture-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), ca: fs.readFileSync(cert) };
}

export async function startHttpsRpcFixture({ chainId = '0x2105', blockNumber = '0x20', responseMode = 'normal', delayMs = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossingkey-rpc-fixture-'));
  const tls = makeTlsMaterial(dir);
  const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (delayMs) { setTimeout(() => handle(), delayMs); return; }
      handle();
    });
    function handle() {
      if(req.url==='/verify') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({isValid:true})); return; }
      if(req.url==='/settle') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({success:true,transaction:'fixture-settlement'})); return; }
      let request;
      try { request = JSON.parse(body); } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'malformed_json' })); return; }
      if (responseMode === 'malformed') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{not-json'); return; }
      if (responseMode === 'invalid-envelope') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '1.0', id: request.id, result: '0x20' })); return; }
      if (responseMode === 'error') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'fixture_error' } })); return; }
      if (responseMode === 'http-failure') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture_unavailable' })); return; }
      const result = request.method === 'eth_chainId' ? chainId : request.method === 'eth_blockNumber' ? blockNumber : null;
      if (result === null) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method_not_found' } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  const url = `https://localhost:${address.port}`;
  return {
    url,
    ca: tls.ca,
    certPath: path.join(dir, 'fixture-cert.pem'),
    port: address.port,
    async close() { server.closeAllConnections?.(); await new Promise(resolve => server.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

export function createFixtureFetch(fixture, delegate) {
  return async (url, init = {}) => {
    if (!String(url).startsWith(fixture.url)) return delegate(url, init);
    const target = new URL(url);
    return new Promise((resolve, reject) => {
      const headers = { ...(init.headers || {}), connection: 'close' };
      const request = https.request({ hostname: '127.0.0.1', port: fixture.port, path: target.pathname || '/', method: init.method || 'POST', headers, ca: fixture.ca, servername: 'localhost', rejectUnauthorized: true, agent: false, signal: init.signal }, response => {
        let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve(new Response(body, { status: response.statusCode, headers: response.headers })));
      });
      request.on('error', reject);
      request.end(init.body || '');
    });
  };
}
