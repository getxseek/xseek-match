import { expect, it } from 'vitest';
import { posterSources } from '../src/web/match/search/poster-sources';

it('requests small TMDB sizes with a tiny blurred preview', () => {
  expect(posterSources('https://image.tmdb.org/t/p/original/abc123.jpg')).toEqual({
    preview: 'https://image.tmdb.org/t/p/w45/abc123.jpg',
    full: 'https://image.tmdb.org/t/p/w185/abc123.jpg',
  });
  expect(posterSources('https://image.tmdb.org/t/p/w500/abc123.jpg').full).toBe(
    'https://image.tmdb.org/t/p/w185/abc123.jpg',
  );
});

it('uses the TheTVDB thumbnail and keeps the original as a fallback', () => {
  expect(posterSources('https://artworks.thetvdb.com/banners/posters/81189-22.jpg')).toEqual({
    full: 'https://artworks.thetvdb.com/banners/posters/81189-22_t.jpg',
    fallback: 'https://artworks.thetvdb.com/banners/posters/81189-22.jpg',
  });
  expect(
    posterSources('https://artworks.thetvdb.com/banners/v4/series/1/posters/abc_t.jpg'),
  ).toEqual({ full: 'https://artworks.thetvdb.com/banners/v4/series/1/posters/abc_t.jpg' });
});

it('leaves other and malformed URLs untouched', () => {
  expect(posterSources('https://example.test/poster.jpg')).toEqual({
    full: 'https://example.test/poster.jpg',
  });
  expect(posterSources('not a url')).toEqual({ full: 'not a url' });
});
