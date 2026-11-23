import { decodeResults, initialSearchNote, type Result } from '../../contracts/search.js';
import { normalizeProwlarrResults } from '../lib/prowlarr-results.js';
import { prowlarrQuery } from '../lib/search-query.js';
import type { ActivityLog } from './activity-log.js';
import type { ProwlarrService } from './prowlarr-service.js';
import type { SearchCacheState } from './search-cache-state.js';
import type { SearchCacheStore } from '../storage/search-cache-store.js';
import type { IStatisticsStore } from '../storage/statistics-store.js';
import type { UpstreamPolicy } from './upstream-policy.js';
export interface SearchServiceOptions {
  env: Record<string, string | undefined>;
  prowlarrBaseUrl?: string;
  cacheStore: SearchCacheStore;
  prowlarrService: ProwlarrService;
  statistics: IStatisticsStore;
  logger: ActivityLog;
  upstream: UpstreamPolicy;
  searchCache: SearchCacheState;
  cacheReady: Promise<void>;
  isClosing: () => boolean;
  activeSearches: Set<AbortController>;
}

import { UpstreamPaused, readJson, retryAfterAt } from './upstream-policy.js';

export class SearchFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export interface SearchSnapshot {
  cacheKey: string;
  results: Result[];
  cached: boolean;
  cacheAgeMs: number;
  retrievedAt: number;
  textFallback: boolean | null;
  searchMode: string;
  effectiveQuery: string;
  note: string;
  cacheWarning?: string;
}
interface Flight {
  controller: AbortController;
  promise: Promise<SearchSnapshot>;
  waiters: number;
}
/** Shared browser/machine search cache, bounded admission, cancellation and upstream policy. */
export class SearchService {
  private flights = new Map<string, Flight>();
  constructor(private options: SearchServiceOptions) {}
  async search(
    params: URLSearchParams,
    signal?: AbortSignal,
    beforeLive?: () => void,
    includedIds?: ReadonlySet<number>,
  ): Promise<SearchSnapshot> {
    const options = this.options;
    const started = Date.now();
    const query = params.get('q')?.trim();
    const excludedIds = new Set(
      (params.get('exclude') ?? '').split(',').filter(Boolean).map(Number),
    );
    if ([...excludedIds].some((id) => !Number.isSafeInteger(id) || id < 1))
      throw new SearchFailure(400, 'invalid_request', 'Invalid tracker exclusions.');
    if (!query || query.length > 200)
      throw new SearchFailure(
        400,
        'invalid_request',
        'Enter a show and season (up to 200 characters).',
      );
    if (!options.prowlarrBaseUrl || !options.env.PROWLARR_API_KEY)
      throw new SearchFailure(503, 'dependency_unavailable', 'Prowlarr is not connected.');
    let selected: ReturnType<typeof prowlarrQuery>;
    try {
      selected = prowlarrQuery(params, query);
    } catch {
      throw new SearchFailure(400, 'invalid_request', 'Invalid selected title.');
    }
    await options.cacheReady;
    const key = options.cacheStore.buildKey({
      prowlarrBaseUrl: options.prowlarrBaseUrl,
      indexerGeneration: options.prowlarrService.generationNumber,
      numbering: params.get('numbering') || 'tvdb',
      searchType: selected.type,
      query: selected.query,
      excludedIds,
      includedIds,
    });
    try {
      const stored = await options.cacheStore.readSearch(key);
      if (stored) {
        const age = Date.now() - stored.at;
        if (
          params.get('refresh') !== '1' &&
          age >= 0 &&
          age < options.searchCache.ttlMinutes * 60_000
        ) {
          const results = decodeResults(stored.results);
          if (results.length !== stored.results.length) throw new Error('Invalid cache');
          options.searchCache.recordSearch();
          options.statistics.count('cacheHits');
          options.statistics.timing('search_cached', Date.now() - started);
          return {
            cacheKey: key,
            results,
            cached: true,
            cacheAgeMs: age,
            retrievedAt: stored.at,
            textFallback: null,
            searchMode: selected.type,
            effectiveQuery: selected.query,
            note: initialSearchNote,
          };
        }
      }
    } catch {}
    if (signal?.aborted) throw new SearchFailure(499, 'request_cancelled', 'Request cancelled.');
    beforeLive?.();
    let flight = this.flights.get(key);
    if (!flight) {
      if (this.flights.size || options.isClosing())
        throw new SearchFailure(
          429,
          'search_busy',
          'Another search is finishing. Try again shortly.',
          1,
        );
      const controller = new AbortController();
      options.activeSearches.add(controller);
      flight = { controller, waiters: 0, promise: undefined! };
      const current = flight;
      current.promise = this.live(
        query,
        selected,
        excludedIds,
        key,
        controller,
        includedIds,
      ).finally(() => {
        this.flights.delete(key);
        options.activeSearches.delete(controller);
      });
      this.flights.set(key, current);
    }
    if (flight.waiters >= 16)
      throw new SearchFailure(429, 'search_busy', 'Too many search waiters. Retry shortly.', 1);
    flight.waiters++;
    const current = flight;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', abort);
        current.waiters--;
        if (!current.waiters) current.controller.abort();
        return true;
      };
      const abort = () => {
        if (finish()) reject(new SearchFailure(499, 'request_cancelled', 'Request cancelled.'));
      };
      current.promise.then(
        (value) => {
          if (finish()) resolve(value);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  }
  private async live(
    query: string,
    selected: ReturnType<typeof prowlarrQuery>,
    excluded: Set<number>,
    key: string,
    controller: AbortController,
    includedIds?: ReadonlySet<number>,
  ): Promise<SearchSnapshot> {
    const options = this.options;
    const started = Date.now();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);
    try {
      const url = new URL(`${options.prowlarrBaseUrl!.replace(/\/$/, '')}/api/v1/search`);
      url.searchParams.set('query', selected.query);
      url.searchParams.set('type', selected.type);
      url.searchParams.set('limit', '100');
      if (includedIds) {
        for (const id of includedIds) url.searchParams.append('indexerIds', String(id));
      } else if (excluded.size) {
        const included = (await options.prowlarrService.getIndexers()).filter(
          (indexer) => !excluded.has(indexer.id),
        );
        if (!included.length)
          return {
            cacheKey: key,
            results: [],
            cached: false,
            cacheAgeMs: 0,
            retrievedAt: Date.now(),
            textFallback: false,
            searchMode: selected.type,
            effectiveQuery: selected.query,
            note: initialSearchNote,
          };
        for (const indexer of included) url.searchParams.append('indexerIds', String(indexer.id));
      }
      const fetchResults = async () => {
        options.statistics.count('prowlarrRequests');
        const requestStarted = performance.now();
        try {
          const response = await options.upstream.fetch(url, {
            headers: { 'X-Api-Key': options.env.PROWLARR_API_KEY! },
            signal,
          });
          if (response.status === 429)
            throw new UpstreamPaused(retryAfterAt(response.headers.get('retry-after')));
          if (!response.ok)
            throw new SearchFailure(
              502,
              'upstream_failed',
              `Prowlarr returned HTTP ${response.status}.`,
            );
          let raw: unknown;
          try {
            raw = await readJson(response);
          } catch (error) {
            if (signal.aborted) throw error;
            throw new SearchFailure(
              502,
              'upstream_invalid',
              'Unexpected Prowlarr search response.',
            );
          }
          if (!Array.isArray(raw) || raw.length > 10_000)
            throw new SearchFailure(
              502,
              'upstream_invalid',
              'Unexpected Prowlarr search response.',
            );
          return raw;
        } finally {
          options.statistics.timing('prowlarr_request', performance.now() - requestStarted);
        }
      };
      let raw = await fetchResults();
      let textFallback = false;
      if (!raw.length && selected.type !== 'search') {
        url.searchParams.set('type', 'search');
        url.searchParams.set('query', query);
        raw = await fetchResults();
        textFallback = true;
      }
      const results = normalizeProwlarrResults(raw, excluded).filter(
        (result) => !includedIds || includedIds.has(result.indexerId),
      );
      const at = Date.now();
      if (signal.aborted) throw new Error('Aborted');
      let cacheWarning: string | undefined;
      try {
        await options.cacheStore.writeSearch(key, { at, results });
      } catch {
        cacheWarning = 'Results could not be cached; the next search will run again.';
        options.logger.log('error', 'Could not persist search cache');
      }
      options.statistics.count('liveSearches');
      options.statistics.timing('search_live', Date.now() - started);
      void options.searchCache.schedulePrune();
      options.searchCache.recordSearch();
      options.logger.log('info', `Search completed (${results.length} results)`);
      return {
        cacheKey: key,
        results,
        cached: false,
        cacheAgeMs: 0,
        retrievedAt: at,
        textFallback,
        searchMode: selected.type,
        effectiveQuery: selected.query,
        note: initialSearchNote,
        cacheWarning,
      };
    } catch (error) {
      if (error instanceof SearchFailure) throw error;
      if (error instanceof UpstreamPaused)
        throw new SearchFailure(
          429,
          'upstream_paused',
          error.message,
          Math.max(1, Math.ceil((error.until - Date.now()) / 1000)),
        );
      if (signal.aborted && !controller.signal.aborted)
        throw new SearchFailure(504, 'upstream_timeout', 'Prowlarr search deadline exceeded.');
      throw new SearchFailure(
        502,
        'upstream_failed',
        'Could not complete the Prowlarr search. Check the connection and try again.',
      );
    }
  }
}
