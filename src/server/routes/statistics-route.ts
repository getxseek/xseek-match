import { setJsonNoStoreHeaders, sendJson } from '../lib/http-utils.js';
import type { IPreferencesStore } from '../storage/preferences-store.js';
import type { IStatisticsStore } from '../storage/statistics-store.js';
import type { Router } from './router.js';

export interface StatisticsRouteOptions {
  preferences: IPreferencesStore;
  statistics: IStatisticsStore;
}

export function registerStatisticsRoute(router: Router, options: StatisticsRouteOptions): void {
  router.use('/api/match/statistics', (req, res) => {
    setJsonNoStoreHeaders(res);
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.end();
      return;
    }
    const customNames = JSON.parse(
      options.preferences.snapshot().values['xseek-match-customnames'] || '{}',
    );
    sendJson(res, 200, options.statistics.snapshot(customNames));
  });
}
