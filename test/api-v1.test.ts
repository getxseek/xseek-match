import { ApiKeyStore } from '../src/server/storage/api-key-store';
import { Integrations } from '../src/server/services/integrations-service';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/http';
import { ApiKeys } from '../src/server/services/api-key-service';
import { parseApiSearch } from '../src/server/routes/api-v1-routes';
import { SearchService } from '../src/server/services/search-service';
import { SearchCacheStore } from '../src/server/storage/search-cache-store';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});
const scopes = ['search:read', 'titles:read', 'indexers:read'];
async function fixture(onSearch?: (signal?: AbortSignal | null) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'match-v1-'));
  const origin = 'http://127.0.0.1:5198';
  const native = globalThis.fetch;
  let upstreamCalls = 0;
  const searchUrls: URL[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('http://api-fixture.test')) {
      if (String(url).includes('/indexer'))
        return Response.json([
          {
            id: 1,
            name: 'Fixture',
            enable: true,
            supportsSearch: true,
            protocol: 'torrent',
            indexerUrls: ['https://private-tracker.test'],
          },
        ]);
      upstreamCalls++;
      searchUrls.push(new URL(String(url)));
      await onSearch?.(init?.signal);
      return Response.json([
        {
          protocol: 'torrent',
          guid: 'https://tracker.test/download?passkey=NEVER_EXPOSE',
          downloadUrl: 'NEVER_EXPOSE',
          indexerId: 1,
          indexer: 'Fixture',
          title: 'Show.S01',
          size: 100,
          infoUrl: 'https://tracker.test/details.php?id=1&passkey=NEVER_EXPOSE',
        },
      ]);
    }
    return native(url, init);
  });
  const app = createApp(
    {
      APP_ORIGIN: origin,
      PROWLARR_BASE_URL: 'http://api-fixture.test',
      PROWLARR_API_KEY: 'NEVER_EXPOSE',
    },
    dir,
    dir,
  );
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  cleanups.push(async () => {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await app.drain();
    spy.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });
  const setup = await native(base + '/api/auth/setup', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'fixture-password' }),
  });
  const cookie = setup.headers.get('set-cookie')!.split(';')[0]!;
  const csrf = (await setup.json()).csrf;
  const headers = {
    Origin: origin,
    Cookie: cookie,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  const manage = (input: object, overrides = {}) =>
    native(base + '/api/auth/keys', {
      method: 'POST',
      headers: { ...headers, ...overrides },
      body: JSON.stringify(input),
    });
  const created = await manage({
    action: 'create',
    name: 'consumer',
    scopes,
    password: 'fixture-password',
  });
  expect(created.status).toBe(201);
  const { token, key } = await created.json();
  const request = (path: string, init: RequestInit = {}, credential: string = token) =>
    native(base + path, {
      ...init,
      headers: { Authorization: `Bearer ${credential}`, ...init.headers },
    });
  return {
    dir,
    native,
    base,
    request,
    manage,
    token,
    key,
    headers,
    upstreamCalls: () => upstreamCalls,
    searchUrls,
  };
}

describe('API v1 boundary', () => {
  it('accepts only bearer keys and never falls back to owner cookies or grants internal access', async () => {
    const f = await fixture();
    for (const init of [
      {},
      { headers: { Cookie: f.headers.Cookie } },
      { headers: { Cookie: f.headers.Cookie, Authorization: 'Basic wrong' } },
    ] as RequestInit[]) {
      const response = await f.native(f.base + '/api/v1/me', init);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Bearer');
      expect((await response.json()).error.requestId).toBe(response.headers.get('x-request-id'));
    }
    expect(
      (await f.request('/api/match/integrations', { headers: { Cookie: f.headers.Cookie } }))
        .status,
    ).toBe(401);
    expect(
      (await f.request('/api/auth/status', { headers: { Cookie: f.headers.Cookie } })).status,
    ).toBe(401);
    expect((await f.request('/api/v1/me')).status).toBe(200);
    expect(
      (await f.request('/api/v1/me', { headers: { Authorization: `bearer ${f.token}` } })).status,
    ).toBe(200);
  });
  it('enforces scopes, revocation, expiry, hashes and the show-once management contract', async () => {
    const f = await fixture();
    const created = await f.manage({
      action: 'create',
      name: 'titles only',
      scopes: ['titles:read'],
      password: 'fixture-password',
    });
    const limited = await created.json();
    expect(
      (
        await f.request(
          '/api/v1/search',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{"query":"Show"}',
          },
          limited.token,
        )
      ).status,
    ).toBe(403);
    const listing = await (
      await f.native(f.base + '/api/auth/keys', { headers: f.headers })
    ).json();
    expect(JSON.stringify(listing)).not.toContain(f.token);
    expect(JSON.stringify(listing)).not.toContain('digest');
    const db = new DatabaseSync(join(f.dir, 'match.sqlite'));
    const row = db.prepare('SELECT digest FROM api_keys WHERE id = ?').get(f.key.id) as {
      digest: string;
    };
    expect(row.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(row.digest).not.toContain(f.token.split('.')[1]);
    db.prepare('UPDATE api_keys SET expires = ? WHERE id = ?').run(Date.now() - 1, limited.key.id);
    db.close();
    expect((await f.request('/api/v1/me', {}, limited.token)).status).toBe(401);
    expect(
      (await f.manage({ action: 'revoke', id: f.key.id, password: 'fixture-password' })).status,
    ).toBe(200);
    expect((await f.request('/api/v1/me')).status).toBe(401);
  });
  it('preserves CSRF/origin checks and requires password re-verification for key changes', async () => {
    const f = await fixture();
    const input = { action: 'create', name: 'blocked', scopes, password: 'fixture-password' };
    expect((await f.manage(input, { Origin: 'https://foreign.test' })).status).toBe(403);
    expect((await f.manage(input, { 'X-CSRF-Token': 'wrong' })).status).toBe(403);
    expect((await f.manage({ ...input, password: 'incorrect' })).status).toBe(401);
    expect(
      (await f.request('/api/v1/me', { headers: { Origin: 'https://foreign.test' } })).status,
    ).toBe(403);
  });
  it('shares browser search cache and returns bounded safe DTOs and honest completeness', async () => {
    const f = await fixture();
    const response = await f.request('/api/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Show', limit: 1 }),
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.results).toHaveLength(1);
    expect(data.meta.completeness).toBe('unknown');
    expect(data.meta.cached).toBe(false);
    expect(JSON.stringify(data)).not.toContain('NEVER_EXPOSE');
    expect(data.data.results[0].id).toMatch(/^[a-f0-9]{64}$/);
    const ui = await f.native(f.base + '/api/match/search?q=Show', {
      headers: { Cookie: f.headers.Cookie },
    });
    expect((await ui.json()).cached).toBe(true);
    expect(f.upstreamCalls()).toBe(1);
    const discovery = await (await f.request('/api/v1/indexers')).json();
    expect(discovery.data.indexers[0].id).toBe(1);
    expect(JSON.stringify(discovery)).not.toContain('private-tracker');
  });
  it('returns stable method/body/input/dependency errors and bounds key budgets', async () => {
    const f = await fixture();
    const method = await f.request('/api/v1/search');
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('POST');
    expect((await f.request('/api/v1/unknown')).status).toBe(404);
    for (const headers of [{}, { Origin: 'https://foreign.test' }] as Record<string, string>[]) {
      const root = await f.request('/api/v1', { method: 'POST', headers });
      expect(root.status).toBe(404);
      expect((await root.json()).error.code).toBe('not_found');
      expect(root.headers.get('x-request-id')).toBeTruthy();
    }
    expect((await f.request('/api/v1/search', { method: 'POST', body: '{}' })).status).toBe(415);
    const post = (body: string, path = '/api/v1/search') =>
      f.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    expect((await post('{bad')).status).toBe(400);
    expect((await post(JSON.stringify({ query: 'Show', refresh: true }))).status).toBe(400);
    expect((await post(JSON.stringify({ query: 'x'.repeat(20_000) }))).status).toBe(413);
    expect((await post('{"query":"Show","indexerIds":[999]}')).status).toBe(400);
    expect((await post('{"query":"Show","mediaType":"tv"}', '/api/v1/titles/lookup')).status).toBe(
      503,
    );
    let response = await f.request('/api/v1/me');
    for (let i = 0; i < 31 && response.status !== 429; i++)
      response = await f.request('/api/v1/me');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBeTruthy();
  });
});
it('maps typed title identity and rejects invalid or conflicting numbering', () => {
  const parsed = parseApiSearch({
    query: 'Example',
    selection: { mediaType: 'tv', ids: { tvdb: 123 }, season: 1, episode: 2 },
  });
  expect(parsed.params.get('q')).toBe('Example S01E02');
  expect(parsed.params.get('id')).toBe('123');
  for (const input of [
    { query: 'Example', selection: { mediaType: 'tv', ids: { tmdb: 123 } } },
    { query: 'Example', selection: { mediaType: 'movie', ids: { tmdb: 123 }, season: 1 } },
    { query: 'Example S02', selection: { mediaType: 'tv', ids: { tvdb: 123 }, season: 1 } },
    { query: 'Example', indexerIds: [] },
  ])
    expect(() => parseApiSearch(input)).toThrow();
});
it('keeps existing feature tables and keys across repeated initialization', () => {
  const db = new DatabaseSync(':memory:');
  const keys = new ApiKeys(db);
  const created = keys.create({ name: 'test', scopes: ['search:read'], expiresAt: null });
  const second = new ApiKeys(db);
  expect(second.authenticate(`Bearer ${created.token}`)?.name).toBe('test');
  expect(second.authenticate('Bearer ' + 'x'.repeat(1000))).toBeUndefined();
  second.revokeAll();
  expect(keys.authenticate(`Bearer ${created.token}`)).toBeUndefined();
  db.close();
});

it('sanitizes title DTOs, exposes partial availability and preserves typed lookup-to-search IDs', async () => {
  const f = await fixture();
  const spy = vi.spyOn(Integrations.prototype, 'execute').mockResolvedValue({
    matches: [
      {
        kind: 'sonarr',
        id: 123,
        title: 'Example',
        year: 2026,
        aliases: ['Alias'],
        source: 'PRIVATE_SOURCE',
        sources: ['PRIVATE_SOURCE'],
        libraryPath: 'PRIVATE_PATH',
      },
    ],
    failed: 1,
    instances: 2,
    enrichmentPending: true,
  });
  const lookup = () =>
    f.request('/api/v1/titles/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"query":"Example","mediaType":"all"}',
    });
  const response = await lookup();
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.meta.warnings[0].code).toBe('lookup_partial');
  expect(data.meta.enrichmentPending).toBe(true);
  expect(JSON.stringify(data)).not.toContain('PRIVATE_');
  const title = data.data.matches[0];
  expect(title.ids.tvdb).toBe(123);
  expect(
    parseApiSearch({
      query: title.title,
      selection: { mediaType: title.mediaType, ids: title.ids },
    }).params.get('kind'),
  ).toBe('sonarr');
  spy.mockResolvedValue({ matches: [], failed: 2, instances: 2 });
  expect((await lookup()).status).toBe(502);
});
it('shares browser/API live work and disconnecting one waiter preserves the remaining search', async () => {
  let release!: () => void;
  let entered = false;
  let upstreamSignal: AbortSignal | null | undefined;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = await fixture(async (signal) => {
    entered = true;
    upstreamSignal = signal;
    await ready;
  });
  const controller = new AbortController();
  const api = f
    .request('/api/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"query":"Shared"}',
      signal: controller.signal,
    })
    .catch(() => null);
  await vi.waitFor(() => expect(entered).toBe(true));
  const ui = f.native(f.base + '/api/match/search?q=Shared', {
    headers: { Cookie: f.headers.Cookie },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const busy = await f.request('/api/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"query":"Other"}',
  });
  expect(busy.status).toBe(429);
  controller.abort();
  await api;
  expect(upstreamSignal?.aborted).toBe(false);
  release();
  expect((await ui).status).toBe(200);
  expect(f.upstreamCalls()).toBe(1);
});

it('does not start upstream work when the caller disconnects during the cache lookup', async () => {
  const api = await fixture();
  const controller = new AbortController();
  let searchSignal: AbortSignal | undefined;
  let searchPromise: ReturnType<SearchService['search']> | undefined;
  const originalSearch = SearchService.prototype.search;
  vi.spyOn(SearchService.prototype, 'search').mockImplementation(function (
    this: SearchService,
    ...args
  ) {
    searchSignal = args[1];
    searchPromise = originalSearch.apply(this, args);
    return searchPromise;
  });
  vi.spyOn(SearchCacheStore.prototype, 'readSearch').mockImplementation(async () => {
    controller.abort();
    await vi.waitFor(() => expect(searchSignal?.aborted).toBe(true));
    return null;
  });
  await api
    .request('/api/v1/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"query":"Disconnect during cache read"}',
      signal: controller.signal,
    })
    .catch(() => undefined);
  await vi.waitFor(() => expect(searchPromise).toBeDefined());
  await expect(searchPromise).rejects.toMatchObject({ code: 'request_cancelled' });
  expect(api.upstreamCalls()).toBe(0);
});

it('sends an explicit positive indexer set even when it includes every known indexer', async () => {
  const f = await fixture();
  const response = await f.request('/api/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"query":"Explicit","indexerIds":[1]}',
  });
  expect(response.status).toBe(200);
  expect(f.searchUrls[0]!.searchParams.getAll('indexerIds')).toEqual(['1']);
  const ui = await f.native(f.base + '/api/match/search?q=Explicit', {
    headers: { Cookie: f.headers.Cookie },
  });
  expect((await ui.json()).cached).toBe(false);
  expect(f.upstreamCalls()).toBe(2);
});

it('rejects key creation when owner credentials change between verification and the protected write', async () => {
  const api = await fixture();
  const originalCreate = ApiKeyStore.prototype.create;
  vi.spyOn(ApiKeyStore.prototype, 'create').mockImplementation(function (
    this: ApiKeyStore,
    row,
    beforeWrite,
  ) {
    const resetConnection = new DatabaseSync(join(api.dir, 'match.sqlite'));
    resetConnection
      .prepare('UPDATE owner SET password = ? WHERE id = 1')
      .run('changed-by-cli-reset');
    resetConnection.close();
    return originalCreate.call(this, row, beforeWrite);
  });
  const response = await api.manage({
    action: 'create',
    name: 'stale verification',
    scopes,
    password: 'fixture-password',
  });
  expect(response.status).toBe(401);
  const listing = await api.native(api.base + '/api/auth/keys', { headers: api.headers });
  expect((await listing.json()).keys).toHaveLength(1);
});
