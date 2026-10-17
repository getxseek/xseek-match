import {
  isSameOriginRequest,
  readJsonObjectBody,
  sendJson,
  setJsonNoStoreHeaders,
} from '../lib/http-utils.js';
import type { SearchCacheState } from '../services/search-cache-state.js';
import { PreferenceConflict, type IPreferencesStore } from '../storage/preferences-store.js';
import type { Router } from './router.js';

export interface PreferencesRouteOptions {
  env: Record<string, string | undefined>;
  preferences: IPreferencesStore;
  searchCache: SearchCacheState;
}

export function registerPreferencesRoute(router: Router, options: PreferencesRouteOptions): void {
  router.use('/api/match/preferences', async (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method === 'GET') {
      sendJson(res, 200, options.preferences.snapshot());
      return;
    }
    if (req.method !== 'PUT' && req.method !== 'POST') {
      res.statusCode = 405;
      res.end('{}');
      return;
    }
    if (!isSameOriginRequest(req, options.env)) {
      res.statusCode = 403;
      res.end('{}');
      return;
    }

    try {
      const input = await readJsonObjectBody(req, 300_000);
      if (!input.values || typeof input.values !== 'object' || Array.isArray(input.values)) {
        throw new Error('Invalid preference payload.');
      }

      const snapshot = options.preferences.save(
        input.values as Record<string, string>,
        req.method === 'POST',
        input.expected as Record<string, number> | undefined,
      );

      if (snapshot.values['xseek-match-cache-ttl']) {
        try {
          const minutes = JSON.parse(snapshot.values['xseek-match-cache-ttl']);
          if (Number.isInteger(minutes)) options.searchCache.setTtl(minutes);
        } catch {}
      }

      sendJson(res, 200, snapshot);
    } catch (error) {
      const isConflict = error instanceof PreferenceConflict;
      sendJson(res, isConflict ? 409 : 400, {
        error: isConflict ? error.message : 'Could not save preferences.',
      });
    }
  });
}
