import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const require = createRequire(path.join(root, 'apps/desktop/package.json'));
const builder = require.resolve('electron-builder');
const builderLib = require.resolve('app-builder-lib', { paths: [path.dirname(builder)] });
const asar = require.resolve('@electron/asar', { paths: [path.dirname(builderLib)] });
const out = path.resolve(process.argv[2] || path.join(directory, 'out/superset-browser.tar.gz'));
const stage = await mkdtemp(path.join(os.tmpdir(), 'superset-package-'));
const collectedLicenses = new Set();
async function collectLicenses(packageFile) {
  const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
  const key = `${metadata.name}@${metadata.version}`;
  if (collectedLicenses.has(key)) return;
  collectedLicenses.add(key);
  const packageDir = path.dirname(packageFile);
  const licenseDir = path.join(stage, 'licenses', key.replaceAll('/', '__'));
  await mkdir(licenseDir, { recursive: true });
  for (const filename of await readdir(packageDir)) {
    if (/^(licen[cs]e|copying|notice)(\.|$)/i.test(filename)) await cp(path.join(packageDir, filename), path.join(licenseDir, filename));
  }
  for (const dependency of Object.keys(metadata.dependencies || {}).sort()) {
    await collectLicenses(require.resolve(`${dependency}/package.json`, { paths: [packageDir] }));
  }
}
try {
  const dist = path.join(root, 'apps/desktop/dist');
  await readFile(path.join(dist, 'main/index.js'));
  await readFile(path.join(dist, 'renderer/index.html'));
  await cp(dist, path.join(stage, 'dist'), { recursive: true, filter: source => !source.endsWith('.map') });
  const release = JSON.parse(await readFile(path.join(directory, 'runtime.json'), 'utf8'));
  const metadata = {
    version: release.version,
    runtimeSha256: release.runtimeSha256,
    sourceCommit: execFileSync('git', ['log', '-1', '--format=%H', '--', 'apps', 'packages', 'bun.lock', 'package.json'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceDiffSha256: createHash('sha256').update(execFileSync('git', ['diff', 'HEAD', '--', 'apps', 'packages'], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).digest('hex'),
  };
  await writeFile(path.join(stage, 'build.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const entry = path.join(stage, 'extract-runtime.mjs');
  await writeFile(entry, `import { extractAll } from ${JSON.stringify(asar)};\nextractAll(process.argv[2], process.argv[3]);\n`);
  execFileSync('bun', ['build', entry, '--target=node', '--format=cjs', '--minify-whitespace', '--external=original-fs', `--outfile=${path.join(stage, 'extract-runtime.cjs')}`], { cwd: root, stdio: 'inherit' });
  await rm(entry);
  await collectLicenses(path.join(path.dirname(asar), '../package.json'));
  await cp(path.join(root, 'LICENSE.md'), path.join(stage, 'licenses/Superset-LICENSE.md'));
  await mkdir(path.dirname(out), { recursive: true });
  execFileSync('python3', [path.join(directory, 'archive.py'), stage, out], { stdio: 'inherit' });
  const sha256 = createHash('sha256').update(await readFile(out)).digest('hex');
  await writeFile(`${out}.sha256`, `${sha256}  ${path.basename(out)}\n`);
  console.log(JSON.stringify({ file: out, sha256, ...metadata }, null, 2));
} finally { await rm(stage, { recursive: true, force: true }); }
