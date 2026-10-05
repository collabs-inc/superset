import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

function parsePid(bytes) {
  const pid = Number(String(bytes).trim());
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'child must report a valid PID');
  return pid;
}

async function assertStopped(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { process.kill(pid, 0); } catch { return; }
    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
      if (stat === null || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) return;
    }
    await delay(10);
  }
  assert.fail(`Owned process ${pid} is still alive.`);
}

test('session cleanup reaps owned processes and leaves unrelated processes alive', async () => {
  const { ProcessGroup } = await import('./processes.mjs');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(unrelated, 'spawn');
  const group = new ProcessGroup();
  const owned = group.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(owned, 'spawn');
  try {
    await group.stop();
    assert.throws(() => process.kill(owned.pid, 0));
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
    await group.stop();
  } finally {
    unrelated.kill();
    await once(unrelated, 'exit');
  }
});

test('SIGHUP cleanup kills a TERM-resistant owned process before Cube escalation', async () => {
  const script = `import { ProcessGroup } from ${JSON.stringify(new URL('./processes.mjs', import.meta.url).href)};
    const group = new ProcessGroup();
    const child = group.spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'], {stdio:['ignore','pipe','ignore']});
    child.stdout.once('data',()=>process.stdout.write(String(child.pid)+'\\n'));
    for(const signal of ['SIGHUP','SIGTERM','SIGINT'])process.on(signal,async()=>{await group.stop();process.exit(0)});`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', script]);
  const [bytes] = await once(parent.stdout, 'data');
  const pid = parsePid(bytes);
  const start = Date.now();
  parent.kill('SIGHUP');
  setTimeout(() => { parent.kill('SIGHUP'); parent.kill('SIGTERM'); }, 100);
  const [code] = await once(parent, 'exit');
  assert.equal(code, 0);
  assert.ok(Date.now() - start < 1800, 'cleanup must finish within the ptyd grace period');
  await assertStopped(pid);
});

test('cleanup also stops a reparented helper in an owned process group', async () => {
  const { ProcessGroup } = await import('./processes.mjs');
  const helper = 'setInterval(()=>{},1000)';
  const intermediate = `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',${JSON.stringify(helper)}],{stdio:'ignore'});process.stdout.write(String(child.pid)+'\\n');child.unref();`;
  const owner = `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify(intermediate)}],{stdio:['ignore','inherit','ignore']});setInterval(()=>{},1000);`;
  const group = new ProcessGroup();
  const root = group.spawn(process.execPath, ['-e', owner], { stdio: ['ignore', 'pipe', 'ignore'] });
  const [bytes] = await once(root.stdout, 'data');
  const pid = parsePid(bytes);
  try {
    await delay(100);
    await group.stop();
    await assertStopped(pid);
  } finally { await group.stop(); try { process.kill(pid, 'SIGKILL'); } catch {} }
});

test('cleanup stops an orphan after its owner crashes without touching another group', async () => {
  const { ProcessGroup } = await import('./processes.mjs');
  const group = new ProcessGroup();
  const unrelatedGroup = new ProcessGroup();
  const unrelated = unrelatedGroup.spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  await once(unrelated, 'spawn');
  const script = `const {spawn}=require('node:child_process');const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});helper.unref();process.stdout.write(String(helper.pid)+'\\n');setTimeout(()=>process.exit(1),100);`;
  const owner = group.spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const [bytes] = await once(owner.stdout, 'data');
  const pid = parsePid(bytes);
  try {
    await once(owner, 'exit');
    await group.stop();
    await assertStopped(pid);
    assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
  } finally {
    await group.stop(); await unrelatedGroup.stop();
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
});
