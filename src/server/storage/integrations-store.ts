import type { DatabaseSync } from 'node:sqlite';
import {
  integrationCapabilities,
  type IntegrationCapability,
  type IntegrationKind,
} from '../../integration-capabilities.js';
import { openDatabase } from './migrations.js';

export interface ConnectionRecord {
  id: string;
  kind: IntegrationKind;
  name: string;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  checkedAt: number | null;
  status: 'connected' | 'failed' | 'unchecked';
  detail: string;
}

export type PublicConnectionRecord = Omit<ConnectionRecord, 'apiKey'> & {
  hasApiKey: boolean;
  capabilities: readonly IntegrationCapability[];
};

export interface IIntegrationsStore {
  list(): PublicConnectionRecord[];
  get(id: string): ConnectionRecord;
  save(connection: ConnectionRecord): void;
  updateStatus(
    id: string,
    checkedAt: number,
    status: ConnectionRecord['status'],
    detail: string,
  ): void;
  updateEnabled(id: string, enabled: boolean): void;
  delete(id: string): void;
  close(): void;
}

const INTEGRATIONS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS integration_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS integrations (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    enabled INTEGER NOT NULL,
    checked_at INTEGER,
    status TEXT NOT NULL,
    detail TEXT NOT NULL
  );
`;

export function toPublicConnection(connection: ConnectionRecord): PublicConnectionRecord {
  const { apiKey, ...publicFields } = connection;
  return {
    ...publicFields,
    hasApiKey: Boolean(apiKey),
    capabilities: integrationCapabilities[connection.kind],
  };
}

export class IntegrationsStore implements IIntegrationsStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = openDatabase(path, INTEGRATIONS_SCHEMA_SQL);
  }

  get(id: string): ConnectionRecord {
    const row = this.db.prepare('SELECT * FROM integrations WHERE id = ?').get(id) as
      | {
          id: string;
          kind: IntegrationKind;
          name: string;
          base_url: string;
          api_key: string;
          enabled: number;
          checked_at: number | null;
          status: ConnectionRecord['status'];
          detail: string;
        }
      | undefined;

    if (!row) throw new Error('Connection not found.');

    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      baseUrl: row.base_url,
      apiKey: row.api_key,
      enabled: Boolean(row.enabled),
      checkedAt: row.checked_at,
      status: row.status,
      detail: row.detail,
    };
  }

  list(): PublicConnectionRecord[] {
    const rows = this.db
      .prepare('SELECT id FROM integrations ORDER BY kind, name COLLATE NOCASE')
      .all() as { id: string }[];
    return rows.map((row) => toPublicConnection(this.get(row.id)));
  }

  save(connection: ConnectionRecord): void {
    this.db
      .prepare(
        'INSERT INTO integrations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET ' +
          'name = excluded.name, ' +
          'base_url = excluded.base_url, ' +
          'api_key = excluded.api_key, ' +
          'enabled = excluded.enabled, ' +
          'checked_at = excluded.checked_at, ' +
          'status = excluded.status, ' +
          'detail = excluded.detail',
      )
      .run(
        connection.id,
        connection.kind,
        connection.name,
        connection.baseUrl,
        connection.apiKey,
        Number(connection.enabled),
        connection.checkedAt,
        connection.status,
        connection.detail,
      );
  }

  updateStatus(
    id: string,
    checkedAt: number,
    status: ConnectionRecord['status'],
    detail: string,
  ): void {
    this.db
      .prepare('UPDATE integrations SET checked_at = ?, status = ?, detail = ? WHERE id = ?')
      .run(checkedAt, status, detail, id);
  }

  updateEnabled(id: string, enabled: boolean): void {
    this.db.prepare('UPDATE integrations SET enabled = ? WHERE id = ?').run(Number(enabled), id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM integrations WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
