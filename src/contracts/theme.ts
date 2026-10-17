// Shared theme preference contract. No React, DOM, or filesystem imports: the server validates
// writes with it and the browser parses its startup snapshot with it.
export const themeKey = 'xseek-match-theme';
export const themePresetIds = [
  'xseek',
  'midnight',
  'dracula',
  'nord',
  'gruvbox',
  'solarized',
  'one-dark',
  'monokai',
  'tokyo-night',
  'catppuccin',
  'github-dark',
  'rose-pine',
] as const;
export type ThemePresetId = (typeof themePresetIds)[number];
export type ThemePreference = {
  version: 1;
  preset: ThemePresetId;
  // Normalized #rrggbb action color override; null uses the preset's own action roles.
  accent: string | null;
};
export const defaultTheme: ThemePreference = { version: 1, preset: 'xseek', accent: null };
const maxLength = 200;

export function normalizeHex(value: unknown) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

export function parseThemePreference(raw: unknown): ThemePreference | null {
  if (typeof raw !== 'string' || raw.length > maxLength) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 3 || !['version', 'preset', 'accent'].every((key) => keys.includes(key)))
    return null;
  if (record.version !== 1) return null;
  if (!themePresetIds.includes(record.preset as ThemePresetId)) return null;
  const accent = record.accent === null ? null : normalizeHex(record.accent);
  if (record.accent !== null && !accent) return null;
  return { version: 1, preset: record.preset as ThemePresetId, accent };
}

export function serializeTheme(theme: ThemePreference) {
  return JSON.stringify({ version: 1, preset: theme.preset, accent: theme.accent });
}
