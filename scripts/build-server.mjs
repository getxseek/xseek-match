import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const build = resolve(root, 'build');
if (!build.startsWith(resolve(root) + sep)) throw new Error('Invalid build output path');
rmSync(build, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(root, 'tsconfig.server.json')],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
