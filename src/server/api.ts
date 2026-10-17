import { join } from 'node:path';
import type { Router } from './routes/router.js';
import { PreferencesStore } from './storage/preferences-store.js';
import {
  registerIndexersRoutes,
  registerIntegrationsRoute,
  registerPreferencesRoute,
  registerSearchRoute,
  registerStatisticsRoute,
  registerSystemRoutes,
} from './routes/index.js';
import { ActivityLog } from './services/activity-log.js';
import { ProwlarrService, prowlarrBaseUrl } from './services/prowlarr-service.js';
import { SearchCacheState } from './services/search-cache-state.js';
import { readGitStatus } from './services/system-info.js';
import { StatisticsStore } from './storage/statistics-store.js';
import { SearchCacheStore } from './storage/search-cache-store.js';
import { TrackerDefinitions } from './services/tracker-definitions-service.js';
import { UpstreamPolicy } from './services/upstream-policy.js';
import { Xem } from './services/xem-service.js';
import { Integrations } from './services/integrations-service.js';

export function installApi(
  targetRouter: Router,
  env: Record<string, string | undefined>,
  dataDir: string,
  production = false,
  upstream = new UpstreamPolicy(),
) {
  let closing = false;
  const activeRequests = new Set<Promise<void>>();

  const router: Router = {
    use(path, handler) {
      targetRouter.use(path, async (req, res) => {
        if (closing) {
          res.statusCode = 503;
          res.end();
          return;
        }
        const task = Promise.resolve().then(() => handler(req, res));
        activeRequests.add(task);
        try {
          await task;
        } finally {
          activeRequests.delete(task);
        }
      });
    },
  };

  const prowlarrUrl = prowlarrBaseUrl(env);
  const sqlitePath = join(dataDir, 'match.sqlite');
  const cacheDir = join(dataDir, 'match-cache');

  const cacheStore = new SearchCacheStore(cacheDir);
  const preferences = new PreferencesStore(sqlitePath);
  const definitions = new TrackerDefinitions(dataDir);
  const xem = new Xem(sqlitePath);
  const statistics = new StatisticsStore(sqlitePath);
  const integrations = new Integrations(dataDir);

  const logger = new ActivityLog();
  const prowlarrService = new ProwlarrService({
    baseUrl: prowlarrUrl,
    apiKey: env.PROWLARR_API_KEY,
    upstream,
    cacheStore,
    logger,
  });

  const startedAt = Date.now();
  const git = readGitStatus();

  const searchCache = new SearchCacheState(cacheStore, preferences, logger);
  const activeSearches = new Set<AbortController>();

  const cacheReady = (async () => {
    await searchCache.restoreTtl();
    await prowlarrService.init();
  })();
  void cacheReady.then(() => searchCache.schedulePrune());

  registerSystemRoutes(router, {
    env,
    prowlarrBaseUrl: prowlarrUrl,
    production,
    git,
    startedAt,
    preferences,
    cacheStore,
    logger,
    definitions,
    xem,
    searchCache,
    getIndexerStats: () => ({
      cachedAt: prowlarrService.cachedAt,
      count: prowlarrService.indexerCount,
    }),
    cacheReady,
  });

  registerPreferencesRoute(router, {
    env,
    preferences,
    searchCache,
  });

  registerStatisticsRoute(router, {
    preferences,
    statistics,
  });

  registerIntegrationsRoute(router, {
    store: integrations,
    statistics,
  });

  registerIndexersRoutes(router, {
    prowlarrBaseUrl: prowlarrUrl,
    prowlarrApiKey: env.PROWLARR_API_KEY,
    prowlarrService,
    cacheDir,
  });

  registerSearchRoute(router, {
    env,
    prowlarrBaseUrl: prowlarrUrl,
    cacheStore,
    prowlarrService,
    statistics,
    logger,
    upstream,
    searchCache,
    cacheReady,
    isClosing: () => closing,
    activeSearches,
  });

  let closeFlight: Promise<void> | undefined;
  return () =>
    (closeFlight ??= (async () => {
      closing = true;
      for (const controller of activeSearches) controller.abort();
      await Promise.allSettled([...activeRequests, cacheReady]);
      await Promise.allSettled([
        xem.close(),
        definitions.close(),
        integrations.close(),
        searchCache.settled(),
        prowlarrService.close(),
      ]);
      statistics.close();
      preferences.close();
    })());
}
