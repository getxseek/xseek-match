import { it, expect } from 'vitest';
import { splitSeasonInput } from '../src/search-input';
it('keeps partial and complete season numbers editable until committed', () => {
  for (const input of ['S', 'S0', 'S02', 'S1', 'S10', 'S100'])
    expect(splitSeasonInput(input, true)).toEqual({ season: '', input });
  expect(splitSeasonInput('S02', false)).toEqual({ season: '02', input: '' });
  expect(splitSeasonInput('S100', false)).toEqual({ season: '100', input: '' });
});
it('accepts an episode or separator as the end of a typed season', () => {
  expect(splitSeasonInput('S02E', true)).toEqual({ season: '02', input: 'E' });
  expect(splitSeasonInput('S02E04', true)).toEqual({ season: '02', input: 'E04' });
  expect(splitSeasonInput('S2 ', true)).toEqual({ season: '2', input: '' });
  expect(splitSeasonInput('S1234', false)).toEqual({ season: '', input: 'S1234' });
});
