import { preferenceKeys, validPreference } from '../../../../contracts/preferences';
import { authFetch } from '../../auth/auth-client';

let values: Record<string, string> = {};
let revisions: Record<string, number> = {};
let pending: Promise<unknown> = Promise.resolve();
const dirty = new Map<string, string>();
let conflict = false;

const changed = () => window.dispatchEvent(new Event('preferences-changed'));

export async function loadPreferences() {
  const response = await authFetch('/api/match/preferences');
  if (!response.ok) throw Error('Could not load preferences');
  let snapshot = await response.json();
  if (!snapshot.imported) {
    const legacy: Record<string, string> = {};
    for (const key of preferenceKeys)
      try {
        const value = (
          key.endsWith('-page') || key.endsWith('-category') ? sessionStorage : localStorage
        ).getItem(key);
        if (value !== null && validPreference(key, value)) legacy[key] = value;
      } catch {}
    const imported = await authFetch('/api/match/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: legacy }),
    });
    if (!imported.ok) throw Error('Could not import preferences');
    snapshot = await imported.json();
  }
  values = snapshot.values;
  revisions = snapshot.revisions || {};
  dirty.clear();
  conflict = false;
  changed();
}

function save(key: string, value: string): Promise<boolean> {
  const task = pending
    .catch(() => {})
    .then(async () => {
      try {
        const response = await authFetch('/api/match/preferences', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            values: { [key]: value },
            expected: { [key]: revisions[key] || 0 },
          }),
        });
        if (response.status === 409) conflict = true;
        if (!response.ok) throw Error();
        const snapshot = await response.json();
        revisions[key] = snapshot.revisions?.[key] || 0;
        if (dirty.get(key) === value) dirty.delete(key);
        changed();
        return true;
      } catch {
        window.dispatchEvent(new Event('preferences-save-error'));
        changed();
        return false;
      }
    });
  pending = task;
  return task;
}

export const preferences = {
  async flush() {
    await pending;
    return dirty.size === 0;
  },
  getItem(key: string) {
    return values[key] ?? null;
  },
  setItem(key: string, value: string) {
    if (!validPreference(key, value)) return Promise.resolve(false);
    if (values[key] === value && !dirty.has(key)) return Promise.resolve(true);
    values[key] = value;
    dirty.set(key, value);
    changed();
    return save(key, value);
  },
  isDirty(key: string) {
    return dirty.has(key);
  },
  status() {
    return { unsaved: dirty.size, conflict };
  },
  async retry() {
    for (const [key, value] of [...dirty]) await save(key, value);
    return dirty.size === 0;
  },
};
