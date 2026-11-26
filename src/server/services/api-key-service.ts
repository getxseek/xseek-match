import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  API_SCOPES,
  API_LIMITS,
  type PublicApiKey,
  type ApiScope,
} from '../../contracts/api-v1.js';
import { ApiKeyStore, type ApiKeyRow } from '../storage/api-key-store.js';
const KEY_ID_PATTERN = /^[a-f0-9]{24}$/;
const API_KEY_PATTERN = /^Bearer xm_live_(?<lookupId>[a-f0-9]{24})\.(?<secret>[A-Za-z0-9_-]{43})$/i;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const publicKey = (row: ApiKeyRow): PublicApiKey => ({
  id: row.id,
  name: row.name,
  prefix: `xm_live_${row.id}`,
  scopes: JSON.parse(row.scopes) as ApiScope[],
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  lastUsedAt: row.lastUsedAt,
  revokedAt: row.revokedAt,
});
/** High entropy credentials are digested only; this feature uses additive tables. */
export class ApiKeys {
  private budgets = new Map<string, { until: number; requests: number; live: number }>();
  private store: ApiKeyStore;
  constructor(db: DatabaseSync) {
    this.store = new ApiKeyStore(db);
  }
  list(): PublicApiKey[] {
    return this.store.list().map(publicKey);
  }
  create(
    input: Record<string, unknown>,
    beforeWrite?: () => void,
  ): { key: PublicApiKey; token: string } {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80)
      throw new Error('Choose a key name up to 80 characters.');
    if (
      !Array.isArray(input.scopes) ||
      !input.scopes.length ||
      input.scopes.some((scope) => !API_SCOPES.includes(scope as ApiScope))
    )
      throw new Error('Choose at least one supported scope.');
    if (this.list().filter((key) => key.revokedAt === null).length >= 100)
      throw new Error('Revoke an existing key before creating another.');
    const now = Date.now();
    let expiresAt: number | null = now + 90 * 86_400_000;
    if (input.expiresAt === null) expiresAt = null;
    else if (input.expiresAt !== undefined) {
      if (
        typeof input.expiresAt !== 'number' ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= now ||
        input.expiresAt > now + 3660 * 86_400_000
      ) {
        throw new Error('Choose a future expiry within ten years, or no expiry.');
      }
      expiresAt = input.expiresAt;
    }
    const id = randomBytes(12).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const row: ApiKeyRow = {
      id,
      name: input.name.trim(),
      digest: digest(secret),
      scopes: JSON.stringify([...new Set(input.scopes)]),
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.store.create(row, beforeWrite);
    return { key: publicKey(row), token: `xm_live_${id}.${secret}` };
  }
  revoke(id: unknown, beforeWrite?: () => void): void {
    if (typeof id !== 'string' || !KEY_ID_PATTERN.test(id) || !this.store.revoke(id, beforeWrite))
      throw new Error('Choose a key.');
  }
  revokeAll(beforeWrite?: () => void): void {
    this.store.revokeAll(beforeWrite);
  }
  authenticate(header: unknown): PublicApiKey | undefined {
    if (typeof header !== 'string' || header.length > 160) return undefined;
    const parsed = API_KEY_PATTERN.exec(header);
    const lookupId = parsed?.groups?.lookupId;
    const secret = parsed?.groups?.secret;
    if (!lookupId || !secret) return undefined;
    const row = this.store.get(lookupId);
    if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= Date.now()))
      return undefined;
    if (!timingSafeEqual(Buffer.from(row.digest, 'hex'), Buffer.from(digest(secret), 'hex')))
      return undefined;
    if (row.lastUsedAt === null || row.lastUsedAt < Date.now() - 60_000)
      this.store.touch(row.id, Date.now());
    return publicKey(row);
  }
  consumeRequestBudget(
    id: string,
    kind: 'request' | 'live-search' = 'request',
  ): number | undefined {
    const now = Date.now();
    for (const [key, value] of this.budgets) if (value.until <= now) this.budgets.delete(key);
    const budget = this.budgets.get(id) ?? { until: now + 60_000, requests: 0, live: 0 };
    this.budgets.set(id, budget);
    if (
      kind === 'live-search'
        ? budget.live >= API_LIMITS.liveSearchAttemptsPerMinute
        : budget.requests >= API_LIMITS.requestsPerMinute
    )
      return Math.max(1, Math.ceil((budget.until - now) / 1000));
    if (kind === 'live-search') budget.live++;
    else budget.requests++;
    return undefined;
  }
}
