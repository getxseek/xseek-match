import { preferredQuiMatches, hasQuiMatch } from '../src/qui-result';
import { it, expect } from 'vitest';
import {
  QuiFeatures,
  presenceRows,
  validateHashes,
  matchQuiReleases,
  validateReleases,
} from '../src/server/services/qui-service';
const hash = 'a'.repeat(40),
  connection = {
    id: 'qui',
    name: 'Main qui',
    baseUrl: 'https://qui.example/base',
    apiKey: 'private-key',
  };
it('exposes only exact-hash context and safe links, with no paths or credentials', () => {
  const rows = presenceRows(
    {
      total: 1,
      torrents: [
        {
          hash,
          progress: 1,
          state: 'stalledUP',
          save_path: '/private/library',
          name: 'private-name',
          tracker: 'secret-passkey',
        },
      ],
    },
    connection,
    { id: 2, name: 'Seedbox' },
    new Set([hash]),
  );
  expect(rows).toEqual([
    {
      hash,
      connection: 'Main qui',
      client: 'Seedbox',
      state: 'seeding',
      url: `https://qui.example/base/instances/2?torrent=${hash}`,
    },
  ]);
  expect(JSON.stringify(rows)).not.toMatch(/private|passkey/);
  expect(
    presenceRows(
      { total: 1, torrents: [{ hash: 'b'.repeat(40) }] },
      connection,
      { id: 2, name: 'Seedbox' },
      new Set([hash]),
    ),
  ).toEqual([]);
  expect(() =>
    presenceRows(
      { total: 300, torrents: [] },
      connection,
      { id: 2, name: 'Seedbox' },
      new Set([hash]),
    ),
  ).toThrow();
});

it('reports omitted clients as incomplete even when the client list is cached', async () => {
  let torrentReads = 0;
  const qui = new QuiFeatures(async (_, path) => {
    if (path === '/api/instances')
      return Array.from({ length: 33 }, (_, i) => ({ id: i + 1, name: `Client ${i}` }));
    torrentReads++;
    return { total: 0, torrents: [] };
  });
  const release = { key: 'fixture', title: 'Show.S01.1080p.WEB-DL.x264-GRP', size: 1000 };
  expect((await qui.releasePresence([connection], [release], 'Show')).truncated).toBe(true);
  expect((await qui.releasePresence([connection], [release], 'Show')).truncated).toBe(true);
  expect(torrentReads).toBe(32);
  await qui.close();
});
it('batches cached hash-filtered reads and coalesces duplicate requests', async () => {
  let calls = 0;
  const qui = new QuiFeatures(async (_, path) => {
    calls++;
    if (path === '/api/instances') return [{ id: 1, name: 'Client' }];
    expect(JSON.parse(new URL('http://fixture' + path).searchParams.get('filters')!)).toEqual({
      hashes: [hash],
    });
    return { total: 1, torrents: [{ hash, state: 'downloading', progress: 0.5 }] };
  });
  const [first, second] = await Promise.all([
    qui.presence([connection], [hash]),
    qui.presence([connection], [hash]),
  ]);
  expect(first).toEqual(second);
  expect(first.matches[0]?.state).toBe('downloading');
  await qui.presence([connection], [hash]);
  expect(calls).toBe(2);
  qui.clear();
  await qui.presence([connection], [hash]);
  expect(calls).toBe(4);
});
it('does not claim absence when a client fails and validates hash batches', async () => {
  const qui = new QuiFeatures(async (_, path) => {
    if (path === '/api/instances') return [{ id: 1, name: 'Offline' }];
    throw Error('private upstream response');
  });
  expect(await qui.presence([connection], [hash])).toEqual({
    ok: true,
    matches: [],
    failed: 1,
    configured: true,
  });
  expect(validateHashes([hash])).toEqual([hash]);
  expect(() => validateHashes(['not-a-hash'])).toThrow();
  expect(() => validateHashes(Array(101).fill(hash))).toThrow();
});

it('finds same releases without infohashes while rejecting other seasons and encodes', () => {
  const title =
    'Mushoku.Tensei.Jobless.Reincarnation.S02.1080p.CR.WEB-DL.DUAL.DDP2.0.H.264-Kitsune';
  const release = { key: 'result-1', title, size: 36621946689 };
  const candidates = [
    { hash, state: 'stalledUP', progress: 1, name: title, size: 36621946689 },
    {
      hash: 'b'.repeat(40),
      state: 'stalledUP',
      progress: 1,
      name: title.replace('S02', 'S01'),
      size: 36621946689,
    },
    {
      hash: 'c'.repeat(40),
      state: 'stalledUP',
      progress: 1,
      name: title.replace('1080p', '720p'),
      size: 36621946689,
    },
    { hash: 'd'.repeat(40), state: 'stalledUP', progress: 1, name: title, size: 1000000 },
  ];
  expect(matchQuiReleases([release], candidates, connection, { id: 1, name: 'Client' })).toEqual([
    {
      hash,
      connection: 'Main qui',
      client: 'Client',
      state: 'seeding',
      url: `https://qui.example/base/instances/1?torrent=${hash}`,
      resultKey: 'result-1',
      evidence: 'release',
    },
  ]);
  expect(
    matchQuiReleases([{ ...release, hash }], candidates.slice(0, 1), connection, {
      id: 1,
      name: 'Client',
    })[0]?.evidence,
  ).toBe('release');
  expect(() => validateReleases([{ key: 'bad', title: 'Show', size: -1 }])).toThrow();
});
it('searches qui by title once and reuses candidates across result batches', async () => {
  const title = 'Show.S02.1080p.WEB-DL.x264-GRP';
  let searches = 0;
  const qui = new QuiFeatures(async (_, path) => {
    if (path === '/api/instances') return [{ id: 1, name: 'Client' }];
    const url = new URL('http://fixture' + path);
    expect(url.searchParams.get('search')).toBe('Show');
    searches++;
    return {
      total: 1,
      torrents: [{ name: title, size: 10000, hash, progress: 1, state: 'stalledUP' }],
    };
  });
  const first = await qui.releasePresence(
    [connection],
    [{ key: '1', title, size: 10000 }],
    'Show S02',
  );
  const second = await qui.releasePresence(
    [connection],
    [{ key: '2', title, size: 10000 }],
    'Show S02',
  );
  expect(first.matches[0]?.resultKey).toBe('1');
  expect(second.matches[0]?.resultKey).toBe('2');
  expect(searches).toBe(1);
});

it('uses tracker host and torrent ID from comments without trusting a reported hash', () => {
  const title = 'Show.S02.1080p.WEB-DL.x264-GRP';
  const release = {
    key: 'entry',
    title,
    size: 10000,
    hash,
    sourceUrl: 'https://midnightscene.cc/torrents/45226?foo=bar',
  };
  const torrent = {
    hash,
    name: 'Renamed torrent',
    size: 500,
    state: 'stalledUP',
    progress: 1,
    comment:
      'This torrent was downloaded from MidnightScene. https://midnightscene.cc/torrents/45226',
  };
  const matches = matchQuiReleases([release], [torrent], connection, { id: 1, name: 'Client' });
  expect(matches[0]?.evidence).toBe('entry');
  expect(JSON.stringify(matches)).not.toContain('comment');
  expect(
    matchQuiReleases(
      [{ ...release, sourceUrl: 'https://tracker-other.example/torrents/45226' }],
      [torrent],
      connection,
      { id: 1, name: 'Client' },
    ),
  ).toEqual([]);
  expect(
    matchQuiReleases(
      [{ ...release, sourceUrl: 'https://midnightscene.cc/torrents/45227' }],
      [torrent],
      connection,
      { id: 1, name: 'Client' },
    ),
  ).toEqual([]);
  expect(
    matchQuiReleases(
      [release],
      [{ ...torrent, comment: undefined, name: title.replace('S02', 'S01'), size: 10000 }],
      connection,
      { id: 1, name: 'Client' },
    ),
  ).toEqual([]);
});

it('limits a tracker row to entry clients when source evidence exists', () => {
  const entry = { client: 'Source client', evidence: 'entry' },
    release = { client: 'Other copy client', evidence: 'release' };
  expect(preferredQuiMatches([release, entry])).toEqual([entry]);
  expect(preferredQuiMatches([release])).toEqual([release]);
  expect(preferredQuiMatches([entry, { ...entry, client: 'Second source client' }])).toHaveLength(
    2,
  );
});

it('requires tracker evidence for the flat-view qui filter', () => {
  expect(hasQuiMatch([{ evidence: 'release' }], true)).toBe(false);
  expect(hasQuiMatch([{ evidence: 'release' }])).toBe(true);
  expect(hasQuiMatch([{ evidence: 'release' }, { evidence: 'entry' }], true)).toBe(true);
  expect(hasQuiMatch(undefined, true)).toBe(false);
});
