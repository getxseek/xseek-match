import { describe, it, expect } from 'vitest';
import { decodeResults, safeInfoUrl } from '../src/contracts/search';
import { groupResults } from '../src/domain/matching/group';
import { prowlarrQuery } from '../src/server/lib/search-query';

const row = {
  guid: 'fixture',
  title: 'Show.S01.1080p.WEB-DL.x264-GRP',
  indexerId: 1,
  indexer: 'Fixture',
  size: 1000,
};
describe('untrusted search records', () => {
  it('keeps valid rows and strips malformed optional values', () => {
    const rows = decodeResults([
      null,
      [],
      { ...row, seeders: { bad: true }, infoHash: { bad: true }, infoUrl: 'javascript:alert(1)' },
      { ...row, indexerId: -1 },
      { ...row, title: 'x'.repeat(1001) },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      size: 1000,
      seeders: undefined,
      infoHash: undefined,
      infoUrl: undefined,
    });
  });
  it.each([NaN, Infinity, -1, '100'])('normalizes invalid sizes (%s)', (size) =>
    expect(decodeResults([{ ...row, size }])[0]?.size).toBe(0),
  );
  it('bounds records and rejects an invalid top-level contract', () => {
    expect(() => decodeResults({ results: [] })).toThrow();
    expect(() => decodeResults(Array(10001).fill(row))).toThrow();
    expect(decodeResults([{ ...row, protocol: 'usenet' }], true)).toEqual([]);
  });
  it('removes credential-bearing links and unnecessary parameters', () => {
    expect(safeInfoUrl('https://user:pass@tracker.test/details.php?id=123')).toBeUndefined();
    expect(safeInfoUrl('https://tracker.test/details.php?id=123&passkey=synthetic#private')).toBe(
      'https://tracker.test/details.php?id=123',
    );
  });
});
describe('matching and numbering contracts', () => {
  it.each([40, 64])('groups equivalent %i-character hashes despite renamed titles', (length) => {
    const infoHash = 'a'.repeat(length);
    const groups = groupResults([
      { ...row, infoHash },
      {
        ...row,
        guid: 'other',
        indexerId: 2,
        title: 'Renamed',
        size: 99999,
        infoHash: infoHash.toUpperCase(),
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.evidence).toBe('hash');
  });
  it('never mistakes release numbers for structured TVDB episode tokens', () => {
    const tvdb = prowlarrQuery(
      new URLSearchParams('kind=sonarr&id=123&numbering=tvdb'),
      'Show S01E15',
    );
    const release = prowlarrQuery(
      new URLSearchParams('kind=sonarr&id=123&numbering=release'),
      'Show S02E01',
    );
    expect(tvdb).toEqual({ type: 'tvsearch', query: 'Show {tvdbid:123} {season:1} {episode:15}' });
    expect(release).toEqual({ type: 'search', query: 'Show S02E01' });
  });
  it.each(['numbering=bad', 'kind=radarr&id=1&numbering=release'])(
    'rejects invalid numbering (%s)',
    (params) => expect(() => prowlarrQuery(new URLSearchParams(params), 'Show')).toThrow(),
  );
  it('does not bridge conflicting sources for any ordering', () => {
    const rows = [
      { ...row, guid: '1', title: 'Show.S01.1080p.H264-GRP' },
      { ...row, guid: '2', indexerId: 2, title: 'Show.S01.1080p.WEB-DL.H264-GRP' },
      { ...row, guid: '3', indexerId: 3, title: 'Show.S01.1080p.BluRay.H264-GRP' },
    ];
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ])
      expect(groupResults(order.map((i) => rows[i]!))).toHaveLength(2);
  });
});
