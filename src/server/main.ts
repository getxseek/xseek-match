import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './http.js';
if (existsSync('.env')) process.loadEnvFile('.env');
process.umask(0o077);
const env = { ...process.env };
for (const key of ['PROWLARR_API_KEY'])
  if (env[`${key}_FILE`]) env[key] = readFileSync(env[`${key}_FILE`]!, 'utf8').trim();
const port = Number(env.PORT || 5178);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = createApp(env, resolve(env.DATA_DIR || '.local'), resolve(env.STATIC_DIR || 'dist'));
server.listen(port, env.HOST || '0.0.0.0', () =>
  console.log(`xseek-match listening on port ${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    server.close(() => {
      void server.drain().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
