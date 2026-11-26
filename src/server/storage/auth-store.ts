import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, withImmediateTransaction } from './migrations.js';

export interface OwnerRecord {
  username: string;
  password: string;
  onboarded: number;
}

export interface SessionRecord {
  id: string;
  csrf: string;
  created: number;
  expires: number;
  seen: number;
}

export interface IAuthStore {
  owner(): OwnerRecord | undefined;
  createOwner(username: string, passwordHash: string): void;
  inTransaction<T>(fn: () => T): T;
  setPassword(passwordHash: string): void;
  deleteAllSessions(): void;
  clearAttempts(): void;
  setOnboarded(): void;
  meta(key: string, value?: string): string | undefined;
  session(tokenHash: string): SessionRecord | undefined;
  activeSessions(now: number, idleTimeoutMs: number): Omit<SessionRecord, 'csrf'>[];
  saveSession(
    tokenHash: string,
    csrf: string,
    now: number,
    expires: number,
    idleTimeoutMs: number,
  ): void;
  deleteSession(tokenHash: string): void;
  updateSessionSeen(tokenHash: string, now: number): void;
  attempts(clientKey: string, globalKey?: string): { clientCount: number; globalCount: number };
  recordAttempt(clientKey: string, until: number, globalKey?: string | null): void;
  saveDevice(tokenHash: string, now: number, expires: number): void;
  hasDevice(tokenHash: string, now: number): boolean;
  deleteAllDevices(): void;
  clearClientAttempts(clientKey: string): void;
  purgeExpiredAttempts(now: number): void;
  resetOnboarding(): void;
  close(): void;
}

const AUTH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    onboarded INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_attempts (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    until INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL
  );
`;

const MAX_TRUSTED_DEVICES = 20;

const ACTIVE_SESSIONS_SQL = `
  SELECT id, created, expires, seen
  FROM sessions
  WHERE expires > ? AND seen > ?
  ORDER BY created DESC
  LIMIT 100
`;

export class AuthStore implements IAuthStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = openDatabase(path, AUTH_SCHEMA_SQL);
  }

  owner(): OwnerRecord | undefined {
    return this.db.prepare('SELECT username, password, onboarded FROM owner WHERE id = 1').get() as
      OwnerRecord | undefined;
  }

  createOwner(username: string, passwordHash: string): void {
    withImmediateTransaction(this.db, () => {
      this.db
        .prepare('INSERT INTO owner(id, username, password) VALUES (1, ?, ?)')
        .run(username, passwordHash);
      this.db.prepare("DELETE FROM auth_meta WHERE key = 'setup'").run();
    });
  }

  /** Runs `fn` under BEGIN IMMEDIATE, so other processes (e.g. reset-password) cannot interleave. */
  inTransaction<T>(fn: () => T): T {
    return withImmediateTransaction(this.db, fn);
  }

  setPassword(passwordHash: string): void {
    this.db.prepare('UPDATE owner SET password = ? WHERE id = 1').run(passwordHash);
  }

  deleteAllSessions(): void {
    this.db.exec('DELETE FROM sessions');
  }

  clearAttempts(): void {
    this.db.exec('DELETE FROM auth_attempts');
  }

  setOnboarded(): void {
    this.db.prepare('UPDATE owner SET onboarded = 1 WHERE id = 1').run();
  }

  meta(key: string, value?: string): string | undefined {
    if (value !== undefined) {
      this.db
        .prepare(
          'INSERT INTO auth_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        )
        .run(key, value);
    }
    const row = this.db.prepare('SELECT value FROM auth_meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value;
  }

  session(tokenHash: string): SessionRecord | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(tokenHash) as
      SessionRecord | undefined;
  }

  activeSessions(now: number, idleTimeoutMs: number): Omit<SessionRecord, 'csrf'>[] {
    return this.db.prepare(ACTIVE_SESSIONS_SQL).all(now, now - idleTimeoutMs) as Omit<
      SessionRecord,
      'csrf'
    >[];
  }

  updateSessionSeen(tokenHash: string, now: number): void {
    this.db.prepare('UPDATE sessions SET seen = ? WHERE id = ?').run(now, tokenHash);
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(tokenHash);
  }

  saveSession(
    tokenHash: string,
    csrf: string,
    now: number,
    expires: number,
    idleTimeoutMs: number,
  ): void {
    this.db
      .prepare('DELETE FROM sessions WHERE expires < ? OR seen < ?')
      .run(now, now - idleTimeoutMs);
    this.db
      .prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)')
      .run(tokenHash, csrf, now, expires, now);
  }

  purgeExpiredAttempts(now: number): void {
    this.db.prepare('DELETE FROM auth_attempts WHERE until < ?').run(now);
  }

  attempts(clientKey: string, globalKey = 'global'): { clientCount: number; globalCount: number } {
    const entries = this.db
      .prepare('SELECT key, count FROM auth_attempts WHERE key IN (?, ?)')
      .all(clientKey, globalKey) as Array<{ key: string; count: number }>;

    let clientCount = 0;
    let globalCount = 0;

    for (const entry of entries) {
      if (entry.key === clientKey) clientCount = entry.count;
      if (entry.key === globalKey) globalCount = entry.count;
    }

    return { clientCount, globalCount };
  }

  clearClientAttempts(clientKey: string): void {
    this.db.prepare("DELETE FROM auth_attempts WHERE key = ? AND key <> 'global'").run(clientKey);
  }

  /** Each failure extends the window, so it ends `until` after the latest failure. */
  recordAttempt(clientKey: string, until: number, globalKey: string | null = 'global'): void {
    for (const attemptKey of globalKey === null ? [clientKey] : [clientKey, globalKey]) {
      this.db
        .prepare(
          'INSERT INTO auth_attempts VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1, until = excluded.until',
        )
        .run(attemptKey, until);
    }
  }

  /** Keeps the newest devices; the oldest is dropped past the cap. */
  saveDevice(tokenHash: string, now: number, expires: number): void {
    withImmediateTransaction(this.db, () => {
      this.db.prepare('DELETE FROM trusted_devices WHERE expires <= ?').run(now);
      this.db.prepare('INSERT INTO trusted_devices VALUES (?, ?, ?)').run(tokenHash, now, expires);
      this.db
        .prepare(
          'DELETE FROM trusted_devices WHERE id NOT IN (SELECT id FROM trusted_devices ORDER BY created DESC, rowid DESC LIMIT ?)',
        )
        .run(MAX_TRUSTED_DEVICES);
    });
  }

  hasDevice(tokenHash: string, now: number): boolean {
    return Boolean(
      this.db
        .prepare('SELECT 1 FROM trusted_devices WHERE id = ? AND expires > ?')
        .get(tokenHash, now),
    );
  }

  deleteAllDevices(): void {
    this.db.exec('DELETE FROM trusted_devices');
  }

  resetOnboarding(): void {
    withImmediateTransaction(this.db, () => {
      this.db.exec(
        'DELETE FROM sessions; DELETE FROM owner; DELETE FROM auth_attempts; DELETE FROM trusted_devices',
      );
      this.meta('onboarding-step', 'connection');
    });
  }

  close(): void {
    this.db.close();
  }
}
