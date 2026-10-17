import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './migrations.js';

export interface XemMapping {
  tvdbSeason: number;
  tvdbEpisode: number;
  sceneSeason: number;
  sceneEpisode: number;
}

export interface CachedXemRecord {
  mappings: XemMapping[];
  expires: number;
}

export interface IXemStore {
  get(id: number): CachedXemRecord | undefined;
  set(id: number, mappings: XemMapping[], ttlMs: number): void;
  close(): void;
}

const XEM_SCHEMA_SQL =
  'CREATE TABLE IF NOT EXISTS xem_cache(tvdb INTEGER PRIMARY KEY, payload TEXT NOT NULL, expires INTEGER NOT NULL)';

export class XemStore implements IXemStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = openDatabase(path, XEM_SCHEMA_SQL);
  }

  get(id: number): CachedXemRecord | undefined {
    const row = this.db.prepare('SELECT payload, expires FROM xem_cache WHERE tvdb = ?').get(id) as
      { payload: string; expires: number } | undefined;

    if (!row) return undefined;

    try {
      return {
        mappings: JSON.parse(row.payload) as XemMapping[],
        expires: row.expires,
      };
    } catch {
      return undefined;
    }
  }

  set(id: number, mappings: XemMapping[], ttlMs: number): void {
    this.db
      .prepare(
        'INSERT INTO xem_cache VALUES (?, ?, ?) ' +
          'ON CONFLICT(tvdb) DO UPDATE SET payload = excluded.payload, expires = excluded.expires',
      )
      .run(id, JSON.stringify(mappings), Date.now() + ttlMs);
  }

  close(): void {
    this.db.close();
  }
}
