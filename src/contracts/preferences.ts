import { validHistoryEntry } from '../search-history.js';
import { parseThemePreference, themeKey } from './theme.js';
/** Bounds and default for the xseek-match-cache-ttl preference: 15 minutes to one year. */
export const SEARCH_TTL_MINUTES_MIN = 15;
export const SEARCH_TTL_MINUTES_DEFAULT = 60;
export const SEARCH_TTL_MINUTES_MAX = 525_600;
export const preferenceKeys = [
  'xseek-match-recent-hidden',
  'xseek-match-strict-arr',
  'xseek-match-matching',
  'xseek-match-excluded-trackers',
  'xseek-match-important',
  'xseek-match-shortnames',
  'xseek-match-customnames',
  'xseek-match-history',
  'xseek-match-page',
  'xseek-match-category',
  'xseek-match-cache-ttl',
  themeKey,
];
export function validatePreferences(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) {
    if (!preferenceKeys.includes(key) || typeof value !== 'string' || value.length > 100000)
      throw new Error('Invalid preference');
    if (!['xseek-match-page', 'xseek-match-category'].includes(key)) JSON.parse(value);
  }
  for (const [key, value] of Object.entries(values)) {
    const parsed = ['xseek-match-page', 'xseek-match-category'].includes(key)
      ? value
      : JSON.parse(value);
    const ids = (v: unknown) =>
      Array.isArray(v) && v.every((id) => Number.isSafeInteger(id) && id > 0);
    const record = (v: unknown) =>
      !!v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.entries(v).every(
        ([id, name]) => /^\d+$/.test(id) && typeof name === 'string' && name.length <= 60,
      );
    let valid = true;
    if (key === 'xseek-match-strict-arr') valid = typeof parsed === 'boolean';
    if (key === 'xseek-match-page') valid = ['search', 'settings', 'history'].includes(parsed);
    if (key === 'xseek-match-category')
      valid = [
        'info',
        'indexers',
        'matching',
        'cache',
        'logs',
        'tasks',
        'account',
        'integrations',
        'statistics',
        'appearance',
      ].includes(parsed);
    if (key === 'xseek-match-excluded-trackers' || key === 'xseek-match-important')
      valid = ids(parsed);
    if (key === 'xseek-match-customnames' || key === 'xseek-match-shortnames')
      valid = record(parsed);
    if (key === 'xseek-match-matching')
      valid =
        parsed &&
        Number.isFinite(parsed.allowedPercent) &&
        Number.isFinite(parsed.disallowedPercent) &&
        parsed.allowedPercent >= 0 &&
        parsed.allowedPercent < parsed.disallowedPercent &&
        parsed.disallowedPercent <= 100;
    if (key === 'xseek-match-recent-hidden')
      valid =
        Array.isArray(parsed) &&
        parsed.length <= 100 &&
        parsed.every((value) => typeof value === 'string' && value.length <= 1000);
    if (key === 'xseek-match-history')
      valid = Array.isArray(parsed) && parsed.length <= 30 && parsed.every(validHistoryEntry);
    if (key === themeKey) valid = parseThemePreference(value) !== null;
    if (key === 'xseek-match-cache-ttl')
      valid =
        Number.isInteger(parsed) &&
        parsed >= SEARCH_TTL_MINUTES_MIN &&
        parsed <= SEARCH_TTL_MINUTES_MAX;
    if (!valid) throw new Error('Invalid preference value');
  }
}
export function validPreference(key: string, value: unknown): value is string {
  try {
    validatePreferences({ [key]: value as string });
    return true;
  } catch {
    return false;
  }
}
