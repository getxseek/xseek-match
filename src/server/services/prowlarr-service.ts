import {
  indexerConfigSignature,
  isFreshIndexerCache,
  parseProwlarrIndexers,
  type Indexer,
  type IndexerCacheRecord,
} from '../lib/prowlarr-results.js';
import type { SearchCacheStore } from '../storage/search-cache-store.js';
import { UpstreamPaused, UpstreamPolicy, readJson, retryAfterAt } from './upstream-policy.js';
import type { ActivityLog } from './activity-log.js';

export const INDEXER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** PROWLARR_URL is the legacy name for PROWLARR_BASE_URL. */
export function prowlarrBaseUrl(env: Record<string, string | undefined>): string | undefined {
  return env.PROWLARR_BASE_URL || env.PROWLARR_URL;
}

export interface ProwlarrServiceOptions {
  baseUrl?: string;
  apiKey?: string;
  upstream?: UpstreamPolicy;
  cacheStore: SearchCacheStore;
  logger: ActivityLog;
}

export class ProwlarrService {
  private baseUrl?: string;
  private apiKey?: string;
  private upstream: UpstreamPolicy;
  private cacheStore: SearchCacheStore;
  private logger: ActivityLog;

  private indexerCache: IndexerCacheRecord | null = null;
  private indexerFlight: Promise<Indexer[]> | undefined;
  private generation = 0;

  constructor(options: ProwlarrServiceOptions) {
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.upstream = options.upstream ?? new UpstreamPolicy();
    this.cacheStore = options.cacheStore;
    this.logger = options.logger;
  }

  get generationNumber(): number {
    return this.generation;
  }

  get cachedAt(): number | null {
    return this.indexerCache?.at ?? null;
  }

  get indexerCount(): number | null {
    return this.indexerCache?.trackers.length ?? null;
  }

  async init(): Promise<void> {
    this.generation = await this.cacheStore.readGeneration();
  }

  async getIndexers(forceRefresh = false): Promise<Indexer[]> {
    if (this.indexerFlight) return this.indexerFlight;
    this.indexerFlight = this.loadIndexers(forceRefresh).finally(() => {
      this.indexerFlight = undefined;
    });
    return this.indexerFlight;
  }

  private async loadIndexers(forceRefresh = false): Promise<Indexer[]> {
    if (!forceRefresh && !this.indexerCache) {
      this.indexerCache = await this.cacheStore.readIndexers();
    }

    if (!forceRefresh && isFreshIndexerCache(this.indexerCache, INDEXER_CACHE_TTL_MS)) {
      return this.indexerCache.trackers;
    }

    const sanitizedBase = this.baseUrl?.replace(/\/$/, '');
    const response = await this.upstream.fetch(`${sanitizedBase}/api/v1/indexer`, {
      headers: { 'X-Api-Key': this.apiKey! },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 429) {
      throw new UpstreamPaused(retryAfterAt(response.headers.get('retry-after')));
    }
    if (!response.ok) throw new Error('Indexer request failed');

    const rawData = await readJson(response);
    if (!Array.isArray(rawData)) throw new Error('Invalid indexer response');

    const trackers = parseProwlarrIndexers(rawData);
    const hasPreviousTrackers =
      this.indexerCache &&
      Array.isArray(this.indexerCache.trackers) &&
      this.indexerCache.trackers.every((row) => row && Number.isSafeInteger(row.id));

    const configurationChanged =
      hasPreviousTrackers &&
      indexerConfigSignature(this.indexerCache!.trackers) !== indexerConfigSignature(trackers);

    if (forceRefresh || configurationChanged) {
      this.generation = Math.max(this.generation + 1, Date.now());
      try {
        await this.cacheStore.writeGeneration(this.generation);
      } catch {
        this.logger.log('error', 'Could not persist cache generation');
      }
    }

    this.indexerCache = { at: Date.now(), trackers };
    this.logger.log('info', `Synced ${trackers.length} indexers from Prowlarr`);

    try {
      await this.cacheStore.writeIndexers(this.indexerCache);
    } catch {
      this.logger.log('error', 'Could not persist indexer cache');
    }

    return trackers;
  }

  async close(): Promise<void> {
    await this.indexerFlight;
  }
}

export type ProwlarrProbeResult =
  { ok: true; count: number } | { ok: false; error: string; missing?: string[] };

function probeFailureForStatus(status: number): string {
  return status === 401 || status === 403
    ? 'Prowlarr rejected the API key. Check PROWLARR_API_KEY and restart.'
    : 'Prowlarr returned an error. Check its URL, URL base and availability.';
}

/** Onboarding check: are the configured Prowlarr URL and key usable, and how many indexers? */
export async function probeProwlarr(
  env: Record<string, string | undefined>,
  upstream: UpstreamPolicy,
): Promise<ProwlarrProbeResult> {
  const missing = ['PROWLARR_BASE_URL', 'PROWLARR_API_KEY'].filter((key) => !env[key]);
  if (missing.length) {
    return {
      ok: false,
      missing,
      error: 'Update these values in .env / Compose and restart the service.',
    };
  }

  try {
    const baseUrl = prowlarrBaseUrl(env)!.replace(/\/$/, '');
    const response = await upstream.fetch(`${baseUrl}/api/v1/indexer`, {
      headers: { 'X-Api-Key': env.PROWLARR_API_KEY! },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false, error: probeFailureForStatus(response.status) };

    const data = await readJson(response);
    if (!Array.isArray(data)) throw new Error('Expected array response');
    return { ok: true, count: parseProwlarrIndexers(data).length };
  } catch {
    return {
      ok: false,
      error:
        'Could not reach Prowlarr. Check PROWLARR_BASE_URL and container network access, then retry.',
    };
  }
}
