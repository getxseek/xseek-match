import { serveIndexerFavicon } from '../services/favicon-service.js';
import { sendJson, setJsonNoStoreHeaders } from '../lib/http-utils.js';
import { INDEXER_CACHE_TTL_MS, type ProwlarrService } from '../services/prowlarr-service.js';
import { UpstreamPaused } from '../services/upstream-policy.js';
import type { Router } from './router.js';

export interface IndexersRouteOptions {
  prowlarrBaseUrl?: string;
  prowlarrApiKey?: string;
  prowlarrService: ProwlarrService;
  cacheDir: string;
}

export function registerIndexersRoutes(router: Router, options: IndexersRouteOptions): void {
  const iconRetryAfter = new Map<number, number>();

  router.use('/api/match/indexers', async (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'GET required' });
      return;
    }
    if (!options.prowlarrBaseUrl || !options.prowlarrApiKey) {
      sendJson(res, 200, { message: 'Prowlarr not connected', trackers: [] });
      return;
    }

    try {
      const forceRefresh =
        new URL(req.url ?? '', 'http://localhost').searchParams.get('refresh') === '1';
      const trackers = await options.prowlarrService.getIndexers(forceRefresh);
      const availableCount = trackers.filter((tracker) => tracker.available).length;

      sendJson(res, 200, {
        message: `${availableCount} of ${trackers.length} indexers available`,
        cachedAt: options.prowlarrService.cachedAt,
        trackers: trackers.map(({ origin, ...tracker }) => ({
          ...tracker,
          icon: `/api/match/favicon?id=${tracker.id}`,
        })),
      });
    } catch (error) {
      if (error instanceof UpstreamPaused) {
        res.setHeader('Retry-After', String(Math.ceil((error.until - Date.now()) / 1000)));
        sendJson(res, 429, { error: 'Indexer status unavailable; retry later.' });
        return;
      }
      sendJson(res, 502, { error: 'Indexer status unavailable; retry later.' });
    }
  });

  router.use('/api/match/favicon', async (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const id = Number(new URL(req.url ?? '', 'http://localhost').searchParams.get('id'));
    if (!Number.isSafeInteger(id) || id < 1) {
      res.statusCode = 400;
      res.end();
      return;
    }

    try {
      const tracker = (await options.prowlarrService.getIndexers()).find(
        (entry) => entry.id === id,
      );
      await serveIndexerFavicon({
        id,
        origin: tracker?.origin,
        cacheDir: options.cacheDir,
        ttlMs: INDEXER_CACHE_TTL_MS,
        iconRetryAfter,
        res,
      });
    } catch {
      res.statusCode = 404;
      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.end();
    }
  });
}
