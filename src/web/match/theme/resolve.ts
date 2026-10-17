import type { ThemePreference } from '../../../contracts/theme';
import {
  derivedRoles,
  presets,
  themeRoles,
  type BaseRole,
  type DerivedRole,
  type ThemeRole,
} from './presets';

export type ThemeTokens = Record<ThemeRole, string>;
type ResolvedTheme = { tokens: ThemeTokens; issues: string[] };

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const hex = (value: Rgb) =>
  '#' + value.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
// Linear sRGB mix, matching `color-mix(in srgb, ...)`; `amount` is the share of `to`.
export function mix(from: string, to: string, amount: number) {
  const a = rgb(from),
    b = rgb(to);
  return hex(a.map((c, i) => c + (b[i]! - c) * amount) as Rgb);
}
function luminance(color: string) {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

// Smallest step toward `to` that reaches the target contrast against `against`, or null.
function lift(color: string, to: string, against: string, target: number) {
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, to, step / 20);
    if (contrast(candidate, against) >= target) return candidate;
  }
  return null;
}

function accentRoles(accent: string, base: ThemeTokens) {
  const { paper, ink, background, foreground } = base;
  const onAccent = [foreground, background, paper, ink].reduce((best, candidate) =>
    contrast(candidate, accent) > contrast(best, accent) ? candidate : best,
  );
  const text = lift(accent, paper, background, 4.5);
  const issues: string[] = [];
  if (contrast(accent, background) < 3)
    issues.push('Too close to the background for focus rings and selected states to stand out.');
  if (contrast(onAccent, accent) < 4.5)
    issues.push('Text on buttons in this color would be hard to read.');
  if (!text) issues.push('Links and highlighted text in this color would be hard to read.');
  const roles: Partial<ThemeTokens> = {
    primary: accent,
    'primary-foreground': onAccent,
    'primary-text': text ?? mix(accent, paper, 0.6),
    ring: accent,
    'primary-strong': mix(accent, paper, 0.12),
    'primary-bright': mix(accent, paper, 0.08),
    'primary-line': mix(accent, paper, 0.15),
    'primary-glow': mix(accent, paper, 0.3),
    'primary-deep': mix(accent, ink, 0.35),
    'search-sheen': mix(accent, paper, 0.6),
    'hold-track': mix(accent, paper, 0.25),
    'hold-spark': mix(accent, paper, 0.55),
    'hold-glow': mix(accent, paper, 0.15),
    'hold-glow-strong': accent,
    'chart-accent': mix(accent, paper, 0.1),
    'chart-edge-focus': text ?? mix(accent, paper, 0.5),
  };
  return { roles, issues };
}

export function presetTokens(id: ThemePreference['preset']): ThemeTokens {
  const roles = presets[id].roles;
  const tokens = {} as ThemeTokens;
  for (const role of themeRoles)
    tokens[role] = roles[role] ?? roles[derivedRoles[role as DerivedRole] as BaseRole] ?? '#000000';
  return tokens;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  const tokens = presetTokens(preference.preset);
  if (!preference.accent || preference.accent === tokens.primary) return { tokens, issues: [] };
  const { roles, issues } = accentRoles(preference.accent, tokens);
  return { tokens: { ...tokens, ...roles }, issues };
}
