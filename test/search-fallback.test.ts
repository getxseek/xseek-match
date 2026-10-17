import { it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installApi } from '../src/server/api';
import type { Handler } from '../src/server/routes/router';
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    ),
  );
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
it('retries an empty ID search as text with the same tracker selection and caches the successful result', async () => {
  const requests: URL[] = [];
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname === '/api/v1/indexer')
      res.end(
        JSON.stringify(
          [1, 2].map((id) => ({ id, enable: true, supportsSearch: true, protocol: 'torrent' })),
        ),
      );
    else {
      requests.push(url);
      res.end(
        JSON.stringify(
          url.searchParams.get('type') === 'tvsearch'
            ? []
            : [
                {
                  protocol: 'torrent',
                  title: 'Show.S01E04',
                  indexerId: 1,
                  indexer: 'Test',
                  guid: 'one',
                  size: 100,
                },
              ],
        ),
      );
    }
  });
  const base = await listen(upstream);
  const dir = mkdtempSync(join(tmpdir(), 'match-fallback-'));
  const routes = new Map<string, Handler>();
  const cleanup = installApi(
    {
      use: (path, handler) => {
        routes.set(path, handler);
      },
    },
    { PROWLARR_BASE_URL: base, PROWLARR_API_KEY: 'test-key' },
    dir,
  );
  const server = createServer((req, res) => {
    const handler = routes.get(new URL(req.url!, 'http://localhost').pathname);
    if (handler)
      void Promise.resolve(handler(req, res)).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    else {
      res.statusCode = 404;
      res.end();
    }
  });
  const app = await listen(server);
  try {
    const path = '/api/match/search?q=Show%20S01E04&kind=sonarr&id=123&exclude=2';
    const response = await fetch(app + path);
    expect(response.status).toBe(200);
    expect((await response.json()).results).toHaveLength(1);
    expect(requests.map((url) => url.searchParams.get('type'))).toEqual(['tvsearch', 'search']);
    expect(requests[0]!.searchParams.get('query')).toBe('Show {tvdbid:123} {season:1} {episode:4}');
    expect(requests[1]!.searchParams.get('query')).toBe('Show S01E04');
    for (const url of requests) expect(url.searchParams.getAll('indexerIds')).toEqual(['1']);
    expect((await (await fetch(app + path)).json()).cached).toBe(true);
    expect(requests).toHaveLength(2);
  } finally {
    await close(server);
    await cleanup();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});
