import { afterEach, expect, it, vi } from 'vitest';
import { TitleLookupCache } from '../src/web/match/search/title-lookup-cache';

const rows = [
  { title: 'Signal Zero', aliases: ['Zero Signal'] },
  { title: 'Horizon Line', originalTitle: 'Linea dell’orizzonte' },
  { title: 'Cinema Archive' },
];

afterEach(() => vi.useRealTimers());

it('serves exact repeats regardless of case and punctuation', () => {
  const cache = new TitleLookupCache<(typeof rows)[number]>();
  cache.set('Signal', 'tv', rows);
  expect(cache.get('signal', 'tv')).toBe(rows);
  expect(cache.get('SIGNAL!', 'tv')).toBe(rows);
  expect(cache.get('signal', 'movie')).toBeUndefined();
});

it('previews the longest earlier prefix narrowed to the new text', () => {
  const cache = new TitleLookupCache<(typeof rows)[number]>();
  cache.set('si', 'tv', rows);
  cache.set('sig', 'tv', rows.slice(0, 1));
  expect(cache.preview('signal z', 'tv')).toEqual([rows[0]]);
  expect(cache.preview('ho', 'tv')).toBeUndefined();
});

it('matches original titles and aliases while previewing', () => {
  const cache = new TitleLookupCache<(typeof rows)[number]>();
  cache.set('l', 'tv', rows);
  expect(cache.preview('linea', 'tv')).toEqual([rows[1]]);
  cache.set('z', 'tv', rows);
  expect(cache.preview('zero sig', 'tv')).toEqual([rows[0]]);
});

it('expires entries after fifteen minutes', () => {
  vi.useFakeTimers();
  const cache = new TitleLookupCache<(typeof rows)[number]>();
  cache.set('signal', 'tv', rows);
  vi.advanceTimersByTime(15 * 60_000);
  expect(cache.get('signal', 'tv')).toBeUndefined();
  expect(cache.preview('signal z', 'tv')).toBeUndefined();
});
