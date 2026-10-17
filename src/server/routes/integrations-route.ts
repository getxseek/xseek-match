import { readJsonObjectBody, sendJson, setJsonNoStoreHeaders } from '../lib/http-utils.js';
import type { Integrations } from '../services/integrations-service.js';
import type { IStatisticsStore } from '../storage/statistics-store.js';
import type { Router } from './router.js';

export interface IntegrationsRouteOptions {
  store: Integrations;
  statistics?: IStatisticsStore;
}

export function registerIntegrationsRoute(router: Router, options: IntegrationsRouteOptions): void {
  let isMutating = false;

  router.use('/api/match/integrations', async (req, res) => {
    setJsonNoStoreHeaders(res);

    if (req.method === 'GET') {
      const connections = options.store.list();
      void options.store.warmAliases();
      sendJson(res, 200, {
        connections,
        capabilities: [
          ...new Set(
            connections
              .filter((connection) => connection.enabled)
              .flatMap((connection) => connection.capabilities),
          ),
        ],
      });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, {});
      return;
    }

    let acquiredLock = false;
    try {
      const input = await readJsonObjectBody(req, 131_072);
      const isReadAction = ['lookup', 'presence', 'release-presence'].includes(
        String(input.action),
      );

      if (!isReadAction) {
        if (isMutating) {
          res.setHeader('Retry-After', '1');
          sendJson(res, 429, {
            error: 'Another connection operation is running. Retry shortly.',
          });
          return;
        }
        isMutating = true;
        acquiredLock = true;
      }

      const startTime = performance.now();
      try {
        const result = await options.store.execute(input);
        if (isReadAction) {
          const metricName =
            input.action === 'presence' || input.action === 'release-presence'
              ? 'qui_presence'
              : (result as { cached?: boolean }).cached
                ? 'lookup_cached'
                : 'lookup_live';
          options.statistics?.timing(metricName, performance.now() - startTime);
        }
        sendJson(res, 200, result);
      } catch (error) {
        if (input.action === 'lookup' || input.action === 'presence') {
          options.statistics?.timing(`${input.action}_failed`, performance.now() - startTime);
        }
        throw error;
      }
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Could not update connection.',
      });
    } finally {
      if (acquiredLock) isMutating = false;
    }
  });
}
