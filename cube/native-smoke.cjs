const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const requireApp = createRequire(path.join(process.argv[2], 'package.json'));
  const Database = requireApp('better-sqlite3');
  const db = new Database(':memory:');
  assert.equal(db.prepare('SELECT 42 AS answer').get().answer, 42);
  db.close();
  const pty = requireApp('node-pty');
  const watcher = requireApp('@parcel/watcher');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'superset native '));
  let subscription;
  try {
    await new Promise((resolve, reject) => {
      const shell = pty.spawn('/bin/sh', ['-c', 'printf "cube-native-pty-ok\\n"'], { cwd: directory, env: process.env });
      let output = '';
      const timer = setTimeout(() => { shell.kill(); reject(new Error('PTY smoke check timed out.')); }, 10000);
      shell.onData(data => { output += data; });
      shell.onExit(({ exitCode }) => {
        clearTimeout(timer);
        try { assert.equal(exitCode, 0); assert.match(output, /cube-native-pty-ok/); resolve(); }
        catch (error) { reject(error); }
      });
    });
    let notify;
    const observed = new Promise(resolve => { notify = resolve; });
    subscription = await watcher.subscribe(directory, (error, events) => {
      if (!error && events.some(event => path.basename(event.path) === 'probe.txt')) notify();
    });
    await fs.writeFile(path.join(directory, 'probe.txt'), 'watcher probe');
    let timer;
    try { await Promise.race([observed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Filesystem watcher smoke check timed out.')), 10000); })]); }
    finally { clearTimeout(timer); }
    console.log('Superset native checks passed: SQLite, PTY shell, filesystem watcher.');
  } finally { await subscription?.unsubscribe(); await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
