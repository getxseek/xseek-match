import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MIGRATIONS_SCHEMA_SQL = `
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`;

/** Version only cross-cutting data changes; feature tables remain additive. */
export function migrate(db: DatabaseSync) {
  db.exec(MIGRATIONS_SCHEMA_SQL);

  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as {
    version: number | null;
  };
  const version = Number(row.version || 0);

  if (version > 1) {
    throw new Error('Database was created by a newer xseek-match version');
  }
  if (version < 1) {
    withImmediateTransaction(db, () => {
      db.prepare('INSERT OR IGNORE INTO schema_migrations VALUES (1, ?)').run(Date.now());
    });
  }
}

export function openDatabase(filePath: string, schemaSql?: string): DatabaseSync {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filePath);
  migrate(db);
  if (schemaSql) db.exec(schemaSql);
  return db;
}

export function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
