import { it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Integrations } from '../src/server/services/integrations-service';
import { probeConnection } from '../src/server/services/connection-client';
import { blockedAddress, validateBaseUrl } from '../src/server/lib/safe-url';
import { createApp } from '../src/server/http';
const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    ),
  );
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

it('stores multiple named connections, hides keys and retains a blank key on edit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-integrations-'));
  const checked: string[] = [];
  const store = new Integrations(dir, async (row) => {
    checked.push(row.apiKey);
    if (row.apiKey === 'bad-key') throw new Error('API key rejected.');
    return 'Connected · test';
  });
  try {
    const first = await store.execute({
      action: 'save',
      kind: 'sonarr',
      name: 'HD',
      baseUrl: 'http://sonarr:8989/base/',
      apiKey: 'test-key',
    });
    await store.execute({
      action: 'save',
      kind: 'sonarr',
      name: '4K',
      baseUrl: 'http://sonarr-4k:8989',
      apiKey: 'another-key',
    });
    expect(store.list()).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain('test-key');
    expect(store.list()[0]!.hasApiKey).toBe(true);
    const id = store.list().find((row) => row.name === 'HD')!.id;
    await store.execute({ action: 'save', id, name: 'Main', apiKey: '' });
    expect(checked.at(-1)).toBe('test-key');
    expect(store.list().find((row) => row.id === id)!.baseUrl).toBe('http://sonarr:8989/base');
    await expect(
      store.execute({ action: 'save', id, name: 'Bad edit', apiKey: 'bad-key' }),
    ).rejects.toThrow('rejected');
    expect(store.list().find((row) => row.id === id)!.name).toBe('Main');
    await store.execute({ action: 'enabled', id, enabled: false });
    expect(store.list().find((row) => row.id === id)!.enabled).toBe(false);
    await store.execute({ action: 'test', id });
    expect(checked.at(-1)).toBe('test-key');
    await store.execute({ action: 'delete', id });
    expect(store.list()).toHaveLength(1);
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('validates connection destinations while supporting private Docker/LAN addresses', () => {
  expect(validateBaseUrl('http://sonarr:8989/base/')).toBe('http://sonarr:8989/base');
  for (const url of [
    'file:///etc/passwd',
    'http://user:password@sonarr',
    'http://sonarr?apikey=secret',
    'http://169.254.169.254',
    'http://[fe80::1]',
    'http://[fd00:ec2::254]',
    'http://0.0.0.0',
    'http://224.0.0.1',
  ])
    expect(() => validateBaseUrl(url)).toThrow();
  expect(blockedAddress('::ffff:a9fe:a9fe')).toBe(true);
  expect(blockedAddress('10.1.2.3')).toBe(false);
  expect(blockedAddress('127.0.0.1')).toBe(false);
});

it('probes supported service APIs without following redirects or returning upstream error bodies', async () => {
  let trap = false;
  const keys: string[] = [];
  const upstream = createServer((req, res) => {
    keys.push(String(req.headers['x-api-key']));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/sonarr/api/v3/system/status')
      res.end(JSON.stringify({ appName: 'Sonarr', version: '4.0.1' }));
    else if (req.url === '/radarr/api/v3/system/status')
      res.end(JSON.stringify({ appName: 'Radarr', version: '5.0.1' }));
    else if (req.url === '/qui/api/instances')
      res.end(JSON.stringify([{ id: 1, name: 'qBittorrent' }]));
    else if (req.url?.startsWith('/redirect/')) {
      res.statusCode = 302;
      res.setHeader('Location', '/trap');
      res.end();
    } else if (req.url === '/trap') {
      trap = true;
      res.end('{}');
    } else {
      res.statusCode = 401;
      res.end('upstream-secret-body');
    }
  });
  const base = await listen(upstream);
  try {
    expect(
      await probeConnection({ kind: 'sonarr', baseUrl: base + '/sonarr', apiKey: 'test-key' }),
    ).toContain('4.0.1');
    expect(
      await probeConnection({ kind: 'radarr', baseUrl: base + '/radarr', apiKey: 'test-key' }),
    ).toContain('5.0.1');
    expect(
      await probeConnection({ kind: 'qui', baseUrl: base + '/qui', apiKey: 'test-key' }),
    ).toContain('1 client instance');
    expect(
      await probeConnection({
        kind: 'sonarr',
        baseUrl: base.replace('127.0.0.1', 'localhost') + '/sonarr',
        apiKey: 'test-key',
      }),
    ).toContain('4.0.1');
    await expect(
      probeConnection({ kind: 'sonarr', baseUrl: base + '/redirect', apiKey: 'test-key' }),
    ).rejects.toThrow('redirected');
    expect(trap).toBe(false);
    await expect(
      probeConnection({ kind: 'sonarr', baseUrl: base + '/bad', apiKey: 'test-key' }),
    ).rejects.toThrow('API key rejected');
    expect(keys.every((k) => k === 'test-key')).toBe(true);
  } finally {
    await close(upstream);
  }
});

it('protects integration APIs and never exposes saved credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-integrations-http-'));
  const origin = 'http://localhost:5178';
  const upstream = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ appName: 'Sonarr', version: '4.0.1' }));
  });
  const target = await listen(upstream);
  const server = createApp({ APP_ORIGIN: origin }, dir, dir);
  const base = await listen(server);
  try {
    expect((await fetch(base + '/api/match/integrations')).status).toBe(401);
    const setup = await fetch(base + '/api/auth/setup', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'test-password' }),
    });
    const state = await setup.json();
    const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
    const post = (body: unknown, csrf = true) =>
      fetch(base + '/api/match/integrations', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: cookie,
          ...(csrf ? { 'X-CSRF-Token': state.csrf } : {}),
        },
        body: JSON.stringify(body),
      });
    const payload = {
      action: 'save',
      kind: 'sonarr',
      name: 'Main',
      baseUrl: target,
      apiKey: 'private-test-key',
    };
    expect((await post(payload, false)).status).toBe(403);
    const saved = await post(payload);
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain('private-test-key');
    const list = await fetch(base + '/api/match/integrations', { headers: { Cookie: cookie } });
    const text = await list.text();
    expect(text).toContain('Main');
    expect(text).not.toContain('private-test-key');
    expect(JSON.parse(text).connections[0].hasApiKey).toBe(true);
  } finally {
    await close(server);
    await server.drain();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('looks up enabled ARR instances, deduplicates results and caches successful reads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-lookup-'));
  let calls = 0;
  const upstream = createServer((req, res) => {
    if (req.url === '/api/v3/series') {
      res.end('[]');
      return;
    }
    calls++;
    expect(req.url).toContain('/api/v3/series/lookup?term=Example');
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify([
        {
          title: 'Example',
          originalTitle: 'Original Example',
          year: 2022,
          tvdbId: 123,
          seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }],
          apiKey: 'never-return',
        },
        { title: 'Bad', tvdbId: -1 },
      ]),
    );
  });
  const baseUrl = await listen(upstream);
  const store = new Integrations(dir, async () => 'Connected');
  try {
    for (const name of ['Main', 'Anime'])
      await store.execute({ action: 'save', kind: 'sonarr', name, baseUrl, apiKey: 'test-key' });
    const result = (await store.execute({
      action: 'lookup',
      title: 'Example',
      contentType: 'tv',
    })) as any;
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].originalTitle).toBe('Original Example');
    expect(result.matches[0].sources.sort()).toEqual(['Anime', 'Main']);
    expect(result.matches[0].seasons).toEqual([1, 2]);
    expect(JSON.stringify(result)).not.toContain('never-return');
    expect(
      ((await store.execute({ action: 'lookup', title: 'Example', contentType: 'tv' })) as any)
        .cached,
    ).toBe(true);
    expect(calls).toBe(2);
    const mixed = (await store.execute({
      action: 'lookup',
      title: 'Example',
      contentType: 'all',
    })) as any;
    expect(mixed.instances).toBe(2);
    expect(mixed.matches).toHaveLength(1);
    expect(
      ((await store.execute({ action: 'lookup', title: 'Example', contentType: 'movie' })) as any)
        .instances,
    ).toBe(0);
    await expect(
      store.execute({ action: 'lookup', title: 'x', contentType: 'tv' }),
    ).rejects.toThrow();
  } finally {
    await store.close();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('coalesces simultaneous identical title lookups without dropping either response', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-coalesce-'));
  let calls = 0;
  let answer: () => void = () => {};
  const upstream = createServer((req, res) => {
    if (req.url === '/api/v3/series') {
      res.end('[]');
      return;
    }
    calls++;
    answer = () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ title: 'Example', year: 2022, tvdbId: 123 }]));
    };
  });
  const baseUrl = await listen(upstream);
  const store = new Integrations(dir, async () => 'Connected');
  try {
    await store.execute({
      action: 'save',
      kind: 'sonarr',
      name: 'Main',
      baseUrl,
      apiKey: 'test-key',
    });
    const first = store.execute({ action: 'lookup', title: 'Example', contentType: 'tv' });
    const second = store.execute({ action: 'lookup', title: 'Example', contentType: 'tv' });
    while (!calls) await new Promise((resolve) => setTimeout(resolve, 5));
    answer();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(calls).toBe(1);
  } finally {
    await store.close();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('hydrates cached series-wide aliases by TVDb ID without leaking library paths or season aliases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-aliases-'));
  let libraryReads = 0;
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v3/series') {
      libraryReads++;
      res.end(
        JSON.stringify([
          {
            tvdbId: 424536,
            path: '/private/library',
            alternateTitles: [
              { title: 'Sousou no Frieren', sceneSeasonNumber: -1 },
              { title: 'Sousou no Frieren S2', sceneSeasonNumber: 2 },
            ],
          },
        ]),
      );
    } else
      res.end(
        JSON.stringify([{ title: "Frieren: Beyond Journey's End", year: 2023, tvdbId: 424536 }]),
      );
  });
  const baseUrl = await listen(upstream);
  const store = new Integrations(dir, async () => 'Connected');
  try {
    await store.execute({
      action: 'save',
      kind: 'sonarr',
      name: 'Anime',
      baseUrl,
      apiKey: 'test-key',
    });
    await store.warmAliases();
    for (const title of ['Sousou no', 'Frieren']) {
      const result = (await store.execute({ action: 'lookup', title, contentType: 'tv' })) as any;
      expect(result.matches[0].aliases).toEqual(['Sousou no Frieren']);
      expect(result.matches[0].directMatch).toBe(true);
      expect(JSON.stringify(result)).not.toContain('/private/library');
    }
    expect(libraryReads).toBe(1);
  } finally {
    await store.close();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('returns title suggestions before a slow library alias refresh completes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-fast-alias-'));
  let release: () => void = () => {};
  const upstream = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v3/series') release = () => res.end('[]');
    else res.end(JSON.stringify([{ title: 'Example', year: 2022, tvdbId: 123 }]));
  });
  const baseUrl = await listen(upstream);
  const store = new Integrations(dir, async () => 'Connected');
  try {
    await store.execute({
      action: 'save',
      kind: 'sonarr',
      name: 'Main',
      baseUrl,
      apiKey: 'test-key',
    });
    const result = (await store.execute({
      action: 'lookup',
      title: 'Example',
      contentType: 'tv',
    })) as any;
    expect(result.matches[0].title).toBe('Example');
    release();
    await store.warmAliases();
  } finally {
    release();
    await store.close();
    await close(upstream);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('does not expose title resolution through qui', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-qui-removed-'));
  const store = new Integrations(dir, async () => 'Connected');
  try {
    await store.execute({
      action: 'save',
      kind: 'qui',
      name: 'qui',
      baseUrl: 'http://localhost:7476',
      apiKey: 'key',
    });
    expect(store.list()[0]!.capabilities).toContain('torrent-presence');
    expect(store.list()[0]!.capabilities).not.toContain('title-resolution');
    await expect(
      store.execute({ action: 'resolve-fallback', title: 'Bookworm', contentType: 'tv' }),
    ).rejects.toThrow('Unknown action');
  } finally {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
