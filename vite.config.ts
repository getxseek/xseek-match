import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { UpstreamPolicy } from './src/server/services/upstream-policy.js';
import { Auth } from './src/server/services/auth-service.js';
import { installApi } from './src/server/api.js';
import { createAuthHandler } from './src/server/routes/auth-routes.js';
import { probeProwlarr } from './src/server/services/prowlarr-service.js';
export default defineConfig(({ mode }) => ({
  root: 'src/web',
  plugins: [
    tailwindcss(),
    react(),
    {
      name: 'match-api',
      configureServer(server) {
        const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
        const dir = resolve(env.DATA_DIR || '.local');
        const upstream = new UpstreamPolicy();
        const auth = new Auth(
          { ...env, APP_ORIGIN: env.APP_ORIGIN || 'http://127.0.0.1:5178' },
          dir,
        );
        const handleAuth = createAuthHandler(auth, {
          development: true,
          allowLoopbackOrigins: !env.APP_ORIGIN,
          probeProwlarr: () => probeProwlarr(env, upstream),
        });
        server.middlewares.use((req, res, next) => {
          void handleAuth(req, res, new URL(req.url || '/', 'http://localhost').pathname)
            .then((handled) => {
              if (!handled) next();
            })
            .catch(next);
        });
        const close = installApi(server.middlewares, env, dir, false, upstream);
        server.httpServer?.once('close', () => {
          void close().finally(() => auth.close());
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 5178, open: '/' },
  build: { outDir: '../../dist', emptyOutDir: true },
}));
