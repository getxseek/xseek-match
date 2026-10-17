import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { atomicJson, pruneSearchCache } from './cache-files.js';
import type { IndexerCacheRecord } from '../lib/prowlarr-results.js';

export interface SearchCacheSummary {
  entries: number;
  bytes: number;
  newest: number | null;
  icons: number;
}

export interface CachedSearchResult {
  at: number;
  results: any[];
}

export interface SearchCacheKeyParams {
  prowlarrBaseUrl: string;
  indexerGeneration: number;
  numbering: string;
  searchType: string;
  query: string;
  excludedIds: Iterable<number>;
}

export class SearchCacheStore {
  constructor(readonly cacheDir: string) {}

  buildKey(params: SearchCacheKeyParams): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          6,
          params.prowlarrBaseUrl,
          params.indexerGeneration,
          params.numbering,
          params.searchType,
          params.query.toLowerCase(),
          [...params.excludedIds].sort((left, right) => left - right),
        ]),
      )
      .digest('hex');
  }

  async summarize(): Promise<SearchCacheSummary> {
    let entries = 0;
    let bytes = 0;
    let newest: number | null = null;
    let icons = 0;

    try {
      for (const name of await readdir(this.cacheDir)) {
        const meta = await stat(`${this.cacheDir}/${name}`);
        if (name.startsWith('search-')) {
          entries++;
          bytes += meta.size;
          newest = Math.max(newest ?? 0, meta.mtimeMs);
        }
        if (name.startsWith('icon-')) {
          icons++;
        }
      }
    } catch {}

    return { entries, bytes, newest, icons };
  }

  async readSearch(key: string): Promise<CachedSearchResult | null> {
    try {
      return JSON.parse(await readFile(`${this.cacheDir}/search-${key}.json`, 'utf8'));
    } catch {
      return null;
    }
  }

  async writeSearch(key: string, data: CachedSearchResult): Promise<void> {
    await atomicJson(`${this.cacheDir}/search-${key}.json`, data);
  }

  async prune(maxAgeMs: number): Promise<void> {
    await pruneSearchCache(this.cacheDir, maxAgeMs);
  }

  async readGeneration(): Promise<number> {
    try {
      const value = JSON.parse(await readFile(`${this.cacheDir}/generation.json`, 'utf8'));
      if (Number.isSafeInteger(value) && value >= 0) return value;
    } catch {}
    return 0;
  }

  async writeGeneration(generation: number): Promise<void> {
    await atomicJson(`${this.cacheDir}/generation.json`, generation);
  }

  async readIndexers(): Promise<IndexerCacheRecord | null> {
    try {
      return JSON.parse(await readFile(`${this.cacheDir}/indexers.json`, 'utf8'));
    } catch {
      return null;
    }
  }

  async writeIndexers(cache: IndexerCacheRecord): Promise<void> {
    await atomicJson(`${this.cacheDir}/indexers.json`, cache);
  }

  async readSettingsTtl(): Promise<number | null> {
    try {
      const config = JSON.parse(await readFile(`${this.cacheDir}/settings.json`, 'utf8'));
      if (Number.isInteger(config.ttlMinutes)) return config.ttlMinutes;
    } catch {}
    return null;
  }
}
