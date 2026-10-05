import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('private dependencies install with verified bytes and remain usable without their download', { skip: process.platform !== 'linux' }, async () => {
  const { installSystemRuntime, systemRuntime } = await import('./system-runtime.mjs');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'superset dependencies '));
  try {
    const source = path.join(folder, 'package');
    await mkdir(path.join(source, 'DEBIAN'), { recursive: true });
    await mkdir(path.join(source, 'usr/bin'), { recursive: true });
    await mkdir(path.join(source, 'usr/share/glib-2.0/schemas'), { recursive: true });
    await writeFile(path.join(source, 'usr/share/glib-2.0/schemas/test.gschema.xml'), '<schemalist><schema id="org.example.Superset" path="/org/example/"><key name="test" type="s"><default>\'persisted\'</default></key></schema></schemalist>');
    await writeFile(path.join(source, 'DEBIAN/control'), 'Package: superset-test\nVersion: 1\nArchitecture: amd64\nMaintainer: Test <test@example.com>\nDescription: Private dependency fixture\n');
    for (const name of ['dbus-daemon', 'dbus-send', 'gnome-keyring-daemon']) {
      await writeFile(path.join(source, 'usr/bin', name), '#!/bin/sh\nprintf private-service\n', { mode: 0o755 });
    }
    const archive = path.join(folder, 'package.deb');
    execFileSync('dpkg-deb', ['--build', source, archive], { stdio: 'pipe' });
    const manifest = JSON.stringify({ platform: 'debian12-x64', packages: [{ name: 'superset-test', url: pathToFileURL(archive).href, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') }] });
    const cache = path.join(folder, 'cache');
    await installSystemRuntime(cache, manifest);
    const runtime = await systemRuntime(cache, manifest);
    assert.equal(execFileSync(runtime.dbusDaemon, [], { env: { PATH: '' }, encoding: 'utf8' }), 'private-service');
    assert.equal(execFileSync(runtime.keyringDaemon, [], { env: { PATH: '' }, encoding: 'utf8' }), 'private-service');
    assert.ok(runtime.libraryPath.startsWith(runtime.root + '/'));
    assert.equal(execFileSync('/usr/bin/gsettings', ['get', 'org.example.Superset', 'test'], { env: { GSETTINGS_SCHEMA_DIR: runtime.schemaDir, GSETTINGS_BACKEND: 'memory' }, encoding: 'utf8' }).trim(), "'persisted'");
    await rm(archive);
    await installSystemRuntime(cache, manifest);
    assert.equal((await systemRuntime(cache, manifest)).root, runtime.root);
    await assert.rejects(systemRuntime(cache, manifest + '\n'), /Run the Cube app installer/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('a mismatched dependency checksum leaves no usable installation', { skip: process.platform !== 'linux' }, async () => {
  const { installSystemRuntime, systemRuntime } = await import('./system-runtime.mjs');
  const folder = await mkdtemp(path.join(os.tmpdir(), 'superset checksum '));
  try {
    const archive = path.join(folder, 'bad.deb');
    await writeFile(archive, 'untrusted bytes');
    const manifest = JSON.stringify({ platform: 'debian12-x64', packages: [{ name: 'bad', url: pathToFileURL(archive).href, sha256: '0'.repeat(64) }] });
    await assert.rejects(installSystemRuntime(folder, manifest), /checksum mismatch/);
    await assert.rejects(systemRuntime(folder, manifest), /Run the Cube app installer/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
