import { decodeResults, initialSearchNote } from '../../contracts/search.js';
import { setJsonNoStoreHeaders, sendJson } from '../lib/http-utils.js';
import { normalizeProwlarrResults } from '../lib/prowlarr-results.js';
import { prowlarrQuery } from '../lib/search-query.js';
import type { ActivityLog } from '../services/activity-log.js';
import type { ProwlarrService } from '../services/prowlarr-service.js';
import type { SearchCacheState } from '../services/search-cache-state.js';
import type { SearchCacheStore } from '../storage/search-cache-store.js';
import type { IStatisticsStore } from '../storage/statistics-store.js';
import {
  UpstreamPaused,
  type UpstreamPolicy,
  readJson,
  retryAfterAt,
} from '../services/upstream-policy.js';
import type { Router } from './router.js';

export interface SearchRouteOptions {
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
  /** Searches in progress; aborted when the server shuts down. */
  activeSearches: Set<AbortController>;
}

export function registerSearchRoute(router: Router, options: SearchRouteOptions): void {
  let searchRunning = false;

  router.use('/api/match/search', async (req, res) => {
    setJsonNoStoreHeaders(res);
    const operationStarted = Date.now();
    let tracked = false;
    let selectedSearch!: ReturnType<typeof prowlarrQuery>;

    const sendSearchResponse = (status: number, body: unknown) => {
      if (tracked) {
        options.statistics.count(status === 200 ? 'searches' : 'failed');
        if (status === 200) {
          options.statistics.timing('durationMs', Date.now() - operationStarted);
          if (selectedSearch.type !== 'search') options.statistics.count('enriched');
        }
      }
      sendJson(res, status, body);
    };

    if (req.method !== 'GET') {
      return sendSearchResponse(405, { error: 'GET required' });
    }

    const params = new URL(req.url ?? '', 'http://localhost').searchParams;
    const query = params.get('q')?.trim();
    const excludedIds = new Set(
      (params.get('exclude') ?? '').split(',').filter(Boolean).map(Number),
    );

    if ([...excludedIds].some((id) => !Number.isSafeInteger(id) || id < 1)) {
      return sendSearchResponse(400, { error: 'Invalid tracker exclusions.' });
    }
    if (!query || query.length > 200) {
      return sendSearchResponse(400, { error: 'Enter a show and season (up to 200 characters).' });
    }
    if (!options.prowlarrBaseUrl || !options.env.PROWLARR_API_KEY) {
      return sendSearchResponse(503, {
        error:
          'Prowlarr is not connected. Set PROWLARR_BASE_URL and PROWLARR_API_KEY in the server environment.',
      });
    }

    try {
      selectedSearch = prowlarrQuery(params, query);
    } catch {
      return sendSearchResponse(400, { error: 'Invalid selected title.' });
    }

    tracked = true;
    await options.cacheReady;

    const cacheKey = options.cacheStore.buildKey({
      prowlarrBaseUrl: options.prowlarrBaseUrl,
      indexerGeneration: options.prowlarrService.generationNumber,
      numbering: params.get('numbering') || 'tvdb',
      searchType: selectedSearch.type,
      query: selectedSearch.query,
      excludedIds,
    });

    try {
      const stored = await options.cacheStore.readSearch(cacheKey);
      if (stored) {
        const cacheAgeMs = Date.now() - stored.at;
        const ttlMinutes = options.searchCache.ttlMinutes;
        const isFresh =
          params.get('refresh') !== '1' &&
          Number.isFinite(stored.at) &&
          cacheAgeMs >= 0 &&
          cacheAgeMs < ttlMinutes * 60_000;

        if (isFresh) {
          const decoded = decodeResults(stored.results);
          if (decoded.length !== stored.results.length) {
            throw new Error('Invalid cached record');
          }
          stored.results = decoded;
          options.searchCache.recordSearch();
          options.statistics.count('cacheHits');

          res.once('finish', () => {
            try {
              options.statistics.queueOverlap(stored.results, `${cacheKey}:${stored.at}`);
            } catch {
              options.logger.log('error', 'Could not queue overlap statistics');
            }
          });

          options.statistics.timing('search_cached', Date.now() - operationStarted);
          options.logger.log('info', `Search cache hit (${stored.results.length} results)`);
          return sendSearchResponse(200, {
            results: stored.results,
            cached: true,
            note: initialSearchNote,
          });
        }
      }
    } catch {}

    if (searchRunning || options.isClosing()) {
      res.setHeader('Retry-After', '1');
      return sendSearchResponse(429, { error: 'Another search is finishing. Try again shortly.' });
    }

    searchRunning = true;
    options.logger.log('info', 'Searching Prowlarr');

    const controller = new AbortController();
    options.activeSearches.add(controller);
    const abortOnClose = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', abortOnClose);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]);

    try {
      const searchUrl = new URL(`${options.prowlarrBaseUrl.replace(/\/$/, '')}/api/v1/search`);
      searchUrl.searchParams.set('query', selectedSearch.query);
      searchUrl.searchParams.set('type', selectedSearch.type);
      searchUrl.searchParams.set('limit', '100');

      if (excludedIds.size) {
        const included = (await options.prowlarrService.getIndexers()).filter(
          (indexer) => !excludedIds.has(indexer.id),
        );
        if (!included.length) return sendSearchResponse(200, { results: [] });
        for (const indexer of included) {
          searchUrl.searchParams.append('indexerIds', String(indexer.id));
        }
      }

      const fetchProwlarrSearch = async (target: URL) => {
        options.statistics.count('prowlarrRequests');
        const requestStarted = performance.now();
        try {
          const response = await options.upstream.fetch(target, {
            headers: { 'X-Api-Key': options.env.PROWLARR_API_KEY! },
            signal,
          });
          if (response.status === 429) {
            throw new UpstreamPaused(retryAfterAt(response.headers.get('retry-after')));
          }
          return response;
        } finally {
          options.statistics.timing('prowlarr_request', performance.now() - requestStarted);
        }
      };

      let searchResponse = await fetchProwlarrSearch(searchUrl);
      if (!searchResponse.ok) {
        options.logger.log('error', `Prowlarr returned HTTP ${searchResponse.status}`);
        return sendSearchResponse(502, {
          error: `Prowlarr returned HTTP ${searchResponse.status}.`,
        });
      }

      let rawData = await readJson(searchResponse);
      if (!Array.isArray(rawData) || rawData.length > 10_000) {
        return sendSearchResponse(502, { error: 'Unexpected Prowlarr search response.' });
      }

      if (rawData.length === 0 && selectedSearch.type !== 'search') {
        searchUrl.searchParams.set('type', 'search');
        searchUrl.searchParams.set('query', query);
        searchResponse = await fetchProwlarrSearch(searchUrl);
        if (!searchResponse.ok) {
          return sendSearchResponse(502, {
            error: `Prowlarr returned HTTP ${searchResponse.status}.`,
          });
        }
        rawData = await readJson(searchResponse);
        if (!Array.isArray(rawData) || rawData.length > 10_000) {
          return sendSearchResponse(502, { error: 'Unexpected Prowlarr search response.' });
        }
        options.logger.log('info', 'Used text fallback after empty structured search');
      }

      const results = normalizeProwlarrResults(rawData, excludedIds);
      if (signal.aborted) return;

      const observedAt = Date.now();
      res.once('finish', () => {
        try {
          options.statistics.queueOverlap(results, `${cacheKey}:${observedAt}`);
        } catch {
          options.logger.log('error', 'Could not queue overlap statistics');
        }
      });

      options.statistics.count('liveSearches');
      options.statistics.timing('search_live', Date.now() - operationStarted);

      let cacheWarning: string | undefined;
      try {
        await options.cacheStore.writeSearch(cacheKey, { at: observedAt, results });
      } catch {
        cacheWarning = 'Results could not be cached; the next search will run again.';
        options.logger.log('error', 'Could not persist search cache');
      }

      void options.searchCache.schedulePrune();
      options.searchCache.recordSearch();
      options.logger.log('info', `Search completed (${results.length} results)`);

      if (!controller.signal.aborted) {
        sendSearchResponse(200, { results, cached: false, note: initialSearchNote, cacheWarning });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof UpstreamPaused) {
        const retrySeconds = Math.max(1, Math.ceil((error.until - Date.now()) / 1000));
        res.setHeader('Retry-After', String(retrySeconds));
        return sendSearchResponse(429, { error: error.message });
      }
      options.logger.log('error', 'Search failed or timed out');
      sendSearchResponse(502, {
        error: 'Could not complete the Prowlarr search. Check the connection and try again.',
      });
    } finally {
      res.off('close', abortOnClose);
      options.activeSearches.delete(controller);
      searchRunning = false;
    }
  });
}
