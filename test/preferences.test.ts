import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesStore } from '../src/server/storage/preferences-store';
it('persists preferences and imports browser values only once without overwriting database values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-preferences-'));
  const path = join(dir, 'preferences.sqlite');
  let store = new PreferencesStore(path);
  try {
    store.save({ 'xseek-match-customnames': '{"1":"Saved"}' });
    store.save(
      { 'xseek-match-customnames': '{"1":"Old"}', 'xseek-match-important': '[1,2]' },
      true,
    );
    expect(store.snapshot().values['xseek-match-customnames']).toBe('{"1":"Saved"}');
    store.close();
    store = new PreferencesStore(path);
    expect(store.snapshot().imported).toBe(true);
    expect(store.snapshot().values['xseek-match-important']).toBe('[1,2]');
    store.save({ 'xseek-match-important': '[]' }, true);
    expect(store.snapshot().values['xseek-match-important']).toBe('[1,2]');
    expect(() => store.save({ unexpected: '{}' })).toThrow();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
