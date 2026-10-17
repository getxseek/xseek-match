import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  defaultTheme,
  parseThemePreference,
  serializeTheme,
  themeKey,
  themePresetIds,
} from '../src/contracts/theme';
import { validPreference } from '../src/contracts/preferences';
import { actionRoles, presets, themeRoles } from '../src/web/match/theme/presets';
import { contrast, presetTokens, resolveTheme } from '../src/web/match/theme/resolve';

const theme = (value: unknown) => JSON.stringify(value);

describe('theme preference contract', () => {
  it('accepts supported presets and normalizes accent case', () => {
    expect(parseThemePreference(theme({ version: 1, preset: 'midnight', accent: null }))).toEqual({
      version: 1,
      preset: 'midnight',
      accent: null,
    });
    expect(
      parseThemePreference(theme({ version: 1, preset: 'xseek', accent: '#AbCdEf' }))?.accent,
    ).toBe('#abcdef');
    expect(validPreference(themeKey, serializeTheme(defaultTheme))).toBe(true);
    expect(validPreference('xseek-match-category', 'appearance')).toBe(true);
  });
  it.each([
    ['missing', null],
    ['malformed JSON', '{'],
    ['array', '[]'],
    ['unknown version', theme({ version: 2, preset: 'xseek', accent: null })],
    ['unknown preset', theme({ version: 1, preset: 'vaporwave', accent: null })],
    ['missing accent', theme({ version: 1, preset: 'xseek' })],
    ['extra field', theme({ version: 1, preset: 'xseek', accent: null, css: 'x' })],
    ['short hex', theme({ version: 1, preset: 'xseek', accent: '#fff' })],
    ['css expression', theme({ version: 1, preset: 'xseek', accent: 'var(--x)' })],
    ['url', theme({ version: 1, preset: 'xseek', accent: 'url(https://x.test)' })],
    ['number', theme({ version: 1, preset: 'xseek', accent: 0xffffff })],
    ['oversized', theme({ version: 1, preset: 'xseek', accent: null, pad: 'x'.repeat(500) })],
  ])('rejects %s values', (_, value) => {
    expect(parseThemePreference(value)).toBeNull();
    expect(validPreference(themeKey, value)).toBe(false);
  });
});

describe('theme resolution', () => {
  it('keeps the CSS defaults in sync with the default preset', () => {
    const css = readFileSync('src/web/styles.css', 'utf8');
    const tokens = presetTokens('xseek');
    for (const role of themeRoles) expect(css).toContain(`--${role}: ${tokens[role]};`);
  });
  it('defines every role for every preset', () => {
    for (const id of themePresetIds)
      for (const role of themeRoles) expect(presetTokens(id)[role]).toMatch(/^#[0-9a-f]{6}$/);
  });
  it.each(themePresetIds)('%s meets text and indicator contrast on its surfaces', (id) => {
    const t = presetTokens(id);
    for (const surface of [t.background, t.card, t.muted]) {
      for (const text of [
        t.foreground,
        t['muted-foreground'],
        t['primary-text'],
        t['danger-text'],
        t['positive-text'],
        t.warning,
      ])
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.ring, surface)).toBeGreaterThanOrEqual(3);
    }
    // The original xseek button text (#fffbfa on #e5484d, about 3.9:1) is preserved deliberately;
    // new presets must meet normal-text contrast.
    expect(contrast(t['primary-foreground'], t.primary)).toBeGreaterThanOrEqual(
      id === 'xseek' ? 3.5 : 4.5,
    );
  });
  it('derives readable action roles from a custom accent without touching status roles', () => {
    const base = presetTokens('xseek');
    const { tokens, issues } = resolveTheme({ version: 1, preset: 'xseek', accent: '#3b82f6' });
    expect(issues).toEqual([]);
    expect(tokens.primary).toBe('#3b82f6');
    expect(tokens['chart-accent']).not.toBe(base['chart-accent']);
    expect(contrast(tokens['primary-foreground'], tokens.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens['primary-text'], tokens.background)).toBeGreaterThanOrEqual(4.5);
    for (const role of themeRoles.filter((role) => !actionRoles.includes(role)))
      expect(tokens[role]).toBe(base[role]);
    expect(tokens.danger).toBe('#e5484d');
    expect(tokens['chart-1']).toBe(base['chart-1']);
  });
  it('reports accents that cannot meet contrast instead of altering them', () => {
    const { tokens, issues } = resolveTheme({ version: 1, preset: 'xseek', accent: '#111111' });
    expect(tokens.primary).toBe('#111111');
    expect(issues.length).toBeGreaterThan(0);
  });
  it('switching presets or clearing the accent leaves no previous roles behind', () => {
    const custom = resolveTheme({ version: 1, preset: 'xseek', accent: '#3b82f6' }).tokens;
    expect(resolveTheme(defaultTheme).tokens).toEqual(presetTokens('xseek'));
    expect(resolveTheme({ version: 1, preset: 'midnight', accent: null }).tokens).toEqual(
      presetTokens('midnight'),
    );
    expect(custom).not.toEqual(presetTokens('xseek'));
    expect(Object.keys(presets)).toEqual([...themePresetIds]);
  });
});
