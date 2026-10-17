import { ExpiringCache, InFlight } from '../lib/caching.js';
import type { ConnectionRecord as Connection } from '../storage/integrations-store.js';
import { requestConnection } from './connection-client.js';

/** Alternate series titles keyed by TVDB ID. */
type AliasesByTvdbId = Map<number, string[]>;

type AliasSource = Pick<Connection, 'id' | 'baseUrl' | 'apiKey'>;

const LIBRARY_RESPONSE_MAX_BYTES = 16_777_216;
const ALIASES_TTL_MS = 86_400_000;
const FAILED_LOAD_RETRY_MS = 60_000;
const MAX_ALIASES_PER_SERIES = 30;

export function connectionCacheKey(connection: AliasSource): string {
  return JSON.stringify([connection.id, connection.baseUrl, connection.apiKey]);
}

/** Series-wide aliases only; season-specific scene names would mislead whole-show matching. */
function isSeriesWideAlias(alternate: any): boolean {
  return (
    alternate &&
    typeof alternate.title === 'string' &&
    (alternate.sceneSeasonNumber == null || alternate.sceneSeasonNumber === -1) &&
    (alternate.seasonNumber == null || alternate.seasonNumber === -1)
  );
}

function seriesAliases(series: any): string[] {
  const titles = series.alternateTitles
    .filter(isSeriesWideAlias)
    .map((alternate: any) => alternate.title.trim().slice(0, 200))
    .filter(Boolean);
  return [...new Set<string>(titles)].slice(0, MAX_ALIASES_PER_SERIES);
}

function parseLibraryAliases(rows: unknown): AliasesByTvdbId {
  if (!Array.isArray(rows)) throw new Error('Expected series array');
  const aliasesByTvdbId: AliasesByTvdbId = new Map();
  for (const series of rows) {
    if (!Number.isSafeInteger(series.tvdbId) || !Array.isArray(series.alternateTitles)) continue;
    const aliases = seriesAliases(series);
    if (aliases.length) aliasesByTvdbId.set(series.tvdbId, aliases);
  }
  return aliasesByTvdbId;
}

/** Caches each Sonarr library's alternate titles so lookups can match on aliases. */
export class SonarrAliases {
  private cache = new ExpiringCache<string, AliasesByTvdbId>(16);
  private loads = new InFlight<string, AliasesByTvdbId>();

  /** `onRefresh` runs whenever fresh aliases arrive, so dependent caches can be invalidated. */
  constructor(private readonly onRefresh: () => void = () => {}) {}

  load(connection: AliasSource): Promise<AliasesByTvdbId> {
    const key = connectionCacheKey(connection);
    const fresh = this.cache.get(key);
    if (fresh) return Promise.resolve(fresh);
    return this.loads.run(key, () => this.fetchLibrary(connection, key));
  }

  /** Aliases from the last load, even if expired; empty when none have loaded yet. */
  current(connection: AliasSource): AliasesByTvdbId {
    return this.cache.peek(connectionCacheKey(connection)) ?? new Map();
  }

  isLoading(connection: AliasSource): boolean {
    return this.loads.has(connectionCacheKey(connection));
  }

  settled(): Promise<void> {
    return this.loads.settled();
  }

  private async fetchLibrary(connection: AliasSource, key: string): Promise<AliasesByTvdbId> {
    try {
      const rows = await requestConnection(
        connection,
        '/api/v3/series',
        undefined,
        LIBRARY_RESPONSE_MAX_BYTES,
      );
      const aliases = parseLibraryAliases(rows);
      this.cache.set(key, aliases, ALIASES_TTL_MS);
      this.onRefresh();
      return aliases;
    } catch {
      const fallback = this.current(connection);
      this.cache.set(key, fallback, FAILED_LOAD_RETRY_MS);
      return fallback;
    }
  }
}
