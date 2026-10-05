import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('desktop ingress denies sibling origins and DNS rebinding while allowing Cube frames', async () => {
  const { createIngress } = await import('./gateway.mjs');
  const root = await mkdtemp(path.join(os.tmpdir(), 'desktop-gate-'));
  await writeFile(path.join(root, 'client.html'), '<html>desktop</html>');
  const upstream = http.createServer();
  upstream.on('upgrade', (_req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', bytes => socket.write(bytes));
    socket.on('end', () => socket.destroy());
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  let restores = 0;
  const gate = createIngress({ name: 'Fixture', clientDir: root, assetsDir: root, upstreamPort: upstream.address().port, onRestore: async () => { restores++; } });
  gate.server.listen(0, '127.0.0.1');
  await once(gate.server, 'listening');
  const port = gate.server.address().port;
  const host = 'fixture-abcdefgh.cube.site';
  const get = headers => new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', headers }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  try {
    const restore = origin => new Promise(resolve => {
      const req = http.request({host:'127.0.0.1',port,path:'/restore',method:'POST',headers:{Host:host,...(origin?{Origin:origin}:{}),'X-Forwarded-Proto':'https'}},res=>{res.resume();resolve(res.statusCode);});req.end();
    });
    assert.equal(await restore(undefined),403);
    assert.equal(await restore('https://other-abcdefgh.cube.site'),403);
    assert.equal(await restore(`https://${host}`),204);
    assert.equal(restores,1);
    assert.equal(await get({ Host: host, Origin: `https://${host}`, 'X-Forwarded-Proto': 'https' }), 200);
    assert.equal(await get({ Host: 'evil.example' }), 403);
    assert.equal(await get({ Host: host, Origin: 'https://sibling-abcdefgh.cube.site', 'X-Forwarded-Proto': 'https' }), 403);
    assert.equal(await get({ Host: host, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'iframe' }), 200);
    assert.equal(await get({ Host: host, 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Dest': 'empty' }), 403);
    assert.equal(await websocket(port, host, undefined), 403);
    assert.equal(await websocket(port, host, 'https://evil.example'), 403);
    assert.equal(await websocket(port, host, `https://${host}`, true), 101);
  } finally {
    await gate.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

function websocket(port, host, origin, echo = false) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/websockify', headers: {
      Host: host, ...(origin ? { Origin: origin } : {}), 'X-Forwarded-Proto': 'https',
      Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    } });
    request.on('upgrade', (response, socket) => {
      if (!echo) { socket.destroy(); resolve(response.statusCode); return; }
      socket.once('data', bytes => { assert.equal(bytes.toString(), 'desktop-bytes'); socket.destroy(); resolve(response.statusCode); });
      socket.write('desktop-bytes');
    });
    request.on('response', response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
}

test('external links reject script schemes and embedded credentials', async () => {
  const { externalLink } = await import('./gateway.mjs');
  assert.equal(externalLink('https://example.com/oauth?state=abc'), 'https://example.com/oauth?state=abc');
  assert.equal(externalLink('javascript:alert(1)'), null);
  assert.equal(externalLink('file:///etc/passwd'), null);
  assert.equal(externalLink('https://user:password@example.com'), null);
  assert.equal(externalLink('https://example.com\n'), null);
});
