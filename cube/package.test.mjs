import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('the same overlay contents produce identical archives despite file timestamps', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'superset package '));
  try {
    const input = path.join(folder, 'source');
    await mkdir(input);
    await writeFile(path.join(input, 'asset.js'), 'console.log("real browser")');
    const archive = fileURLToPath(new URL('./archive.py', import.meta.url));
    execFileSync('python3', [archive, input, path.join(folder, 'first.tar.gz')]);
    await utimes(path.join(input, 'asset.js'), 123, 123);
    execFileSync('python3', [archive, input, path.join(folder, 'second.tar.gz')]);
    assert.deepEqual(await readFile(path.join(folder, 'first.tar.gz')), await readFile(path.join(folder, 'second.tar.gz')));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
