import { describe, it, expect } from 'vitest';
import {
  matchesResultCategories,
  resultCategories,
  type Result,
} from '../src/domain/matching/group';
const row: Result = {
  guid: 'a',
  title: 'Example',
  indexerId: 1,
  indexer: 'Test',
  size: 1,
  categories: [
    { id: 5040, name: 'TV/HD' },
    { id: 2000, name: 'Movies' },
  ],
};
describe('result categories', () => {
  it('normalizes subcategories', () => expect(resultCategories(row)).toEqual(['TV', 'Movies']));
  it('includes any selected category', () =>
    expect(matchesResultCategories(row, ['Books', 'TV'], [])).toBe(true));
  it('gives exclusions precedence', () =>
    expect(matchesResultCategories(row, ['TV'], ['Movies'])).toBe(false));
  it('keeps missing categories unknown', () => {
    const unknown = { ...row, categories: [] };
    expect(resultCategories(unknown)).toEqual(['Unknown']);
    expect(matchesResultCategories(unknown, ['TV'], [])).toBe(false);
    expect(matchesResultCategories(unknown, [], ['TV'])).toBe(true);
  });
});
