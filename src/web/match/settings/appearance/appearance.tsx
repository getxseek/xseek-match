import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  defaultTheme,
  normalizeHex,
  serializeTheme,
  themeKey,
  themePresetIds,
  type ThemePreference,
} from '../../../../contracts/theme';
import { Button } from '../../../components/ui/button';
import { SettingsHelp } from '../../../components/ui/settings-help';
import { SettingsSection } from '../../../components/ui/settings-section';
import { previewTheme, storedTheme } from '../../theme/bootstrap';
import { presets } from '../../theme/presets';
import { presetTokens, resolveTheme } from '../../theme/resolve';
import { preferences } from '../common/preferences';
import './appearance.css';

const saveDelay = 400;

export function AppearancePanel() {
  const [theme, setTheme] = useState(storedTheme),
    [hex, setHex] = useState(
      () => storedTheme().accent ?? presetTokens(storedTheme().preset).primary,
    ),
    [issues, setIssues] = useState<string[]>([]),
    // The last accent refused for contrast, kept so the owner can insist on it.
    [refused, setRefused] = useState<ThemePreference | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const presetAccent = presetTokens(theme.preset).primary;

  useEffect(() => {
    const sync = () => {
      const next = storedTheme();
      setTheme(next);
      setHex(next.accent ?? presetTokens(next.preset).primary);
    };
    window.addEventListener('preferences-changed', sync);
    return () => {
      window.removeEventListener('preferences-changed', sync);
      clearTimeout(timer.current);
      previewTheme(null);
    };
  }, []);

  function commit(next: ThemePreference) {
    clearTimeout(timer.current);
    setIssues([]);
    setRefused(null);
    void preferences.setItem(themeKey, serializeTheme(next));
    previewTheme(null);
  }

  // Previews valid accents immediately; saves only accents that meet contrast, after a short pause or on commit.
  function chooseAccent(value: string, immediate: boolean) {
    const accent = normalizeHex(value);
    if (!accent) {
      clearTimeout(timer.current);
      previewTheme(null);
      setIssues(['Enter a six-digit hex color such as #5b9cff.']);
      return;
    }
    setHex(accent);
    const next = { ...theme, accent: accent === presetAccent ? null : accent };
    const found = resolveTheme(next).issues;
    setIssues(found);
    setRefused(found.length ? next : null);
    clearTimeout(timer.current);
    if (found.length) {
      previewTheme(null);
      return;
    }
    previewTheme(next);
    if (immediate) commit(next);
    else timer.current = setTimeout(() => commit(next), saveDelay);
  }

  const activeAccent = theme.accent ?? presetAccent;
  const normalizedHex = normalizeHex(hex);
  const isDefault =
    serializeTheme(theme) === serializeTheme(defaultTheme) &&
    !issues.length &&
    normalizedHex === presetAccent;
  return (
    <SettingsSection
      className="appearance-panel"
      title="Appearance"
      help="Applies to every page on all devices signed in to this account. Changes preview immediately and save automatically."
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={isDefault}
          onClick={() => {
            setHex(presetTokens(defaultTheme.preset).primary);
            commit(defaultTheme);
          }}
        >
          Reset to default
        </Button>
      }
    >
      <fieldset className="appearance-section">
        <legend>Theme</legend>
        <div className="theme-preset-grid">
          {themePresetIds.map((id) => {
            const preset = presets[id],
              tokens = presetTokens(id),
              selected = theme.preset === id;
            return (
              <label key={id} className="theme-preset" data-selected={selected || undefined}>
                <input
                  type="radio"
                  name="theme-preset"
                  value={id}
                  checked={selected}
                  onChange={() => commit({ version: 1, preset: id, accent: null })}
                />
                <span
                  className="theme-preset-preview"
                  aria-hidden="true"
                  style={{ background: tokens.background }}
                >
                  <i style={{ background: tokens.card, borderColor: tokens.border }}>
                    <b style={{ background: tokens['muted-foreground'] }} />
                    <b style={{ background: tokens.input }} />
                  </i>
                  <span>
                    <b style={{ background: tokens.primary }} />
                    <b style={{ background: tokens.positive }} />
                    <b style={{ background: tokens.danger }} />
                  </span>
                </span>
                <span className="theme-preset-text">
                  <strong>
                    {preset.name}
                    {selected && <Check size={14} aria-hidden="true" />}
                  </strong>
                  <small>{preset.description}</small>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="appearance-section">
        <div className="settings-field-heading">
          <label htmlFor="theme-accent-hex">Accent color</label>
          <SettingsHelp label="Accent color">
            Used for buttons, selection, focus and the Search hold animation. Errors and status
            colors keep their meaning.
          </SettingsHelp>
        </div>
        <div className="theme-accent-controls">
          <input
            type="color"
            aria-label="Pick accent color"
            value={normalizedHex ?? activeAccent}
            onInput={(event) => chooseAccent(event.currentTarget.value, false)}
            onChange={(event) => chooseAccent(event.currentTarget.value, true)}
          />
          <input
            id="theme-accent-hex"
            className="theme-accent-hex"
            spellCheck={false}
            maxLength={7}
            value={hex}
            aria-invalid={issues.length > 0 || !normalizedHex}
            aria-describedby={issues.length ? 'theme-accent-issues' : undefined}
            onChange={(event) => {
              const value = event.currentTarget.value.trim();
              setHex(value.startsWith('#') ? value : `#${value}`);
            }}
            onBlur={(event) => chooseAccent(event.currentTarget.value, true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') chooseAccent(event.currentTarget.value, true);
            }}
          />
          {(theme.accent || issues.length > 0 || normalizedHex !== activeAccent) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setHex(presetAccent);
                commit({ ...theme, accent: null });
              }}
            >
              Use preset accent
            </Button>
          )}
        </div>
        {issues.length > 0 && (
          <p id="theme-accent-issues" className="theme-accent-issues" role="alert">
            Not saved. {issues.join(' ')}
            {refused && (
              <Button size="sm" variant="ghost" onClick={() => commit(refused)}>
                Use anyway
              </Button>
            )}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
