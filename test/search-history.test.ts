import { it, expect } from 'vitest';
import {
  recentHistoryKey,
  visibleRecentHistory,
  historyKey,
  validHistoryEntry,
  searchJourneys,
  inferTvTitle,
  splitTvSearch,
} from '../src/search-history';
it('keeps enriched, generic and deep searches distinct for the same query', () => {
  const text = { query: 'Frieren', at: 1 };
  const deep = { ...text, mode: 'deep' as const };
  const enriched = {
    ...text,
    mode: 'enriched' as const,
    selection: {
      key: 'sonarr:424536',
      title: 'Frieren',
      kind: 'sonarr' as const,
      id: 424536,
      year: 2023,
      seasons: [1, 2],
      imdb: 'tt22248376',
    },
  };
  expect(validHistoryEntry({ ...enriched, mode: 'deep' })).toBe(true);
  expect(new Set([text, deep, enriched].map(historyKey)).size).toBe(3);
  for (const entry of [text, deep, enriched])
    expect(validHistoryEntry(JSON.parse(JSON.stringify(entry)))).toBe(true);
});
it('rejects incomplete enriched history and invalid identifiers while accepting legacy entries', () => {
  expect(validHistoryEntry({ query: 'Show S01', at: 1 })).toBe(true);
  expect(validHistoryEntry({ query: 'Show', at: 1, mode: 'enriched' })).toBe(false);
  expect(validHistoryEntry({ query: 'Show', at: 1, mode: 'other' })).toBe(false);
  expect(
    validHistoryEntry({
      query: 'Show',
      at: 1,
      mode: 'enriched',
      selection: { key: 'bad', title: 'Show', kind: 'sonarr', id: -1, year: null, seasons: [] },
    }),
  ).toBe(false);
});

it('groups title IDs into journeys and attaches only unambiguous text variants', () => {
  const selection = {
    key: 'sonarr:1',
    title: 'Mushoku Tensei: Jobless Reincarnation',
    kind: 'sonarr' as const,
    id: 1,
    year: 2021,
    seasons: [1, 2],
  };
  const history = [
    { query: 'Mushoku Tensei S02', at: 3 },
    { query: selection.title + ' S01', at: 2, mode: 'enriched' as const, selection },
    { query: selection.title + ' S01', at: 1, mode: 'deep' as const, selection },
  ];
  const groups = searchJourneys(history);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.entries.map((e) => e.at)).toEqual([3, 2, 1]);
  const remake = { ...selection, key: 'sonarr:2', id: 2, year: 2030 };
  expect(
    searchJourneys([
      ...history,
      { query: remake.title, at: 4, mode: 'enriched', selection: remake },
    ]),
  ).toHaveLength(3);
});
it('infers only a unique strong TV match and preserves season/episode text', () => {
  const tv = { kind: 'sonarr', id: 1, title: 'Mushoku Tensei: Jobless Reincarnation' };
  expect(
    inferTvTitle([tv, { kind: 'radarr', id: 2, title: 'Mushoku Tensei' }], 'Mushoku Tensei S02'),
  ).toEqual(tv);
  expect(inferTvTitle([tv, { ...tv, id: 2 }], 'Mushoku Tensei S02')).toBeNull();
  expect(inferTvTitle([tv], 'Mushoku S02')).toBeNull();
  expect(inferTvTitle([tv], 'Mushoku Tensei')).toEqual(tv);
  expect(inferTvTitle([tv], 'Jobless Reincarnation')).toEqual(tv);
  expect(
    inferTvTitle(
      [tv, { ...tv, id: 2, title: 'Another Jobless Reincarnation' }],
      'Jobless Reincarnation',
    ),
  ).toBeNull();
  expect(inferTvTitle([tv], 'Jobless Reincarn')).toBeNull();
  expect(inferTvTitle([{ ...tv, aliases: ['Sousou no Frieren'] }], 'Sousou no Frieren')).toEqual({
    ...tv,
    aliases: ['Sousou no Frieren'],
  });
  expect(splitTvSearch('Mushoku Tensei S01e04')).toEqual({
    title: 'Mushoku Tensei',
    suffix: 'S01E04',
  });
});

it('merges unique subtitle searches without depending on history order or discarding replay modes', () => {
  const selection = {
    key: 'sonarr:1',
    title: 'Mushoku Tensei: Jobless Reincarnation',
    kind: 'sonarr' as const,
    id: 1,
    year: 2021,
    seasons: [1, 2],
  };
  const entries = [
    { query: 'Jobless Reincarnation', at: 3 },
    { query: selection.title, at: 2, mode: 'enriched' as const, selection },
    { query: 'Jobless Reincarnation S02', at: 1 },
  ];
  for (const history of [entries, [...entries].reverse()]) {
    const groups = searchJourneys(history);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entries.map((entry) => entry.at)).toEqual([3, 2, 1]);
  }
  const other = { ...selection, id: 2, key: 'sonarr:2', title: 'Another Jobless Reincarnation' };
  expect(
    searchJourneys([...entries, { query: other.title, at: 4, mode: 'enriched', selection: other }]),
  ).toHaveLength(3);
});

it('preserves and distinguishes release numbering in saved searches', () => {
  const selection = {
    key: 'sonarr:1',
    title: 'Bookworm',
    kind: 'sonarr' as const,
    id: 1,
    year: 2019,
    seasons: [1],
  };
  const entry = { query: 'Bookworm S03', at: 1, mode: 'enriched' as const, selection };
  const release = { ...entry, selection: { ...selection, numbering: 'release' as const } };
  expect(validHistoryEntry(release)).toBe(true);
  expect(historyKey(release)).not.toBe(historyKey(entry));
  expect(validHistoryEntry({ ...entry, selection: { ...selection, numbering: 'unknown' } })).toBe(
    false,
  );
});

it('hides recent searches without modifying full history and allows later reruns', () => {
  const first = { query: 'Frieren', at: 1 },
    second = { query: 'Bookworm', at: 2 };
  const history = [first, second];
  const hidden = history.map(recentHistoryKey);
  expect(visibleRecentHistory(history, hidden)).toEqual([]);
  expect(history).toEqual([first, second]);
  expect(visibleRecentHistory([{ ...first, at: 3 }, ...history], hidden)).toEqual([
    { ...first, at: 3 },
  ]);
  expect(visibleRecentHistory(history, [recentHistoryKey(first)])).toEqual([second]);
});
