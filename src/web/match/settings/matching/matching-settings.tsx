import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  defaultMatching,
  validMatching,
  type MatchingConfig,
} from '../../../../domain/matching/group';
import { Button } from '../../../components/ui/button';
import { SettingsHelp } from '../../../components/ui/settings-help';
import { SettingsSection } from '../../../components/ui/settings-section';
import { SwitchButton } from '../../../components/ui/switch-button';
import { SettingsToast, useToast } from '../../../components/ui/toast';
import { preferences } from '../common/preferences';

function DeviationInput({
  id,
  label,
  value,
  onChange,
  min,
  max,
  increment,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  increment: number;
}) {
  const number = Number(value);
  function step(direction: number, shift = false) {
    const current = value.trim() && Number.isFinite(number) ? number : min;
    onChange(
      String(
        Math.round(
          Math.min(max, Math.max(min, current + direction * increment * (shift ? 5 : 1))) * 100,
        ) / 100,
      ),
    );
  }
  return (
    <div className="deviation-stepper">
      <button
        type="button"
        aria-label={`Decrease ${label}`}
        disabled={!!value.trim() && Number.isFinite(number) && number <= min}
        title={`−${increment}% · Shift: −${increment * 5}%`}
        onClick={(event) => step(-1, event.shiftKey)}
      >
        <Minus size={15} strokeWidth={2.5} />
      </button>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={increment}
        value={value}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            step(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={`Increase ${label}`}
        disabled={!!value.trim() && Number.isFinite(number) && number >= max}
        title={`+${increment}% · Shift: +${increment * 5}%`}
        onClick={(event) => step(1, event.shiftKey)}
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>
    </div>
  );
}

export function MatchingSettings({
  config,
  onSave,
}: {
  config: MatchingConfig;
  onSave: (config: MatchingConfig) => boolean;
}) {
  const { toast, notify, dismiss } = useToast();
  const [saving, setSaving] = useState(false);
  const [strictArr, setStrictArr] = useState(
    () => preferences.getItem('xseek-match-strict-arr') !== 'false',
  );
  const [allowed, setAllowed] = useState(String(config.allowedPercent));
  const [disallowed, setDisallowed] = useState(String(config.disallowedPercent));
  const [message, setMessage] = useState('');

  async function save() {
    if (saving) return;
    const next = { allowedPercent: Number(allowed), disallowedPercent: Number(disallowed) };
    if (!allowed.trim() || !disallowed.trim() || !validMatching(next)) {
      setMessage('Use 0 ≤ allowed < disallowed ≤ 100.');
      return;
    }
    setMessage('');
    setSaving(true);
    try {
      if (onSave(next) && (await preferences.flush())) notify('Matching settings saved');
      else setMessage('Could not save settings to SQLite.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsSection
      title="Matching"
      help="Controls release grouping. Saving updates current results."
    >
      <article className="info-card">
        <div className="strict-arr-setting">
          <h3>
            Strict ARR title matches
            <SettingsHelp label="Strict ARR title matches">
              Hide suggestions without a matching title or known alias. May hide valid matches when
              ARR omits the alias.
            </SettingsHelp>
          </h3>
          <SwitchButton
            label="Strict ARR title matches"
            checked={strictArr}
            onToggle={() => {
              const next = !strictArr;
              setStrictArr(next);
              preferences.setItem('xseek-match-strict-arr', JSON.stringify(next));
            }}
          />
        </div>
      </article>
      <article className="info-card matching-config">
        <h3>
          Size deviation
          <SettingsHelp label="Size deviation">
            Size difference as a percentage of the larger release. Identical infohashes override
            size limits.
          </SettingsHelp>
        </h3>
        <div className="matching-field">
          <div className="settings-field-heading">
            <label htmlFor="matching-allowed">Allowed deviation (%)</label>
            <SettingsHelp label="Allowed deviation">
              Compatible releases within this limit get high confidence. Larger differences show a
              warning.
            </SettingsHelp>
          </div>
          <DeviationInput
            id="matching-allowed"
            label="allowed deviation"
            increment={0.1}
            min={0}
            max={99.99}
            value={allowed}
            onChange={setAllowed}
          />
        </div>
        <div className="matching-field">
          <div className="settings-field-heading">
            <label htmlFor="matching-disallowed">Disallowed deviation (%)</label>
            <SettingsHelp label="Disallowed deviation">
              Separate releases at or above this limit. Must exceed the allowed deviation.
            </SettingsHelp>
          </div>
          <DeviationInput
            id="matching-disallowed"
            label="disallowed deviation"
            increment={1}
            min={0.1}
            max={100}
            value={disallowed}
            onChange={setDisallowed}
          />
        </div>
        <div className="matching-actions">
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAllowed(String(defaultMatching.allowedPercent));
              setDisallowed(String(defaultMatching.disallowedPercent));
              setMessage('');
              notify('Defaults restored. Save to apply.');
            }}
          >
            Reset to defaults
          </Button>
        </div>
        {message && (
          <p role="alert" className="match-note">
            {message}
          </p>
        )}
      </article>
      <SettingsToast toast={toast} onDismiss={dismiss} />
    </SettingsSection>
  );
}
