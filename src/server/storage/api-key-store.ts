import type { DatabaseSync } from 'node:sqlite';
import { withImmediateTransaction } from './migrations.js';
export interface ApiKeyRow {
  id: string;
  name: string;
  digest: string;
  scopes: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}
const API_KEY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    digest TEXT NOT NULL,
    scopes TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER,
    seen INTEGER,
    revoked INTEGER
  );
  CREATE TABLE IF NOT EXISTS api_key_events (
    id INTEGER PRIMARY KEY,
    key_id TEXT NOT NULL,
    action TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_key_events_at ON api_key_events(at);
`;
const SELECT_KEYS_SQL = `
  SELECT id, name, digest, scopes,
    created AS createdAt, expires AS expiresAt,
    seen AS lastUsedAt, revoked AS revokedAt
  FROM api_keys
`;

/** Additive singleton-owner credentials and bounded non-secret lifecycle audit events. */
export class ApiKeyStore {
  private prunedAt = 0;
  constructor(private db: DatabaseSync) {
    db.exec(API_KEY_SCHEMA_SQL);
    this.prune();
  }
  list(): ApiKeyRow[] {
    this.prune();
    return this.db
      .prepare(`${SELECT_KEYS_SQL} ORDER BY created DESC, id`)
      .all() as unknown as ApiKeyRow[];
  }
  get(id: string): ApiKeyRow | undefined {
    this.prune();
    return this.db.prepare(`${SELECT_KEYS_SQL} WHERE id = ?`).get(id) as unknown as
      ApiKeyRow | undefined;
  }
  create(row: ApiKeyRow, beforeWrite?: () => void): void {
    withImmediateTransaction(this.db, () => {
      beforeWrite?.();
      this.db
        .prepare('INSERT INTO api_keys VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(
          row.id,
          row.name,
          row.digest,
          row.scopes,
          row.createdAt,
          row.expiresAt,
          row.lastUsedAt,
          row.revokedAt,
        );
      this.event(row.id, 'created');
    });
  }
  /** Returns false when no key has this id; revoking an already revoked key changes nothing. */
  revoke(id: string, beforeWrite?: () => void): boolean {
    return withImmediateTransaction(this.db, () => {
      beforeWrite?.();
      if (!this.db.prepare('SELECT 1 FROM api_keys WHERE id = ?').get(id)) return false;
      const { changes } = this.db
        .prepare('UPDATE api_keys SET revoked = ? WHERE id = ? AND revoked IS NULL')
        .run(Date.now(), id);
      if (changes) this.event(id, 'revoked');
      return true;
    });
  }
  revokeAll(beforeWrite?: () => void): void {
    withImmediateTransaction(this.db, () => {
      beforeWrite?.();
      this.db.prepare('UPDATE api_keys SET revoked = ? WHERE revoked IS NULL').run(Date.now());
      this.event('all', 'revoked');
    });
  }
  touch(id: string, now: number): void {
    this.db.prepare('UPDATE api_keys SET seen = ? WHERE id = ?').run(now, id);
  }
  private prune(): void {
    if (Date.now() - this.prunedAt < 60_000) return;
    this.db.prepare('DELETE FROM api_key_events WHERE at < ?').run(Date.now() - 30 * 86_400_000);
    this.prunedAt = Date.now();
  }
  private event(id: string, action: string): void {
    this.prune();
    this.db
      .prepare('INSERT INTO api_key_events(key_id, action, at) VALUES (?, ?, ?)')
      .run(id, action, Date.now());
    this.db.exec(
      'DELETE FROM api_key_events WHERE id NOT IN (SELECT id FROM api_key_events ORDER BY id DESC LIMIT 1000)',
    );
  }
}
