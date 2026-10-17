import { it, expect, vi } from 'vitest';
import { StatisticsStore } from '../src/server/storage/statistics-store';
it('deduplicates tracker rows per hash and persists aggregate observations', () => {
  const stats = new StatisticsStore(':memory:');
  const hash = 'a'.repeat(40);
  stats.count('searches');
  stats.count('prowlarrRequests', 2);
  stats.overlap([
    { indexerId: 1, indexer: 'A', infoHash: hash },
    { indexerId: 1, indexer: 'A', infoHash: hash },
    { indexerId: 2, indexer: 'B', infoHash: hash.toUpperCase() },
    { indexerId: 3, indexer: 'C', infoHash: 'bad' },
  ]);
  expect(stats.snapshot()).toEqual({
    timings: [],
    counts: { searches: 1, prowlarrRequests: 2 },
    overlap: [{ aId: 1, bId: 2, a: 'A', b: 'B', total: 1, evidence: 'hash' }],
  });
  stats.close();
});

it('measures mean, median and p95 with a bounded sample window', () => {
  const stats = new StatisticsStore(':memory:');
  for (const n of [10, 20, 30, 100]) stats.timing('lookup_live', n);
  stats.timing('lookup_live', NaN);
  expect(stats.snapshot().timings[0]).toEqual({
    operation: 'lookup_live',
    count: 4,
    mean: 40,
    median: 25,
    p75: 30,
    p90: 100,
    p95: 100,
    min: 10,
    max: 100,
  });
  for (let n = 0; n < 1001; n++) stats.timing('lookup_cached', n);
  expect(stats.snapshot().timings.find((row) => row.operation === 'lookup_cached')?.count).toBe(
    1000,
  );
  stats.close();
});
it('records inferred releases without hashes and samples cached responses once', () => {
  const stats = new StatisticsStore(':memory:');
  const rows = [
    {
      indexerId: 1,
      indexer: 'A',
      title: 'Show.S01E01.1080p.WEB-DL.x264-GRP',
      size: 1000000,
      guid: '1',
    },
    {
      indexerId: 2,
      indexer: 'B',
      title: 'Show.S01E01.1080p.WEB-DL.x264-GRP',
      size: 1000000,
      guid: '2',
    },
  ];
  stats.overlap(rows, 'cached:1');
  stats.overlap(rows, 'cached:1');
  expect(stats.snapshot().overlap).toEqual([
    { aId: 1, bId: 2, a: 'A', b: 'B', total: 1, evidence: 'release' },
  ]);
  stats.close();
});

it('uses current indexer custom names for historical overlap without rewriting observations', () => {
  const stats = new StatisticsStore(':memory:');
  const hash = 'b'.repeat(40);
  stats.overlap([
    { indexerId: 12, indexer: 'Original A', infoHash: hash },
    { indexerId: 34, indexer: 'Original B', infoHash: hash },
  ]);
  expect(stats.snapshot({ '12': 'Friendly A', '34': 'Friendly B' }).overlap[0]).toEqual({
    aId: 12,
    bId: 34,
    a: 'Friendly A',
    b: 'Friendly B',
    total: 1,
    evidence: 'hash',
  });
  expect(stats.snapshot({ '12': 'Renamed' }).overlap[0]?.a).toBe('Renamed');
  expect(stats.snapshot().overlap[0]?.a).toBe('Original A');
  stats.close();
});

it('reuses summaries and prepared statements until relevant data changes', () => {
  const stats = new StatisticsStore(':memory:');
  stats.timing('lookup_live', 10);
  stats.count('searches');
  const first = stats.snapshot();
  const prepare = vi.spyOn((stats as any).db, 'prepare');
  const second = stats.snapshot();
  expect(second.timings).toBe(first.timings);
  expect(second.counts).toBe(first.counts);
  expect(prepare).not.toHaveBeenCalled();
  stats.count('searches');
  expect(stats.snapshot().timings).toBe(first.timings);
  expect(stats.snapshot().counts.searches).toBe(2);
  stats.timing('lookup_live', 30);
  expect(stats.snapshot().timings).not.toBe(first.timings);
  expect(stats.snapshot().timings[0]?.mean).toBe(20);
  prepare.mockRestore();
  stats.close();
});
it('defers queued overlap and deduplicates jobs before and after processing', async () => {
  const stats = new StatisticsStore(':memory:');
  const rows = [
    {
      indexerId: 1,
      indexer: 'A',
      title: 'Show.S01E01.1080p.WEB-DL.x264-GRP',
      size: 1000000,
      guid: '1',
    },
    {
      indexerId: 2,
      indexer: 'B',
      title: 'Show.S01E01.1080p.WEB-DL.x264-GRP',
      size: 1000000,
      guid: '2',
    },
  ];
  stats.queueOverlap(rows, 'response-1');
  stats.queueOverlap(rows, 'response-1');
  expect(stats.snapshot().overlap).toEqual([]);
  await stats.flushOverlap();
  expect(stats.snapshot().overlap[0]?.total).toBe(1);
  stats.queueOverlap(rows, 'response-1');
  await stats.flushOverlap();
  expect(stats.snapshot().overlap[0]?.total).toBe(1);
  stats.close();
});
