import { randomUUID } from 'node:crypto';
import type { IntegrationKind } from '../../integration-capabilities.js';
import type { ConnectionRecord as Connection } from '../storage/integrations-store.js';
import { validateBaseUrl } from './safe-url.js';

const CONNECTION_KINDS: readonly string[] = ['sonarr', 'radarr', 'qui'];
const API_KEY_FORBIDDEN_CHARACTERS = /[\x00-\x20\x7f]/;

function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    throw new Error('Enter a name between 1 and 80 characters.');
  }
  return name.trim();
}

function validKind(kind: unknown, existing: Connection | undefined): IntegrationKind {
  if (!CONNECTION_KINDS.includes(String(kind))) {
    throw new Error('Choose Sonarr, Radarr or qui.');
  }
  if (existing && kind !== existing.kind) {
    throw new Error('Service type cannot be changed. Add a new connection instead.');
  }
  return kind as IntegrationKind;
}

/** A blank key on an edit keeps the stored key, so the UI never has to read it back. */
function validApiKey(apiKey: unknown, existing: Connection | undefined): string {
  if (apiKey !== undefined && typeof apiKey !== 'string') {
    throw new Error('Invalid API key.');
  }
  const resolved = apiKey?.trim() || existing?.apiKey || '';
  if (!resolved || resolved.length > 1024 || API_KEY_FORBIDDEN_CHARACTERS.test(resolved)) {
    throw new Error('Enter an API key without spaces or control characters.');
  }
  return resolved;
}

function validEnabled(enabled: unknown, existing: Connection | undefined): boolean {
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error('Invalid enabled state.');
  }
  return enabled ?? existing?.enabled ?? true;
}

/** Builds an unchecked connection from form input, filling omitted fields from `existing`. */
export function connectionFromInput(
  input: Record<string, unknown>,
  existing: Connection | undefined,
): Connection {
  const baseUrl = validateBaseUrl(input.baseUrl ?? existing?.baseUrl);
  const kind = validKind(input.kind ?? existing?.kind, existing);
  const name = validName(input.name ?? existing?.name);
  return {
    id: existing?.id ?? randomUUID(),
    kind,
    name,
    baseUrl,
    apiKey: validApiKey(input.apiKey, existing),
    enabled: validEnabled(input.enabled, existing),
    checkedAt: null,
    status: 'unchecked',
    detail: '',
  };
}
