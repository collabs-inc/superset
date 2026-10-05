import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const packageManifest = () => readFile(new URL('./system-packages.json', import.meta.url), 'utf8');

function paths(cache, manifest) {
  const digest = createHash('sha256').update(manifest).digest('hex');
  const root = path.join(cache, `system-${digest}`);
  return {
    root, digest,
    dbusDaemon: path.join(root, 'usr/bin/dbus-daemon'),
    dbusSend: path.join(root, 'usr/bin/dbus-send'),
    keyringDaemon: path.join(root, 'usr/bin/gnome-keyring-daemon'),
    schemaDir: path.join(root, 'usr/share/glib-2.0/schemas'),
    libraryPath: [path.join(root, 'usr/lib/x86_64-linux-gnu'), path.join(root, 'lib/x86_64-linux-gnu')].join(':'),
  };
}

export async function systemRuntime(cache, manifest) {
  const runtime = paths(cache, manifest ?? await packageManifest());
  try {
    if ((await readFile(path.join(runtime.root, '.cube-sha256'), 'utf8')).trim() !== runtime.digest) throw new Error('Incomplete dependencies');
    for (const file of [runtime.dbusDaemon, runtime.dbusSend, runtime.keyringDaemon]) await access(file, constants.X_OK);
  } catch {
    throw new Error('Superset private dependencies are missing. Run the Cube app installer.');
  }
  return runtime;
}

export async function installSystemRuntime(cache, manifest = undefined) {
  manifest ??= await packageManifest();
  const runtime = paths(cache, manifest);
  try { return await systemRuntime(cache, manifest); } catch {}
  const packages = JSON.parse(manifest);
  if (packages.platform !== 'debian12-x64') throw new Error('Unsupported Superset dependency platform');
  await mkdir(cache, { recursive: true });
  const stage = await mkdtemp(path.join(cache, '.system-install-'));
  const root = path.join(stage, 'root');
  await mkdir(root);
  try {
    for (const entry of packages.packages) {
      if (!/^[a-z0-9][a-z0-9+.-]*$/.test(entry.name) || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid dependency pin');
      const archive = path.join(stage, `${entry.name}.deb`);
      await run('curl', ['--fail', '--location', '--retry', '3', '--silent', '--show-error', entry.url, '--output', archive]);
      if (createHash('sha256').update(await readFile(archive)).digest('hex') !== entry.sha256) throw new Error(`${entry.name} checksum mismatch`);
      await run('dpkg-deb', ['--extract', archive, root]);
    }
    for (const executable of ['dbus-daemon', 'dbus-send', 'gnome-keyring-daemon']) await access(path.join(root, 'usr/bin', executable), constants.X_OK);
    await run('glib-compile-schemas', ['--strict', path.join(root, 'usr/share/glib-2.0/schemas')]);
    await writeFile(path.join(root, '.cube-sha256'), `${runtime.digest}\n`);
    await rename(root, runtime.root);
    return await systemRuntime(cache, manifest);
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, cache] = process.argv.slice(2);
  if (!cache || !['install', 'library-path'].includes(action)) throw new Error('Usage: system-runtime.mjs install|library-path CACHE');
  if (action === 'install') {
    const osRelease = await readFile('/etc/os-release', 'utf8');
    if (!/^ID="?debian"?$/m.test(osRelease) || !/^VERSION_ID="?12"?$/m.test(osRelease)) throw new Error('Superset for Cube requires a Debian 12 host.');
    const runtime = await installSystemRuntime(cache);
    console.log(`Superset private dependencies installed at ${runtime.root}.`);
  } else console.log((await systemRuntime(cache)).libraryPath);
}
