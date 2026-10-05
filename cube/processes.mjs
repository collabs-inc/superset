import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ownerVariable = 'CUBE_SUPERSET_PROCESS_OWNER';
async function identity(pid) {
  try {
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    }
    return (await run('ps', ['-p', String(pid), '-o', 'lstart='])).stdout.trim() || null;
  } catch { return null; }
}

export class ProcessGroup {
  owner = randomUUID();
  children = [];
  stopping = false;
  onUnexpectedExit = () => {};
  spawn(command, args = [], options = {}) {
    if (this.stopping) throw new Error('Backend is stopping.');
    const child = spawn(command, args, { stdio: 'ignore', ...options, detached: true,
      env: { ...(options.env ?? process.env), [ownerVariable]: this.owner } });
    const record = { child, identity: child.pid ? identity(child.pid) : Promise.resolve(null), done: new Promise(resolve => {
      child.once('exit', resolve); child.once('error', resolve);
    }) };
    this.children.push(record);
    child.once('error', error => { if (!this.stopping) this.onUnexpectedExit(error); });
    child.once('exit', code => { if (!this.stopping) this.onUnexpectedExit(new Error(`${command} exited (${code}).`)); });
    return child;
  }
  stop(gracefulChild) {
    if (!this.stopPromise) { this.stopping = true; this.stopPromise = this.stopOwned(gracefulChild); }
    return this.stopPromise;
  }
  async stopOwned(gracefulChild) {
    const owned = new Map();
    for (const record of this.children) {
      const started = await record.identity;
      if (started && started === await identity(record.child.pid)) owned.set(record.child.pid, started);
    }
    try {
      const ownedGroups = new Set(owned.keys());
      const { stdout } = await run('ps', ['-eo', 'pid=,ppid=,pgid='], { timeout: 1000 });
      const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
      const marker = `${ownerVariable}=${this.owner}`;
      if (process.platform === 'linux') {
        await Promise.all(rows.map(async ([pid]) => {
          const started = await identity(pid);
          if (!started) return;
          try {
            const env = await readFile(`/proc/${pid}/environ`, 'utf8');
            if (env.split('\0').includes(marker) && await identity(pid) === started) owned.set(pid, started);
          } catch {}
        }));
      } else {
        const { stdout: environments } = await run('ps', ['-E', '-ww', '-eo', 'pid=,command='], { timeout: 1000, maxBuffer: 64 * 1024 * 1024 });
        for (const row of environments.split('\n')) {
          if (!row.split(/\s+/).includes(marker)) continue;
          const pid = Number(row.trim().split(/\s+/, 1)[0]);
          const started = await identity(pid);
          if (started) owned.set(pid, started);
        }
      }
      for (let previous = -1; previous !== owned.size;) {
        previous = owned.size;
        for (const [pid, parent, group] of rows) if (!owned.has(pid) && (owned.has(parent) || ownedGroups.has(group))) {
          const started = await identity(pid);
          if (started) owned.set(pid, started);
        }
      }
    } catch {}
    const signal = async value => {
      for (const [pid, started] of [...owned].reverse()) {
        if (await identity(pid) === started) try { process.kill(pid, value); } catch {}
      }
    };
    if (gracefulChild && owned.has(gracefulChild.pid) && await identity(gracefulChild.pid) === owned.get(gracefulChild.pid)) {
      gracefulChild.kill('SIGTERM');
      const record = this.children.find(item => item.child === gracefulChild);
      let graceTimer;
      await Promise.race([record.done, new Promise(resolve => { graceTimer = setTimeout(resolve, 300); })]);
      clearTimeout(graceTimer);
    }
    await signal('SIGTERM');
    let timer;
    await Promise.race([Promise.all(this.children.map(record => record.done)), new Promise(resolve => { timer = setTimeout(resolve, 900); })]);
    clearTimeout(timer);
    await signal('SIGKILL');
    await Promise.all(this.children.map(record => record.done));
  }
}
