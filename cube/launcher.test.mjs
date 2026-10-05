import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('manifest starts the browser backend without the streaming bridge', async () => {
  const source = await readFile(new URL('./start.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /runDesktop|desktop\/start|novnc|websockify|x11vnc/i);
  assert.match(source, /runBrowser/);
});

test('owned backend serves HTTP, preserves state after restart, and spares unrelated processes', async () => {
  const { runBackend } = await import('./backend.mjs');
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'superset lifecycle '));
  const script = path.join(dataDir, 'backend.mjs');
  await writeFile(script, `import http from 'node:http';
    import fs from 'node:fs';
    import path from 'node:path';
    const file = path.join(process.env.SUPERSET_HOME_DIR, 'runs');
    fs.mkdirSync(process.env.SUPERSET_HOME_DIR, {recursive:true});
    const runs = Number(fs.existsSync(file) ? fs.readFileSync(file,'utf8') : 0) + 1;
    fs.writeFileSync(file,String(runs));
    http.createServer((req,res)=>res.end('<main>Superset '+runs+'</main>')).listen(Number(process.env.PORT),'127.0.0.1');`);
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(unrelated, 'spawn');
  const portServer = net.createServer().listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise(resolve => portServer.close(resolve));
  let backend;
  try {
    for (const runs of [1, 2]) {
      backend = await runBackend({ executable: process.execPath, args: [script], dataDir, port, env: {} });
      assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), `<main>Superset ${runs}</main>`);
      await backend.stop();
      assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
      await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
    }
  } finally {
    await backend?.stop();
    unrelated.kill();
    await once(unrelated, 'exit');
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('backend startup failure cleans its children and does not claim an occupied port', async () => {
  const { runBackend } = await import('./backend.mjs');
  const occupied = net.createServer().listen(0, '127.0.0.1');
  await once(occupied, 'listening');
  try {
    await assert.rejects(runBackend({ executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], dataDir: os.tmpdir(), port: occupied.address().port }), /already in use/);
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});
