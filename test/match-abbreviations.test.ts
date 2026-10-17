import { beforeEach, expect, it } from 'vitest';
import {
  clearTrackerDefinitions,
  trackerAbbreviation,
  updateTrackerDefinitions,
} from '../src/web/match/settings/indexers/tracker-abbreviations.js';

beforeEach(() => {
  clearTrackerDefinitions();
});

it('returns null when definitions have not yet been populated', () => {
  expect(trackerAbbreviation('TrackerAlpha (API)')).toBeNull();
  expect(trackerAbbreviation('TrackerBeta')).toBeNull();
});

it('matches Prowlarr API labels against spreadsheet definitions once updated', () => {
  updateTrackerDefinitions([
    { Name: 'TrackerAlpha', Abbreviation: 'TA' },
    { Name: 'TrackerBeta', Abbreviation: 'TB' },
    { Name: 'Signal Zero', Abbreviation: 'SZ' },
  ]);

  expect(trackerAbbreviation('TrackerAlpha (API)')).toBe('TA');
  expect(trackerAbbreviation('TrackerBeta')).toBe('TB');
  expect(trackerAbbreviation('Signal Zero')).toBe('SZ');
});

it('falls back to the bare name when a Prowlarr label carries a domain suffix', () => {
  updateTrackerDefinitions([{ Name: 'SignalZero', Abbreviation: 'SZ' }]);
  expect(trackerAbbreviation('SignalZero.io')).toBe('SZ');
  expect(trackerAbbreviation('SignalZero.io (API)')).toBe('SZ');
});

it('leaves unknown trackers without an invented abbreviation', () => {
  updateTrackerDefinitions([{ Name: 'TrackerAlpha', Abbreviation: 'TA' }]);
  expect(trackerAbbreviation('Unknown Example Tracker')).toBeNull();
  expect(trackerAbbreviation('Unknown.io')).toBeNull();
});
