import {
  defaultTheme,
  parseThemePreference,
  serializeTheme,
  themeKey,
  type ThemePreference,
} from '../../../contracts/theme';
import { preferences } from '../settings/common/preferences';
import { applyTokens } from './apply';
import { resolveTheme } from './resolve';

// A visual startup cache of the last server-confirmed theme. It is deliberately stored under a
// different key from the preference so the one-time legacy browser import never promotes it.
const snapshotKey = 'xseek-match-theme-snapshot';

function readSnapshot(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(snapshotKey)) ?? defaultTheme;
  } catch {
    return defaultTheme;
  }
}
function writeSnapshot(theme: ThemePreference) {
  try {
    localStorage.setItem(snapshotKey, serializeTheme(theme));
  } catch {}
}

export function storedTheme() {
  return parseThemePreference(preferences.getItem(themeKey)) ?? defaultTheme;
}

let preview: ThemePreference | null = null;
let shown = '';
function show(theme: ThemePreference) {
  const value = serializeTheme(theme);
  if (value === shown) return;
  shown = value;
  applyTokens(resolveTheme(theme).tokens);
}

// Local-only preview (for example while dragging the accent picker); null returns to the stored value.
export function previewTheme(theme: ThemePreference | null) {
  preview = theme;
  show(theme ?? storedTheme());
}

let started = false;
let seen: string | null | undefined;
export function startTheme() {
  show(readSnapshot());
  if (started) return;
  started = true;
  // Reconcile to the authenticated value once preferences load or a save settles. Missing means
  // default, never the local cache. Only confirmed (non-dirty) values refresh the snapshot.
  window.addEventListener('preferences-changed', () => {
    const value = preferences.getItem(themeKey);
    const dirty = preferences.isDirty(themeKey);
    if (!preview && (value !== seen || dirty)) show(storedTheme());
    seen = value;
    if (!dirty) writeSnapshot(storedTheme());
  });
  // Another tab confirmed a theme: follow it visually without touching server revisions here.
  window.addEventListener('storage', (event) => {
    if (event.key !== snapshotKey || preview || preferences.isDirty(themeKey)) return;
    show(parseThemePreference(event.newValue) ?? defaultTheme);
  });
  window.addEventListener('auth-required', () => {
    preview = null;
    show(readSnapshot());
  });
}
