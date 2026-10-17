import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installApi } from '../src/server/api';
import type { Handler } from '../src/server/routes/router';

const result = {
  protocol: 'torrent',
  guid: 'https://tracker.test/download?passkey=synthetic',
  title: 'Show.S01.1080p.WEB-DL.x264-GRP',
  indexerId: 1,
  indexer: 'Fixture',
  size: 1000,
};
async function fixture(upstream: (url: URL, options?: RequestInit) => Promise<Response>) {
  const dir = await mkdtemp(join(tmpdir(), 'match-api-health-'));
  await writeFile(
    join(dir, 'tracker-definitions.json'),
    JSON.stringify({ at: Date.now(), trackers: [{ Name: 'Fixture' }] }),
  );
  const native = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input, options) =>
      new URL(String(input)).hostname === 'fixture.test'
        ? upstream(new URL(String(input)), options)
        : native(input, options),
    );
  const routes = new Map<string, Handler>();
  const drain = installApi(
    { use: (path, handler) => routes.set(path, handler) },
    { PROWLARR_BASE_URL: 'http://fixture.test', PROWLARR_API_KEY: 'synthetic' },
    dir,
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const handler = routes.get(url.pathname);
    req.url = url.search;
    if (!handler) {
      res.statusCode = 404;
      res.end();
      return;
    }
    void Promise.resolve(handler(req, res)).catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    dir,
    fetch: (path: string, init?: RequestInit) => native(base + path, init),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await drain();
      spy.mockRestore();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

it('returns valid results even when cache persistence fails, with no false failed-search count', async () => {
  let calls = 0;
  const app = await fixture(async () => {
    calls++;
    return Response.json([result]);
  });
  try {
    await writeFile(join(app.dir, 'match-cache'), 'blocked');
    const response = await app.fetch('/api/match/search?q=Show');
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.results).toHaveLength(1);
    expect(data.cacheWarning).toMatch(/could not be cached/);
    expect(JSON.stringify(data)).not.toContain('passkey');
    expect(calls).toBe(1);
    const stats = await (await app.fetch('/api/match/statistics')).json();
    expect(stats.counts.searches).toBe(1);
    expect(stats.counts.failed || 0).toBe(0);
  } finally {
    await app.close();
  }
});
it('decodes live records, revalidates disk records, and recovers from truncated cache files', async () => {
  let calls = 0;
  const app = await fixture(async () => {
    calls++;
    return Response.json([
      null,
      { ...result, seeders: { bad: true }, infoHash: 123, infoUrl: 'javascript:bad' },
    ]);
  });
  try {
    const first = await (await app.fetch('/api/match/search?q=Show')).json();
    expect(first.results[0].seeders).toBeUndefined();
    expect(first.results[0].infoHash).toBeUndefined();
    expect(first.results[0].infoUrl).toBeUndefined();
    expect((await (await app.fetch('/api/match/search?q=Show')).json()).cached).toBe(true);
    expect(calls).toBe(1);
    const name = (await readdir(join(app.dir, 'match-cache'))).find((name) =>
      name.startsWith('search-'),
    )!;
    await writeFile(join(app.dir, 'match-cache', name), '{');
    expect((await app.fetch('/api/match/search?q=Show')).status).toBe(200);
    expect(calls).toBe(2);
  } finally {
    await app.close();
  }
});
it('isolates numbering caches and supports explicit live refresh', async () => {
  const requests: URL[] = [];
  const app = await fixture(async (url) => {
    requests.push(url);
    return Response.json([result]);
  });
  try {
    for (const numbering of ['tvdb', 'release'])
      expect(
        (
          await app.fetch(
            `/api/match/search?q=Show%20S02E01&kind=sonarr&id=123&numbering=${numbering}`,
          )
        ).status,
      ).toBe(200);
    expect(requests.map((r) => r.searchParams.get('type'))).toEqual(['tvsearch', 'search']);
    expect(requests[1]?.searchParams.get('query')).toBe('Show S02E01');
    await app.fetch(
      '/api/match/search?q=Show%20S02E01&kind=sonarr&id=123&numbering=release&refresh=1',
    );
    expect(requests).toHaveLength(3);
  } finally {
    await app.close();
  }
});
it('coalesces indexer discovery, preserves valid data if disk writes fail, and shares service cooldowns', async () => {
  let indexers = 0;
  const app = await fixture(async (url) => {
    if (url.pathname.endsWith('/indexer')) {
      indexers++;
      await new Promise((r) => setTimeout(r, 30));
      return Response.json([
        { id: 1, name: 'Fixture', enable: true, supportsSearch: true, protocol: 'torrent' },
      ]);
    }
    return new Response('', { status: 429, headers: { 'Retry-After': '120' } });
  });
  try {
    await writeFile(join(app.dir, 'match-cache'), 'blocked');
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.fetch('/api/match/indexers')),
    );
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(indexers).toBe(1);
    expect((await app.fetch('/api/match/search?q=Show')).status).toBe(429);
    const paused = await app.fetch('/api/match/indexers?refresh=1');
    expect(paused.status).toBe(429);
    expect(Number(paused.headers.get('Retry-After'))).toBeGreaterThan(1);
    expect(indexers).toBe(1);
  } finally {
    await app.close();
  }
});
it('cancels an abandoned search and frees capacity for another query', async () => {
  let entered = false,
    aborted = false;
  const app = await fixture(async (url, options) => {
    if (url.searchParams.get('query') !== 'Slow') return Response.json([result]);
    entered = true;
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true },
      );
    });
  });
  try {
    const controller = new AbortController();
    const abandoned = app
      .fetch('/api/match/search?q=Slow', { signal: controller.signal })
      .catch(() => null);
    await vi.waitFor(() => expect(entered).toBe(true));
    const busy = await app.fetch('/api/match/search?q=Other');
    expect(busy.status).toBe(429);
    expect(busy.headers.get('Retry-After')).toBe('1');
    controller.abort();
    await abandoned;
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect((await app.fetch('/api/match/search?q=Other')).status).toBe(200);
  } finally {
    await app.close();
  }
});
