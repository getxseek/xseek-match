import { it, expect } from 'vitest';
import { trackerEntry, commentEntries } from '../src/tracker-entry';
it('normalizes tracker entry links while preserving host and ID identity', () => {
  expect(trackerEntry('http://www.tracker-a.example/torrents/0258790?tracking=1')).toBe(
    'tracker-a.example:258790',
  );
  expect(trackerEntry('https://tracker-b.example/torrents/703727')).toBe(
    'tracker-b.example:703727',
  );
  expect(trackerEntry('https://example.org/details.php?id=42')).toBe('example.org:42');
  for (const url of [
    'https://example.org/download/42',
    'https://example.org/torrents/0',
    'https://user:secret@example.org/torrents/42',
    'file:///torrents/42',
  ])
    expect(trackerEntry(url)).toBeNull();
  expect([
    ...commentEntries(
      'Source: [https://tracker-a.example/torrents/258790]. https://tracker-b.example/torrents/703727',
    ),
  ]).toEqual(['tracker-a.example:258790', 'tracker-b.example:703727']);
});
