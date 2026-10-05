import os from 'node:os';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { runDesktop } from './desktop/start.mjs';

const dataDir = process.env.CUBE_SUPERSET_DATA_DIR || path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local/share'), 'cube-superset');
const runtime = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'cube-superset', '1.35.0-linux-x64');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await runDesktop({
  name: 'Superset',
  executable: path.join(runtime, 'opt/Superset/superset'),
  args: [`--user-data-dir=${path.join(dataDir, 'profile')}`, '--disable-dev-shm-usage', '--disable-gpu'],
  dataDir,
  env: { SUPERSET_HOME_DIR: path.join(dataDir, 'native'), NODE_ENV: 'production', SUPERSET_HOST_AUTO_UPDATE: 'false' },
});
