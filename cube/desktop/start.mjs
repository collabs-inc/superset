import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createIngress } from './gateway.mjs';
import { ProcessGroup } from './processes.mjs';

const run = promisify(execFile);
const directory = path.dirname(fileURLToPath(import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function ready(port, checkFailure) {
  for (let attempt = 0; attempt < 100; attempt++) {
    checkFailure();
    const connected = await new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await delay(100);
  }
  throw new Error('Desktop transport did not become ready.');
}
function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Desktop display allocation timed out.')), 10000);
    stream.on('data', bytes => {
      buffer += bytes;
      if (buffer.includes('\n')) { clearTimeout(timer); resolve(buffer.split('\n')[0].trim()); }
    });
    stream.once('error', error => { clearTimeout(timer); reject(error); });
    stream.once('end', () => { clearTimeout(timer); if (!buffer.includes('\n')) reject(new Error('Desktop display allocation failed.')); });
  });
}

export async function runDesktop({ name, executable, args = [], dataDir, env: overrides = {} }) {
  const port = Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (process.platform !== 'linux') throw new Error('The desktop bridge requires Linux.');
  if (!path.isAbsolute(executable) || !path.isAbsolute(dataDir)) throw new Error('Executable and dataDir must be absolute paths.');
  const assetsDir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cube-desktop/novnc-1.7.0');
  await readFile(path.join(assetsDir, '.cube-sha256'));
  const state = path.join(dataDir, 'bridge');
  for (const folder of ['config', 'data', 'cache', 'bin']) await mkdir(path.join(state, folder), { recursive: true, mode: 0o700 });
  const runtime = await mkdtemp(`/tmp/cube-desktop-${process.getuid()}-`);
  const authFile = path.join(runtime, 'Xauthority');
  await writeFile(authFile, '', { mode: 0o600 });
  const cookie = randomBytes(16).toString('hex');
  const group = new ProcessGroup();
  let failure;
  let stopping;
  let ingress;
  let linkServer;
  let app;
  group.onUnexpectedExit = error => { failure = error; if (ingress?.server.listening) { console.error(error.message); void stop(1); } };
  const checkFailure = () => { if (failure) throw failure; };
  async function stop(code, exit = true) {
    if (stopping) return stopping;
    stopping = (async () => {
      if (ingress) await ingress.close();
      if (linkServer?.listening) { linkServer.closeAllConnections(); await new Promise(resolve => linkServer.close(resolve)); }
      await group.stop();
      await rm(runtime, { recursive: true, force: true });
      if (exit) process.exit(code);
    })();
    return stopping;
  }
  // A pty hangup and Cube's kill ladder can deliver the same signal twice.
  // Keep handlers installed throughout teardown instead of restoring defaults.
  process.on('SIGTERM', () => void stop(0));
  process.on('SIGINT', () => void stop(0));
  process.on('SIGHUP', () => void stop(0));
  try {
    await run('xauth', ['-f', authFile, 'add', ':0', 'MIT-MAGIC-COOKIE-1', cookie]);
    const xvfb = group.spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '1440x900x24', '-nolisten', 'tcp', '-auth', authFile, '+extension', 'RANDR'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] });
    const display = await firstLine(xvfb.stdio[3]);
    if (!/^\d+$/.test(display)) throw new Error('Invalid display allocation.');
    await run('xauth', ['-f', authFile, 'add', `:${display}`, 'MIT-MAGIC-COOKIE-1', cookie]);
    const env = { ...process.env, ...overrides, DISPLAY: `:${display}`, XAUTHORITY: authFile,
      XDG_RUNTIME_DIR: runtime, DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`,
      PATH: `${path.join(state, 'bin')}:${process.env.HOME}/.local/bin:${overrides.PATH || process.env.PATH || ''}`,
      CUBE_DESKTOP_LINK_SOCKET: path.join(runtime, 'links.sock') };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    for (const key of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'NODE_OPTIONS']) delete env[key];
    env.NODE_ENV = 'production';
    const serviceEnv = { ...env, XDG_CONFIG_HOME: path.join(state, 'config'), XDG_DATA_HOME: path.join(state, 'data'), XDG_CACHE_HOME: path.join(state, 'cache') };
    group.spawn('dbus-daemon', ['--session', '--nofork', `--address=${env.DBUS_SESSION_BUS_ADDRESS}`], { env: serviceEnv });
    for (let attempt = 0; attempt < 100; attempt++) {
      checkFailure();
      try { await run('dbus-send', ['--session', '--type=method_call', '--print-reply', '--dest=org.freedesktop.DBus', '/', 'org.freedesktop.DBus.ListNames'], { env: serviceEnv, timeout: 1000 }); break; }
      catch { if (attempt === 99) throw new Error('Private desktop D-Bus did not become ready.'); await delay(50); }
    }
    const openboxConfig = path.join(state, 'config/openbox.xml');
    await writeFile(openboxConfig, '<openbox_config xmlns="http://openbox.org/3.4/rc"><applications><application class="*"><maximized>yes</maximized><decor>no</decor></application></applications></openbox_config>');
    group.spawn('openbox', ['--config-file', openboxConfig], { env: serviceEnv });
    group.spawn('gnome-keyring-daemon', ['--foreground', '--components=secrets', `--control-directory=${runtime}/keyring`], { env: serviceEnv });
    const vncPort = await freePort();
    const websocketPort = await freePort();
    group.spawn('x11vnc', ['-display', env.DISPLAY, '-auth', authFile, '-localhost', '-rfbport', String(vncPort), '-forever', '-shared', '-nopw', '-noxdamage', '-xrandr', 'resize', '-quiet'], { env: serviceEnv });
    await ready(vncPort, checkFailure);
    group.spawn('websockify', [`127.0.0.1:${websocketPort}`, `127.0.0.1:${vncPort}`], { env: serviceEnv });
    await ready(websocketPort, checkFailure);
    ingress = createIngress({ name, clientDir: directory, assetsDir, upstreamPort: websocketPort, onRestore: async () => {
      if (!app?.pid) throw new Error('Application is starting.');
      const {stdout} = await run('xdotool', ['search', '--pid', String(app.pid)], {env: serviceEnv, timeout:1000});
      const window = stdout.trim().split('\n').find(value => /^\d+$/.test(value));
      if (!window) throw new Error('Application has no window.');
      await run('xdotool', ['windowmap', window, 'windowactivate', window], {env:serviceEnv,timeout:1000});
    } });
    linkServer = http.createServer((request, response) => {
      if (request.method !== 'POST' || request.url !== '/open') { response.writeHead(404); response.end(); return; }
      let body = '';
      request.on('data', bytes => { body += bytes; if (body.length > 20000) request.destroy(); });
      request.on('end', () => {
        let accepted = false;
        try { accepted = ingress.publishLink(JSON.parse(body).url); } catch {}
        response.writeHead(accepted ? 204 : 400); response.end();
      });
    });
    linkServer.listen(env.CUBE_DESKTOP_LINK_SOCKET);
    await once(linkServer, 'listening');
    await chmod(env.CUBE_DESKTOP_LINK_SOCKET, 0o600);
    const opener = path.join(state, 'bin/xdg-open');
    await writeFile(opener, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(directory, 'open-link.mjs'))} "$@"\n`, { mode: 0o700 });
    env.BROWSER = opener;
    app = group.spawn(executable, args, { cwd: dataDir, env });
    await once(app, 'spawn');
    await delay(300);
    checkFailure();
    ingress.server.listen(port, '127.0.0.1');
    await once(ingress.server, 'listening');
    console.log(`${name} desktop is ready on 127.0.0.1:${port}.`);
    return { stop: () => stop(0, false), port, display: env.DISPLAY };
  } catch (error) {
    await stop(1, false);
    throw error;
  }
}
