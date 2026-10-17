import { enabledCapabilities, integrationCapabilities } from '../src/integration-capabilities';
import { it, expect } from 'vitest';
import { prowlarrQuery } from '../src/server/lib/search-query';
import { posterUrl, rankTitles } from '../src/server/lib/media-titles';
it('uses Prowlarr structured TV searches and separates season/episode from the fallback title', () => {
  expect(
    prowlarrQuery(new URLSearchParams('kind=sonarr&id=371980&imdb=tt11280740'), 'Severance S01E02'),
  ).toEqual({
    type: 'tvsearch',
    query: 'Severance {tvdbid:371980} {imdbid:tt11280740} {season:1} {episode:2}',
  });
  expect(prowlarrQuery(new URLSearchParams('kind=sonarr&id=371980'), 'Severance')).toEqual({
    type: 'tvsearch',
    query: 'Severance {tvdbid:371980}',
  });
});
it('uses movie IDs while keeping ordinary unselected searches generic', () => {
  expect(prowlarrQuery(new URLSearchParams('kind=radarr&id=550'), 'Fight Club')).toEqual({
    type: 'movie',
    query: 'Fight Club {tmdbid:550}',
  });
  expect(prowlarrQuery(new URLSearchParams(), 'Show S01')).toEqual({
    type: 'search',
    query: 'Show S01',
  });
  for (const value of [
    'kind=qui&id=1',
    'kind=sonarr&id=-1',
    'kind=radarr&id=1x',
    'kind=sonarr&id=1&imdb=bad',
    'kind=sonarr',
  ])
    expect(() => prowlarrQuery(new URLSearchParams(value), 'Show')).toThrow();
});
it('only exposes artwork URLs from known HTTPS image hosts without credentials or query strings', () => {
  expect(posterUrl('https://image.tmdb.org/t/p/w500/poster.jpg')).toContain('image.tmdb.org');
  for (const url of [
    'http://image.tmdb.org/poster.jpg',
    'https://evil.example/poster.jpg',
    'https://user:secret@image.tmdb.org/p.jpg',
    'https://image.tmdb.org/p.jpg?apikey=secret',
  ])
    expect(posterUrl(url)).toBeUndefined();
});

it('ranks exact matches across TV and movies before substring matches and incomplete records', () => {
  const rows = [
    { title: 'Creature from the Black Lagoon', year: 1954 },
    { title: 'Black Lagoon', year: null },
    { title: 'Black Lagoon', year: 2006 },
  ];
  expect(rankTitles(rows, 'black lagoon')).toEqual(
    [rows[2], rows[1], rows[0]].map((row) => ({ ...row, directMatch: true })),
  );
  expect(rows[0]!.title).toBe('Creature from the Black Lagoon');
});

it('preserves upstream alias matches after direct title matches', () => {
  const rows = [
    { title: "Frieren: Beyond Journey's End", year: 2023 },
    { title: 'Pros and Cons', year: 2018 },
    { title: 'Labyrinth of Peace', year: 2020 },
    {
      title: 'Young Ones Are Even Cold in the Summer',
      originalTitle: 'Kleine frieren auch im Sommer',
      year: 1978,
    },
    { title: 'Gooische Frieten', year: 2010 },
  ];
  const ranked = rankTitles(rows, 'Frieren');
  expect(ranked).toHaveLength(rows.length);
  expect(ranked.slice(0, 2)).toEqual(
    [rows[0], rows[3]].map((row) => ({ ...row, directMatch: true })),
  );
  expect(ranked.slice(2).every((row) => !row.directMatch)).toBe(true);
  expect(rankTitles([{ title: "Frieren: Beyond Journey's End", year: 2023 }], 'Sousou no')).toEqual(
    [{ title: "Frieren: Beyond Journey's End", year: 2023, directMatch: false }],
  );
  expect(rankTitles([{ title: 'Amélie', year: 2001 }], 'amelie')).toHaveLength(1);
});

it('enables title lookup only for enabled providers with the required capability', () => {
  expect(
    enabledCapabilities([
      { kind: 'sonarr', enabled: false },
      { kind: 'radarr', enabled: false },
      { kind: 'qui', enabled: true },
    ]),
  ).not.toContain('tv-title-lookup');
  expect(
    enabledCapabilities([
      { kind: 'sonarr', enabled: false },
      { kind: 'radarr', enabled: false },
      { kind: 'qui', enabled: true },
    ]),
  ).not.toContain('movie-title-lookup');
  expect(enabledCapabilities([{ kind: 'sonarr', enabled: true }])).toContain('tv-title-lookup');
  expect(integrationCapabilities.qui).toContain('torrent-presence');
  expect(enabledCapabilities([])).toEqual([]);
});
