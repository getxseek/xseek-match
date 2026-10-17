import { ExpiringCache, InFlight } from '../lib/caching.js';
import { rankTitles } from '../lib/media-titles.js';
import type { ConnectionRecord as Connection } from '../storage/integrations-store.js';
import { lookupArr, type ArrLookupResult } from './arr-lookup.js';
import { connectionCacheKey, type SonarrAliases } from './sonarr-aliases.js';

export type LookupTarget = 'sonarr' | 'radarr' | 'all';

type AliasedResult = ArrLookupResult & { aliases: string[] };
type MergedResult = AliasedResult & { sources: string[] };

const MAX_CONCURRENT_LOOKUPS = 2;
const FOUND_TTL_MS = 86_400_000;
const NOT_FOUND_TTL_MS = 300_000;

export function parseLookupRequest(input: Record<string, unknown>): {
  title: string;
  target: LookupTarget;
} {
  const { title, contentType } = input;
  if (
    typeof title !== 'string' ||
    title.trim().length < 2 ||
    title.length > 200 ||
    !['tv', 'movie', 'all'].includes(String(contentType))
  ) {
    throw new Error('Enter at least two characters and choose TV or Movie.');
  }
  const target = contentType === 'tv' ? 'sonarr' : contentType === 'movie' ? 'radarr' : 'all';
  return { title, target };
}

/** Combines rows that several instances returned for the same title into one entry. */
function mergeByKey(resultsPerInstance: AliasedResult[][]): MergedResult[] {
  const merged = new Map<string, MergedResult>();
  for (const row of resultsPerInstance.flat()) {
    const existing = merged.get(row.key);
    if (!existing) {
      merged.set(row.key, { ...row, sources: [row.source] });
      continue;
    }
    existing.aliases = [...new Set([...existing.aliases, ...row.aliases])];
    if (!existing.originalTitle && row.originalTitle) existing.originalTitle = row.originalTitle;
    if (!existing.sources.includes(row.source)) existing.sources.push(row.source);
  }
  return [...merged.values()];
}

/** Title search across every enabled Sonarr/Radarr instance, enriched with library aliases. */
export class TitleLookup {
  private cache = new ExpiringCache<string, object>(100);
  private lookups = new InFlight<string, object>();

  constructor(private readonly aliases: SonarrAliases) {}

  /** Cached results may predate alias enrichment; call when aliases change. */
  invalidate(): void {
    this.cache.clear();
  }

  settled(): Promise<void> {
    return this.lookups.settled();
  }

  lookup(title: string, target: LookupTarget, connections: Connection[]): Promise<object> {
    const cacheKey = JSON.stringify([
      title.trim().toLowerCase(),
      target,
      connections.map(connectionCacheKey),
    ]);

    const cached = this.cache.get(cacheKey);
    if (cached) return Promise.resolve({ ...cached, cached: true });

    const active = this.lookups.get(cacheKey);
    if (active) return active;
    if (this.lookups.size >= MAX_CONCURRENT_LOOKUPS) {
      return Promise.reject(new Error('Title lookup is busy. Retry shortly.'));
    }
    return this.lookups.run(cacheKey, () => this.search(title, connections, cacheKey));
  }

  private async lookupWithAliases(connection: Connection, title: string) {
    if (connection.kind === 'sonarr') void this.aliases.load(connection);
    const rows = await lookupArr(connection, title);
    const aliases = this.aliases.current(connection);
    return rows.map((row) => ({ ...row, aliases: aliases.get(row.id) || [] }));
  }

  private async search(title: string, connections: Connection[], cacheKey: string) {
    const startTime = performance.now();
    const responses = await Promise.allSettled(
      connections.map((connection) => this.lookupWithAliases(connection, title)),
    );
    const succeeded = responses.flatMap((response) =>
      response.status === 'fulfilled' ? [response.value] : [],
    );
    const enrichmentPending = connections.some(
      (connection) => connection.kind === 'sonarr' && this.aliases.isLoading(connection),
    );
    const matches = rankTitles(mergeByKey(succeeded), title.trim());

    const value = {
      ok: true,
      enrichmentPending,
      matches,
      elapsedMs: Math.round(performance.now() - startTime),
      instances: connections.length,
      failed: responses.length - succeeded.length,
    };

    if (value.failed === 0 && !enrichmentPending) {
      this.cache.set(cacheKey, value, matches.length ? FOUND_TTL_MS : NOT_FOUND_TTL_MS);
    }
    return value;
  }
}
