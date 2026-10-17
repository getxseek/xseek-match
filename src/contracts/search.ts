import { normalizeInfoHash } from '../domain/matching/info-hash.js';

export type Numbering = 'tvdb' | 'release';

export type Result = {
  categories?: Array<{ id: number; name: string }>;
  guid: string;
  title: string;
  indexerId: number;
  indexer: string;
  size: number;
  seeders?: number;
  infoHash?: string;
  infoUrl?: string;
  protocol?: string;
  indexerFlags?: string[];
};

export const initialSearchNote =
  'Initial Prowlarr response only; tracker limits and partial failures may omit results.';

const SAFE_ID_QUERY_KEYS = new Set(['id', 'torrentid', 'torrent_id', 't', 'tid']);
const SAFE_ACTION_QUERY_VALUES = new Set(['details', 'view', 'viewtorrent']);

export function safeInfoUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }

    // Detail-page IDs are useful; arbitrary tracker query parameters may contain passkeys.
    for (const key of [...url.searchParams.keys()]) {
      const paramValue = url.searchParams.get(key) || '';
      const lowerKey = key.toLowerCase();
      const isSafeIdParam = SAFE_ID_QUERY_KEYS.has(lowerKey) && /^\d{1,20}$/.test(paramValue);
      const isSafeActionParam =
        lowerKey === 'action' && SAFE_ACTION_QUERY_VALUES.has(paramValue.toLowerCase());

      if (!isSafeIdParam && !isSafeActionParam) {
        url.searchParams.delete(key);
      }
    }

    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

function decodeResultCategories(rawCategories: unknown): Array<{ id: number; name: string }> {
  if (!Array.isArray(rawCategories)) return [];
  return rawCategories.slice(0, 100).flatMap((category) => {
    if (!category || typeof category !== 'object') return [];
    const { id, name } = category as { id?: unknown; name?: unknown };
    if (!Number.isSafeInteger(id) || Number(id) <= 0) return [];
    return [
      {
        id: Number(id),
        name: typeof name === 'string' ? name.slice(0, 150) : '',
      },
    ];
  });
}

function decodeResultFlags(rawFlags: unknown): string[] {
  if (!Array.isArray(rawFlags)) return [];
  return rawFlags
    .filter((flag): flag is string => typeof flag === 'string' && flag.length <= 100)
    .slice(0, 30);
}

/** Decode both upstream and persisted records; never let arbitrary JSON reach React. */
export function decodeResults(value: unknown, upstream = false): Result[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error('Invalid search response');
  }

  const results: Result[] = [];

  for (const input of value) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;
    const raw = input as Record<string, unknown>;

    if (upstream && raw.protocol !== 'torrent') continue;

    if (
      typeof raw.title !== 'string' ||
      !raw.title.trim() ||
      raw.title.length > 1000 ||
      !Number.isSafeInteger(raw.indexerId) ||
      Number(raw.indexerId) < 1
    ) {
      continue;
    }

    // GUIDs are opaque identity, not links. Hash upstream GUIDs at the server boundary.
    if (typeof raw.guid !== 'string' || !raw.guid || raw.guid.length > 4096) {
      continue;
    }

    results.push({
      guid: raw.guid,
      title: raw.title,
      indexerId: Number(raw.indexerId),
      indexer: typeof raw.indexer === 'string' ? raw.indexer.slice(0, 150) : 'Unknown tracker',
      size:
        typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size > 0 ? raw.size : 0,
      seeders:
        typeof raw.seeders === 'number' && Number.isSafeInteger(raw.seeders) && raw.seeders >= 0
          ? raw.seeders
          : undefined,
      infoHash: normalizeInfoHash(raw.infoHash),
      infoUrl: safeInfoUrl(raw.infoUrl),
      categories: decodeResultCategories(raw.categories),
      indexerFlags: decodeResultFlags(raw.indexerFlags),
    });
  }

  return results;
}
