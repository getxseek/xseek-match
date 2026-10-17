import { describe, it, expect } from 'vitest';
import {
  groupResults,
  sizeConsistency,
  isFreeleech,
  type Result,
} from '../src/domain/matching/group.js';
const row = (
  indexerId: number,
  title = 'Show.S01.1080p.WEB-DL.H264-GROUP',
  size = 1000,
): Result => ({
  guid: `${indexerId}:${title}`,
  indexerId,
  indexer: `Tracker ${indexerId}`,
  title,
  size,
});
describe('search result grouping', () => {
  it('keeps movie years and daily air dates separate', () => {
    expect(
      groupResults([
        row(1, 'Movie.2020.1080p.BluRay.x264-GROUP'),
        row(2, 'Movie.2021.1080p.BluRay.x264-GROUP'),
      ]),
    ).toHaveLength(2);
    expect(
      groupResults([
        row(1, 'Show.2026.05.28.1080p.WEB-DL.H264-GROUP'),
        row(2, 'Show.2026.05.29.1080p.WEB-DL.H264-GROUP'),
      ]),
    ).toHaveLength(2);
  });
  it('keeps repacks and web providers separate', () => {
    expect(groupResults([row(1), row(2, 'Show.S01.REPACK.1080p.WEB-DL.H264-GROUP')])).toHaveLength(
      2,
    );
    expect(
      groupResults([
        row(1, 'Show.S01.1080p.AMZN.WEB-DL.H264-GROUP'),
        row(2, 'Show.S01.1080p.NF.WEB-DL.H264-GROUP'),
      ]),
    ).toHaveLength(2);
  });
  it('keeps episode ranges and season parts apart from each other and the whole season', () => {
    expect(
      groupResults([
        row(1, 'Show.S01.1080p.WEB-DL.H264-GROUP'),
        row(2, 'Show.S01E01-E03.1080p.WEB-DL.H264-GROUP'),
        row(3, 'Show.S01E04-E06.1080p.WEB-DL.H264-GROUP'),
      ]),
    ).toHaveLength(3);
    expect(
      groupResults([
        row(1, 'Show.S01.Part.1.1080p.WEB-DL.H264-GROUP'),
        row(2, 'Show.S01.Part.2.1080p.WEB-DL.H264-GROUP'),
        row(3, 'Show S01 Part 2 1080p WEB-DL H264-GROUP'),
      ]),
    ).toHaveLength(2);
  });
  it('treats anime v2 re-releases as repacks', () => {
    const r = (id: number, title: string): Result => ({
      guid: String(id),
      title,
      indexerId: id,
      indexer: 't' + id,
      size: 17180000000,
    });
    const groups = groupResults([
      r(
        1,
        "KONOSUBA - God's blessing on this wonderful world! AKA Kono subarashii sekai ni shukufuku o! S01 REPACK 1080p BluRay Dual-Audio Opus 2.0 x265-YURASUKA",
      ),
      r(
        2,
        'KonoSuba.Gods.Blessing.On.This.Wonderful.World.S01.v2.1080p.BluRay.Dual-Audio.Opus.2.0.x265-YURASUKA',
      ),
      r(
        3,
        'KonoSuba.Gods.Blessing.On.This.Wonderful.World.S01.1080p.BluRay.Dual-Audio.Opus.2.0.x265-YURASUKA',
      ),
    ]);
    expect(groups.length).toBe(2);
  });
  it('uses validated hashes even when titles differ', () => {
    const infoHash = 'a'.repeat(40);
    const groups = groupResults([
      { ...row(1), infoHash },
      { ...row(2, 'Renamed torrent'), infoHash: infoHash.toUpperCase() },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.evidence).toBe('hash');
    expect(
      groupResults([
        { ...row(1), infoHash: 'invalid' },
        { ...row(2, 'Unknown'), infoHash: 'invalid' },
      ]),
    ).toHaveLength(2);
  });
  it('does not let a missing source bridge conflicting sources', () => {
    expect(
      groupResults([
        row(1, 'Show.S01.1080p.H264-GROUP'),
        row(2),
        row(3, 'Show.S01.1080p.BluRay.H264-GROUP'),
      ]),
    ).toHaveLength(2);
  });

  it('groups equivalents across trackers and removes duplicate search rows', () => {
    expect(groupResults([row(1), row(2), row(1)])).toHaveLength(1);
    expect(groupResults([row(1), row(2), row(1)])[0]!.rows).toHaveLength(2);
  });
  it('keeps different seasons, episodes and codecs separate', () => {
    expect(
      groupResults([
        row(1),
        row(2, 'Show.S02.1080p.WEB-DL.H264-GROUP'),
        row(3, 'Show.S01E01.1080p.WEB-DL.H264-GROUP'),
        row(4, 'Show.S01.1080p.WEB-DL.H265-GROUP'),
      ]),
    ).toHaveLength(4);
  });
  it('flags size differences anywhere in a release group', () => {
    expect(
      groupResults([row(1, undefined, 1000), row(2, undefined, 1019), row(3, undefined, 1038)])[0]!
        .evidence,
    ).toBe('release_size_off');
  });
  it('marks missing sizes as unverified release matches', () => {
    expect(groupResults([row(1, undefined, 0), row(2, undefined, 0)])[0]!.evidence).toBe(
      'release_size_off',
    );
  });
});

it('shows freeleech only for an explicit full freeleech flag', () => {
  expect(isFreeleech({ ...row(1), indexerFlags: ['Freeleech'] })).toBe(true);
  expect(isFreeleech({ ...row(1), indexerFlags: ['Halfleech'] })).toBe(false);
  expect(isFreeleech(row(1))).toBe(false);
});

it('identifies six agreeing sizes and a single outlier', () => {
  const rows = [1000, 1002, 1004, 1006, 1008, 1010, 1500].map((size, i) => row(i, undefined, size));
  const stats = sizeConsistency(rows);
  expect(stats.agree).toBe(6);
  expect(stats.outliers).toEqual([rows[6]]);
  expect(stats.reference).toBe(1005);
});
it('does not turn missing sizes or tied clusters into invalid matches', () => {
  const stats = sizeConsistency([
    row(1, undefined, 1000),
    row(2, undefined, 1010),
    row(3, undefined, 2000),
    row(4, undefined, 2010),
    row(5, undefined, 0),
  ]);
  expect(stats.majority).toBe(false);
  expect(stats.outliers).toEqual([]);
  expect(stats.missing).toBe(1);
});
it('does not chain size agreement past the tolerance', () => {
  expect(sizeConsistency([1000, 1019, 1038].map((size, i) => row(i, undefined, size))).agree).toBe(
    2,
  );
});

it('applies configurable allowed deviation to confidence', () => {
  const rows = [row(1, undefined, 1000), row(2, undefined, 1050)];
  expect(groupResults(rows)[0]!.evidence).toBe('release_size_off');
  expect(groupResults(rows, { allowedPercent: 5, disallowedPercent: 50 })[0]!.evidence).toBe(
    'release',
  );
});
it('separates sizes at the disallowed boundary', () => {
  expect(groupResults([row(1, undefined, 1000), row(2, undefined, 2000)])).toHaveLength(2);
  expect(groupResults([row(1, undefined, 1000), row(2, undefined, 1900)])).toHaveLength(1);
});
it('rejects reversed thresholds and preserves exact hash evidence', () => {
  expect(() => groupResults([], { allowedPercent: 50, disallowedPercent: 2 })).toThrow();
  const infoHash = 'f'.repeat(40);
  expect(
    groupResults([
      { ...row(1, undefined, 1000), infoHash },
      { ...row(2, undefined, 5000), infoHash },
    ])[0]!.evidence,
  ).toBe('hash');
});
