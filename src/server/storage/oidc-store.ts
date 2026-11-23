import type { DatabaseSync } from 'node:sqlite';

export interface OidcTransaction {
  state: string;
  binding: string;
  nonce: string;
  verifier: string;
  intent: 'login' | 'link';
  session: string | null;
  owner_version: string;
  identity_version: string;
  expires: number;
}

const OIDC_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS oidc_identity (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    issuer TEXT NOT NULL,
    subject TEXT NOT NULL,
    linked INTEGER NOT NULL,
    UNIQUE(issuer, subject)
  );
  CREATE TABLE IF NOT EXISTS oidc_transactions (
    state TEXT PRIMARY KEY,
    binding TEXT NOT NULL,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    intent TEXT NOT NULL,
    session TEXT,
    owner_version TEXT NOT NULL,
    identity_version TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS oidc_transactions_expiry ON oidc_transactions(expires);
  CREATE TABLE IF NOT EXISTS oidc_sessions (
    id TEXT PRIMARY KEY,
    issuer TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS oidc_events (
    created INTEGER NOT NULL,
    event TEXT NOT NULL
  );
`;

const PRUNE_SESSION_METADATA_SQL = `
  DELETE FROM oidc_sessions
  WHERE id NOT IN (SELECT id FROM sessions)
`;

const PRUNE_EVENT_LIMIT_SQL = `
  DELETE FROM oidc_events
  WHERE rowid NOT IN (
    SELECT rowid FROM oidc_events
    ORDER BY rowid DESC
    LIMIT 1000
  )
`;

const REVOKE_OTHER_ISSUER_SESSIONS_SQL = `
  DELETE FROM sessions
  WHERE id IN (SELECT id FROM oidc_sessions WHERE issuer <> ?)
`;

const DISABLE_OIDC_SQL = `
  DELETE FROM sessions WHERE id IN (SELECT id FROM oidc_sessions);
  DELETE FROM oidc_sessions;
  DELETE FROM oidc_transactions;
`;

const SAVE_TRANSACTION_SQL = `
  INSERT INTO oidc_transactions (
    state, binding, nonce, verifier, intent, session,
    owner_version, identity_version, expires
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const CONSUME_TRANSACTION_SQL = `
  DELETE FROM oidc_transactions
  WHERE state = ? AND binding = ? AND expires > ?
  RETURNING *
`;

/** Additive feature schema; shares the owner's SQLite transaction boundary. */
export class OidcStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(OIDC_SCHEMA_SQL);
    this.prune();
  }

  prune() {
    this.db.prepare('DELETE FROM oidc_transactions WHERE expires <= ?').run(Date.now());
    this.db.exec(PRUNE_SESSION_METADATA_SQL);
    this.db.prepare('DELETE FROM oidc_events WHERE created < ?').run(Date.now() - 30 * 86_400_000);
    this.db.exec(PRUNE_EVENT_LIMIT_SQL);
  }

  audit(event: string) {
    this.db.prepare('INSERT INTO oidc_events VALUES (?, ?)').run(Date.now(), event);
    this.prune();
  }

  identity() {
    return this.db
      .prepare('SELECT issuer, subject, linked FROM oidc_identity WHERE id = 1')
      .get() as { issuer: string; subject: string; linked: number } | undefined;
  }

  link(issuer: string, subject: string) {
    this.db
      .prepare('INSERT INTO oidc_identity VALUES (1, ?, ?, ?)')
      .run(issuer, subject, Date.now());
  }

  markSession(id: string, issuer: string) {
    this.db.prepare('INSERT INTO oidc_sessions VALUES (?, ?)').run(id, issuer);
  }

  sessionIssuer(id: string): string | undefined {
    const row = this.db.prepare('SELECT issuer FROM oidc_sessions WHERE id = ?').get(id);
    return row?.issuer as string | undefined;
  }

  removeOtherIssuerSessions(issuer: string) {
    this.db.prepare(REVOKE_OTHER_ISSUER_SESSIONS_SQL).run(issuer);
    this.prune();
  }

  disable() {
    this.db.exec(DISABLE_OIDC_SQL);
  }

  unlink() {
    this.disable();
    this.db.exec('DELETE FROM oidc_identity');
  }

  save(tx: OidcTransaction) {
    this.prune();
    const count = this.db.prepare('SELECT count(*) AS n FROM oidc_transactions').get()!.n;
    if (Number(count) >= 100) throw new Error('transaction_limit');
    this.db
      .prepare(SAVE_TRANSACTION_SQL)
      .run(
        tx.state,
        tx.binding,
        tx.nonce,
        tx.verifier,
        tx.intent,
        tx.session,
        tx.owner_version,
        tx.identity_version,
        tx.expires,
      );
  }

  consume(state: string, binding: string): OidcTransaction | undefined {
    return this.db.prepare(CONSUME_TRANSACTION_SQL).get(state, binding, Date.now()) as
      OidcTransaction | undefined;
  }
}
