import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { installApi } from './api.js';
import type { Handler } from './routes/router.js';
import { createAuthHandler } from './routes/auth-routes.js';
import { Auth } from './services/auth-service.js';
import { probeProwlarr } from './services/prowlarr-service.js';
import { isSameOriginRequest } from './lib/http-utils.js';
import { UpstreamPolicy } from './services/upstream-policy.js';

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org https://artworks.thetvdb.com https://banners.thetvdb.com https://www.thetvdb.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

const STATIC_MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function setBaselineSecurityHeaders(res: ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
}

async function serveStaticAsset(
  req: IncomingMessage,
  res: ServerResponse,
  staticRoot: string,
  pathname: string,
): Promise<void> {
  const relativePath = '.' + decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const filePath = resolve(staticRoot, relativePath);

  if (!filePath.startsWith(staticRoot + sep)) {
    res.statusCode = 404;
    res.end();
    return;
  }

  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not a regular file');
    const body = await readFile(filePath);
    res.setHeader(
      'Content-Type',
      STATIC_MIME_TYPES[extname(filePath)] || 'application/octet-stream',
    );
    if (pathname.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    }
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

export function createApp(
  env: Record<string, string | undefined>,
  dataDir: string,
  staticDir: string,
) {
  const upstream = new UpstreamPolicy();
  const auth = new Auth(env, dataDir);
  const handleAuth = createAuthHandler(auth, {
    probeProwlarr: () => probeProwlarr(env, upstream),
  });
  const routes = new Map<string, Handler>();

  const closeApi = installApi(
    {
      use: (path, handler) => {
        routes.set(path, handler);
      },
    },
    env,
    dataDir,
    true,
    upstream,
  );

  const staticRoot = resolve(staticDir);

  const server = createServer(async (req, res) => {
    try {
      setBaselineSecurityHeaders(res);
      const url = new URL(req.url || '/', 'http://localhost');

      if (url.pathname === '/healthz' && req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json');
        res.end('{"status":"ok"}');
        return;
      }

      if (await handleAuth(req, res, url.pathname)) return;

      res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);

      const isReadMethod = ['GET', 'HEAD'].includes(req.method || '');
      if (!isReadMethod && !isSameOriginRequest(req, env)) {
        res.statusCode = 403;
        res.end('Forbidden origin');
        return;
      }

      const routeHandler = routes.get(url.pathname);
      if (routeHandler) {
        req.url = url.search || '/';
        await routeHandler(req, res);
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }

      if (!isReadMethod) {
        res.statusCode = 405;
        res.end();
        return;
      }

      await serveStaticAsset(req, res, staticRoot, url.pathname);
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end('Internal server error');
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  let shutdownFlight: Promise<void> | undefined;
  const drain = () => (shutdownFlight ??= closeApi().finally(() => auth.close()));

  server.once('close', () => {
    void drain();
  });

  return Object.assign(server, { drain });
}
