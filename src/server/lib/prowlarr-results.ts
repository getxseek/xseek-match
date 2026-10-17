import { createHash } from 'node:crypto';
import { decodeResults, type Result } from '../../contracts/search.js';
import { categoryNameForId } from '../../domain/matching/group.js';
import { validateBaseUrl } from './safe-url.js';

export type Indexer = {
  id: number;
  name: string;
  available: boolean;
  origin: string | null;
  categories: string[];
};

export type IndexerCacheRecord = {
  at: number;
  trackers: Indexer[];
};

export function isValidCachedIndexer(value: unknown): value is Indexer {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(row.id) &&
    Number(row.id) > 0 &&
    typeof row.name === 'string' &&
    Array.isArray(row.categories)
  );
}

export function isFreshIndexerCache(
  cache: IndexerCacheRecord | null,
  ttlMs: number,
): cache is IndexerCacheRecord {
  return Boolean(
    cache &&
    Array.isArray(cache.trackers) &&
    cache.trackers.every(isValidCachedIndexer) &&
    Date.now() - cache.at < ttlMs,
  );
}

export function indexerConfigSignature(rows: readonly Indexer[]): string {
  return JSON.stringify(
    rows
      .map(({ id, name, origin, categories }) => ({ id, name, origin, categories }))
      .sort((left, right) => left.id - right.id),
  );
}

function isEnabledTorrentSearchIndexer(raw: any): boolean {
  return Boolean(
    raw &&
    Number.isSafeInteger(raw.id) &&
    raw.id > 0 &&
    raw.enable &&
    raw.supportsSearch &&
    raw.protocol === 'torrent',
  );
}

function extractValidatedOrigin(rawIndexerUrls: unknown): string | null {
  if (!Array.isArray(rawIndexerUrls) || typeof rawIndexerUrls[0] !== 'string') return null;
  try {
    const url = new URL(rawIndexerUrls[0]);
    return validateBaseUrl(url.origin);
  } catch {
    return null;
  }
}

function extractIndexerCategories(rawCapabilities: any): string[] {
  const rawCategories = Array.isArray(rawCapabilities?.categories)
    ? rawCapabilities.categories
    : [];
  const names = rawCategories
    .map((category: { id: number } | null) =>
      category && typeof category.id === 'number' ? categoryNameForId(category.id) : undefined,
    )
    .filter((name: string | undefined): name is string => Boolean(name));
  return [...new Set<string>(names)].sort();
}

export function parseProwlarrIndexers(rawData: unknown[]): Indexer[] {
  return rawData.filter(isEnabledTorrentSearchIndexer).map((raw: any) => {
    const disabledTill = raw.status?.disabledTill;
    const available = !disabledTill || Date.parse(disabledTill) <= Date.now();

    return {
      id: raw.id,
      name: String(raw.name),
      available,
      origin: extractValidatedOrigin(raw.indexerUrls),
      categories: extractIndexerCategories(raw.capabilities),
    };
  });
}

function hashResultGuid(rawItem: any): string {
  const seed =
    typeof rawItem.guid === 'string' && rawItem.guid.length <= 4096
      ? rawItem.guid
      : Number.isSafeInteger(rawItem.id)
        ? String(rawItem.id)
        : typeof rawItem.title === 'string'
          ? rawItem.title
          : '';
  return createHash('sha256').update(seed).digest('hex');
}

export function normalizeProwlarrResults(
  rawItems: unknown[],
  excludedIndexerIds: ReadonlySet<number>,
): Result[] {
  const torrentRows = rawItems
    .filter((item: any) => item && item.protocol === 'torrent')
    .map((item: any) => ({
      ...item,
      guid: hashResultGuid(item),
    }));

  return decodeResults(torrentRows, true).filter(
    (result) => !excludedIndexerIds.has(result.indexerId),
  );
}
