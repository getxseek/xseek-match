import type { DatabaseSync } from 'node:sqlite';
import {
  preferenceKeys,
  validatePreferences,
  validPreference,
} from '../../contracts/preferences.js';
import { openDatabase, withImmediateTransaction } from './migrations.js';

export { preferenceKeys };

export class PreferenceConflict extends Error {
  constructor(message = 'Settings changed in another tab. Reload before editing.') {
    super(message);
    this.name = 'PreferenceConflict';
  }
}

export interface PreferencesSnapshot {
  revisions: Record<string, number>;
  values: Record<string, string>;
  imported: boolean;
}

export interface IPreferencesStore {
  snapshot(): PreferencesSnapshot;
  save(
    values: Record<string, string>,
    isBrowserMigration?: boolean,
    expected?: Record<string, number>,
  ): PreferencesSnapshot;
  close(): void;
}

const PREFERENCES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS preference_revisions (
    key TEXT PRIMARY KEY,
    revision INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export class PreferencesStore implements IPreferencesStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = openDatabase(path, PREFERENCES_SCHEMA_SQL);
  }

  snapshot(): PreferencesSnapshot {
    const revisionRows = this.db
      .prepare('SELECT key, revision FROM preference_revisions')
      .all() as Array<{ key: string; revision: number }>;

    const preferenceRows = this.db.prepare('SELECT key, value FROM preferences').all() as Array<{
      key: string;
      value: string;
    }>;

    const imported = Boolean(
      this.db.prepare("SELECT value FROM metadata WHERE key = 'browser_import'").get(),
    );

    return {
      revisions: Object.fromEntries(revisionRows.map((row) => [row.key, row.revision])),
      values: Object.fromEntries(preferenceRows.map((row) => [row.key, row.value])),
      imported,
    };
  }

  save(
    values: Record<string, string>,
    isBrowserMigration = false,
    expected?: Record<string, number>,
  ): PreferencesSnapshot {
    if (isBrowserMigration) {
      values = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => validPreference(key, value)),
      );
    } else {
      validatePreferences(values);
    }

    withImmediateTransaction(this.db, () => {
      if (expected && !isBrowserMigration) {
        for (const key of Object.keys(values)) {
          const row = this.db
            .prepare('SELECT revision FROM preference_revisions WHERE key = ?')
            .get(key) as { revision?: number } | undefined;
          const currentRevision = Number(row?.revision || 0);

          if (!Number.isSafeInteger(expected[key]) || expected[key] !== currentRevision) {
            throw new PreferenceConflict('Settings changed in another tab. Reload before editing.');
          }
        }
      }

      if (!isBrowserMigration || !this.snapshot().imported) {
        const upsertPreference = this.db.prepare(
          isBrowserMigration
            ? 'INSERT OR IGNORE INTO preferences(key, value) VALUES (?, ?)'
            : 'INSERT INTO preferences(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        );
        const bumpRevision = this.db.prepare(
          'INSERT INTO preference_revisions VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET revision = revision + 1',
        );

        for (const [key, value] of Object.entries(values)) {
          upsertPreference.run(key, value);
          bumpRevision.run(key);
        }

        if (isBrowserMigration) {
          this.db
            .prepare(
              "INSERT INTO metadata(key, value) VALUES ('browser_import', 'done') ON CONFLICT(key) DO NOTHING",
            )
            .run();
        }
      }
    });

    return this.snapshot();
  }

  close(): void {
    this.db.close();
  }
}
