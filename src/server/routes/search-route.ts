import { setJsonNoStoreHeaders, sendJson } from '../lib/http-utils.js';
import {
  SearchFailure,
  SearchService,
  type SearchServiceOptions,
} from '../services/search-service.js';
import type { Router } from './router.js';
export function registerSearchRoute(
  router: Router,
  options: SearchServiceOptions,
  service = new SearchService(options),
): void {
  router.use('/api/match/search', async (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET required' });
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableFinished) controller.abort();
    };
    res.once('close', abort);
    try {
      const params = new URL(req.url ?? '', 'http://localhost').searchParams;
      const result = await service.search(params, controller.signal);
      sendJson(res, 200, {
        results: result.results,
        cached: result.cached,
        note: result.note,
        cacheWarning: result.cacheWarning,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof SearchFailure) {
        if (error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
        sendJson(res, error.status, { error: error.message });
      } else sendJson(res, 502, { error: 'Could not complete the search.' });
    } finally {
      res.off('close', abort);
    }
  });
}
