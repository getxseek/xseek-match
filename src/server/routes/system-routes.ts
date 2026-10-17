import { SEARCH_TTL_MINUTES_MAX, SEARCH_TTL_MINUTES_MIN } from '../../contracts/preferences.js';
import { isSameOriginRequest, sendJson, setJsonNoStoreHeaders } from '../lib/http-utils.js';
import type { ActivityLog } from '../services/activity-log.js';
import type { GitStatus } from '../services/system-info.js';
import { buildSystemInfo } from '../services/system-info.js';
import type { IPreferencesStore } from '../storage/preferences-store.js';
import type { SearchCacheState } from '../services/search-cache-state.js';
import type { SearchCacheStore } from '../storage/search-cache-store.js';
import type { TrackerDefinitions } from '../services/tracker-definitions-service.js';
import type { Xem } from '../services/xem-service.js';
import type { Router } from './router.js';

export interface SystemRoutesOptions {
  env: Record<string, string | undefined>;
  prowlarrBaseUrl?: string;
  production: boolean;
  git: GitStatus;
  startedAt: number;
  preferences: IPreferencesStore;
  cacheStore: SearchCacheStore;
  logger: ActivityLog;
  definitions: TrackerDefinitions;
  xem: Xem;
  searchCache: SearchCacheState;
  getIndexerStats: () => { cachedAt: number | null; count: number | null };
  cacheReady: Promise<void>;
}

export function registerSystemRoutes(router: Router, options: SystemRoutesOptions): void {
  router.use('/api/match/tracker-definitions', async (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    await options.definitions.ready;
    const currentSnapshot = options.definitions.snapshot();
    if (req.method === 'POST' || (!currentSnapshot.at && currentSnapshot.running)) {
      await options.definitions.refresh();
    }
    sendJson(res, 200, options.definitions.snapshot());
  });

  router.use('/api/match/xem', async (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const id = Number(new URL(req.url || '', 'http://localhost').searchParams.get('id'));
      sendJson(res, 200, await options.xem.get(id));
    } catch {
      sendJson(res, 400, { error: 'Invalid TVDB ID' });
    }
  });

  router.use('/api/match/logs', (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    sendJson(res, 200, { logs: options.logger.entries() });
  });

  router.use('/api/match/cache', async (req, res) => {
    setJsonNoStoreHeaders(res);
    await options.cacheReady;

    if (req.method === 'POST') {
      if (!isSameOriginRequest(req, options.env)) {
        res.statusCode = 403;
        res.end('{}');
        return;
      }
      const minutes = Number(new URL(req.url ?? '', 'http://localhost').searchParams.get('ttl'));
      if (
        !Number.isInteger(minutes) ||
        minutes < SEARCH_TTL_MINUTES_MIN ||
        minutes > SEARCH_TTL_MINUTES_MAX
      ) {
        sendJson(res, 400, {
          error: `TTL must be ${SEARCH_TTL_MINUTES_MIN}–${SEARCH_TTL_MINUTES_MAX} minutes.`,
        });
        return;
      }
      options.preferences.save({ 'xseek-match-cache-ttl': JSON.stringify(minutes) });
      options.searchCache.setTtl(minutes);
      options.logger.log('info', `Search cache TTL set to ${minutes} minutes`);
    } else if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }

    const summary = await options.cacheStore.summarize();
    const stats = options.searchCache.stats();
    sendJson(res, 200, {
      ...summary,
      hits: stats.hits,
      lastUsed: stats.lastSearchAt,
      ttlMinutes: stats.ttlMinutes,
    });
  });

  router.use('/api/match/info', (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }

    const indexerStats = options.getIndexerStats();
    sendJson(
      res,
      200,
      buildSystemInfo({
        git: options.git,
        startedAt: options.startedAt,
        production: options.production,
        prowlarrBaseUrl: options.prowlarrBaseUrl,
        prowlarrApiKey: options.env.PROWLARR_API_KEY,
        indexerCacheHours: 24,
        indexerCachedAt: indexerStats.cachedAt,
        indexerCount: indexerStats.count,
      }),
    );
  });
}
