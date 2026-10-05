import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

export function externalLink(value) {
  if (typeof value !== 'string' || value.length > 16384 || /[\x00-\x20\x7f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function allowed(req, upgrade = false) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false;
  const host = req.headers.host;
  if (typeof host !== 'string' || /[\s/@?#\\]/.test(host)) return false;
  let parsed;
  try { parsed = new URL(`http://${host}`); } catch { return false; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && !/^[a-z0-9][a-z0-9-]*-[a-z0-9]{8}(?:-stg)?\.cube\.site$/.test(parsed.hostname)) return false;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  if ((upgrade || req.headers.origin) && req.headers.origin !== `${proto}://${host}`) return false;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) {
    if (upgrade || !['document', 'iframe'].includes(req.headers['sec-fetch-dest'])) return false;
  }
  return true;
}

export function createIngress({ name, clientDir, assetsDir, upstreamPort, onRestore }) {
  const sockets = new Set();
  const streams = new Set();
  let lastLink;
  let restoring = false;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    if (!allowed(req)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (req.method === 'POST' && req.url === '/restore') {
      if (!req.headers.origin) { res.writeHead(403); res.end(); return; }
      if (!onRestore) { res.writeHead(404); res.end(); return; }
      if (restoring) { res.writeHead(409); res.end(); return; }
      restoring = true;
      try { await onRestore(); res.writeHead(204); }
      catch { res.writeHead(503); }
      finally { restoring = false; res.end(); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/health' || route === '/meta') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ name, status: 'ready' })); return;
    }
    if (route === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.write(': connected\n\n');
      if (lastLink && Date.now() - lastLink.time < 300000) res.write(`data: ${JSON.stringify(lastLink)}\n\n`);
      streams.add(res);
      const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
      req.on('close', () => { clearInterval(heartbeat); streams.delete(res); });
      return;
    }
    try {
      const root = route.startsWith('/novnc/') ? assetsDir : clientDir;
      const relative = route.startsWith('/novnc/') ? decodeURIComponent(route.slice(7)) : route === '/' ? 'client.html' : null;
      if (!relative || relative.split('/').some(part => part.startsWith('.'))) throw new Error('Unknown file');
      const base = await realpath(root);
      const file = await realpath(path.join(base, relative));
      if (!file.startsWith(`${base}${path.sep}`)) throw new Error('Outside assets');
      const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/websockify' || !allowed(req, true)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket' };
    for (const key of ['sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions']) {
      if (req.headers[key]) headers[key] = req.headers[key];
    }
    const proxy = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: '/', headers });
    proxy.on('upgrade', (response, remote, remoteHead) => {
      sockets.add(remote);
      remote.on('close', () => sockets.delete(remote));
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${response.rawHeaders.reduce((result, value, index, all) => index % 2 ? result : `${result}${value}: ${all[index + 1]}\r\n`, '')}\r\n`);
      if (head.length) remote.write(head);
      if (remoteHead.length) socket.write(remoteHead);
      socket.on('error', () => remote.destroy());
      remote.on('error', () => socket.destroy());
      socket.on('close', () => remote.destroy());
      remote.on('close', () => socket.destroy());
      socket.pipe(remote).pipe(socket);
    });
    proxy.on('response', response => { response.resume(); socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    proxy.on('error', () => socket.destroy());
    socket.on('close', () => proxy.destroy());
    proxy.end();
  });
  return {
    server,
    publishLink(value) {
      const url = externalLink(value);
      if (!url) return false;
      lastLink = { url, time: Date.now() };
      for (const response of streams) response.write(`data: ${JSON.stringify(lastLink)}\n\n`);
      return true;
    },
    async close() {
      for (const response of streams) response.end();
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}
