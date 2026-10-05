import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { assertPortAvailable, runBackend } from './backend.mjs';
import { ProcessGroup } from './processes.mjs';

const run = promisify(execFile);

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('Private display allocation timed out.')), 10000);
    stream.on('data', bytes => {
      buffer += bytes;
      if (buffer.includes('\n')) { clearTimeout(timer); resolve(buffer.split('\n')[0].trim()); }
    });
    stream.once('error', error => { clearTimeout(timer); reject(error); });
    stream.once('end', () => { clearTimeout(timer); if (!buffer.includes('\n')) reject(new Error('Private display allocation failed.')); });
  });
}

export async function runBrowser() {
  if (process.platform !== 'linux') throw new Error('Superset for Cube requires Linux.');
  const port = Number(process.env.PORT);
  await assertPortAvailable(port);
  const release = JSON.parse(await readFile(new URL('./runtime.json', import.meta.url), 'utf8'));
  const cache = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cube-superset');
  const install = process.env.CUBE_SUPERSET_RUNTIME_DIR || path.join(cache, `browser-${release.overlay.sha256}`);
  const dataDir = path.resolve(process.env.CUBE_SUPERSET_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'cube-superset'));
  const state = path.join(dataDir, 'bridge');
  for (const folder of ['config', 'data/keyrings', 'cache']) await mkdir(path.join(state, folder), { recursive: true, mode: 0o700 });
  const runtime = await mkdtemp(path.join(os.tmpdir(), `cube-superset-${process.getuid()}-`));
  const group = new ProcessGroup();
  let failure;
  let backend;
  let stopping;
  group.onUnexpectedExit = error => { failure = error; };
  const stop = () => stopping ||= (async () => {
    if (backend) await backend.stop();
    await group.stop();
    await rm(runtime, { recursive: true, force: true });
  })();
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => void stop().then(() => process.exit(0)));
  try {
    const env = { ...process.env, DISPLAY: undefined, WAYLAND_DISPLAY: undefined, XAUTHORITY: undefined, XDG_RUNTIME_DIR: runtime,
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${runtime}/bus`, GNOME_KEYRING_CONTROL: path.join(runtime, 'keyring'),
      XDG_CURRENT_DESKTOP: 'GNOME', DESKTOP_SESSION: 'gnome',
      PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ''}` };
    const virtualDisplay = process.env.CUBE_SUPERSET_VIRTUAL_DISPLAY === '1';
    if (virtualDisplay) {
      const authFile = path.join(runtime, 'Xauthority');
      await writeFile(authFile, '', { mode: 0o600 });
      const cookie = randomBytes(16).toString('hex');
      await run('xauth', ['-f', authFile, 'add', ':0', 'MIT-MAGIC-COOKIE-1', cookie]);
      const displayProcess = group.spawn('Xvfb', ['-displayfd', '3', '-screen', '0', '640x480x24', '-nolisten', 'tcp', '-auth', authFile], { stdio: ['ignore', 'ignore', 'inherit', 'pipe'] });
      const display = await firstLine(displayProcess.stdio[3]);
      if (!/^\d+$/.test(display)) throw new Error('Invalid private display allocation.');
      await run('xauth', ['-f', authFile, 'add', `:${display}`, 'MIT-MAGIC-COOKIE-1', cookie]);
      env.DISPLAY = `:${display}`;
      env.XAUTHORITY = authFile;
    }
    const serviceEnv = { ...env, XDG_CONFIG_HOME: path.join(state, 'config'), XDG_DATA_HOME: path.join(state, 'data'), XDG_CACHE_HOME: path.join(state, 'cache') };
    group.spawn('dbus-daemon', ['--session', '--nofork', `--address=${env.DBUS_SESSION_BUS_ADDRESS}`], { env: serviceEnv });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      try { await run('dbus-send', ['--session', '--type=method_call', '--print-reply', '--dest=org.freedesktop.DBus', '/', 'org.freedesktop.DBus.ListNames'], { env: serviceEnv, timeout: 1000 }); break; }
      catch { if (attempt === 99) throw new Error('Private D-Bus did not become ready.'); await delay(50); }
    }
    const passwordFile = process.env.CUBE_SUPERSET_KEYRING_PASSWORD_FILE || path.join(state, 'keyring-password');
    let password;
    try { password = await readFile(passwordFile); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if ((await readdir(path.join(state, 'data/keyrings'))).some(name => name.endsWith('.keyring'))) {
        throw new Error('Existing Superset keyring needs its password in CUBE_SUPERSET_KEYRING_PASSWORD_FILE.');
      }
      password = Buffer.from(randomBytes(32).toString('hex'));
      await writeFile(passwordFile, password, { mode: 0o600, flag: 'wx' });
    }
    const keyring = group.spawn('gnome-keyring-daemon', ['--foreground', '--unlock', '--components=secrets', `--control-directory=${env.GNOME_KEYRING_CONTROL}`], { env: serviceEnv, stdio: ['pipe', 'ignore', 'inherit'] });
    keyring.stdin.end(password);
    await once(keyring.stdin, 'finish');
    password.fill(0);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure) throw failure;
      try {
        const { stdout } = await run('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.DBus', '/', 'org.freedesktop.DBus.NameHasOwner', 'string:org.freedesktop.secrets'], { env: serviceEnv, timeout: 1000 });
        if (!stdout.includes('boolean true')) throw new Error('Private keyring is still starting.');
        const unlocked = await run('dbus-send', ['--session', '--print-reply', '--dest=org.freedesktop.secrets', '/org/freedesktop/secrets/collection/login', 'org.freedesktop.DBus.Properties.Get', 'string:org.freedesktop.Secret.Collection', 'string:Locked'], { env: serviceEnv, timeout: 1000 });
        if (!unlocked.stdout.includes('boolean false')) throw new Error('Private keyring is locked.');
        break;
      }
      catch { if (attempt === 99) throw new Error('Private keyring did not become ready.'); await delay(50); }
    }
    backend = await runBackend({
      executable: path.join(install, 'opt/Superset/superset'),
      args: [`--user-data-dir=${path.join(dataDir, 'profile')}`, '--disable-dev-shm-usage', '--disable-gpu', '--password-store=gnome-libsecret', ...(virtualDisplay ? [] : ['--ozone-platform=headless'])],
      dataDir, port, env, group,
    });
    console.log(`Superset browser UI is ready on http://127.0.0.1:${port}.`);
    await backend.done;
    if (backend.failure) throw backend.failure;
  } finally { await stop(); }
}
