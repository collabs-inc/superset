import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ProcessGroup } from './processes.mjs';

export async function assertPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const probe = net.createServer();
  probe.listen(port, '127.0.0.1');
  try { await once(probe, 'listening'); }
  catch (error) { throw new Error(`Superset PORT ${port} is already in use or unavailable.`, { cause: error }); }
  finally { if (probe.listening) await new Promise(resolve => probe.close(resolve)); }
}

export async function runBackend({ executable, args, dataDir, port, env = {}, group = new ProcessGroup() }) {
  await assertPortAvailable(port);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  let failure;
  let ready = false;
  let stopPromise;
  let child;
  const closed = [];
  const stop = () => stopPromise ||= (async () => {
    await group.stop(child);
    for (const resolve of closed) resolve();
  })();
  group.onUnexpectedExit = error => { failure = error; if (ready) void stop(); };
  const childEnv = { ...process.env, ...env, PORT: String(port), CUBE_SUPERSET_WEB: '1', NODE_ENV: 'production',
    SUPERSET_HOME_DIR: path.join(dataDir, 'native'), SUPERSET_HOST_AUTO_UPDATE: 'false' };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS', 'APPIMAGE', 'APPDIR']) delete childEnv[key];
  for (const key of Object.keys(childEnv)) if (childEnv[key] === undefined) delete childEnv[key];
  try {
    child = group.spawn(executable, args, { env: childEnv, cwd: dataDir, stdio: ['ignore', 'inherit', 'inherit'] });
    for (let attempt = 0; attempt < 300; attempt++) {
      if (failure) throw failure;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
        await response.body?.cancel();
        if (response.ok) { ready = true; return { stop, done: new Promise(resolve => closed.push(resolve)), get failure() { return failure; } }; }
      } catch {}
      await delay(100);
    }
    throw new Error('Superset browser backend did not become ready within 30 seconds.');
  } catch (error) { await stop(); throw error; }
}
