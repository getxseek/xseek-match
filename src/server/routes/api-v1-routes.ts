import type { Result } from '../../contracts/search.js';
import type { ActivityLog } from '../services/activity-log.js';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { API_LIMITS, type ApiScope } from '../../contracts/api-v1.js';
import { sendJson, readJsonObjectBody } from '../lib/http-utils.js';
import type { Integrations } from '../services/integrations-service.js';
import type { ProwlarrService } from '../services/prowlarr-service.js';
import { ApiKeys } from '../services/api-key-service.js';
import {
  SearchFailure,
  type SearchService,
  type TvSearchNumbering,
} from '../services/search-service.js';
import { UpstreamPaused } from '../services/upstream-policy.js';
import type { Router } from './router.js';

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/i;
const IMDB_ID = /^tt\d{1,12}$/;
const TV_NUMBERING_SUFFIX = /\s+S(\d{1,3})(?:E(\d{1,3}))?$/i;
const PUBLIC_DETAILS_PATH = /^\/(?:details\.php|torrents\/details\/\d+)$/i;

function invalid(message = 'Invalid request.'): never {
  throw new SearchFailure(400, 'invalid_request', message);
}
function requireInteger(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) invalid();
  return Number(value);
}
function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function validateFields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) invalid('Unknown request field.');
}
export function parseApiSearch(input: Record<string, unknown>): {
  params: URLSearchParams;
  limit: number;
  indexerIds?: number[];
  tvNumbering?: TvSearchNumbering;
} {
  validateFields(input, ['query', 'selection', 'numbering', 'indexerIds', 'limit']);
  if (
    typeof input.query !== 'string' ||
    input.query.trim().length < API_LIMITS.queryMinCharacters ||
    input.query.length > API_LIMITS.queryMaxCharacters
  )
    invalid('Query must contain 2–200 characters.');
  const query = input.query.trim();
  let tvNumbering: TvSearchNumbering | undefined;
  const params = new URLSearchParams();
  if (input.selection !== undefined) {
    const selection = requireObject(input.selection);
    validateFields(selection, ['mediaType', 'ids', 'season', 'episode']);
    const ids = requireObject(selection.ids);
    if (selection.mediaType !== 'tv' && selection.mediaType !== 'movie') invalid();
    validateFields(ids, selection.mediaType === 'tv' ? ['tvdb', 'imdb'] : ['tmdb', 'imdb']);
    const id = requireInteger(selection.mediaType === 'tv' ? ids.tvdb : ids.tmdb, 1, 2_147_483_647);
    params.set('kind', selection.mediaType === 'tv' ? 'sonarr' : 'radarr');
    params.set('id', String(id));
    if (ids.imdb !== undefined) {
      if (typeof ids.imdb !== 'string' || !IMDB_ID.test(ids.imdb)) invalid();
      params.set('imdb', ids.imdb);
    }
    if (
      selection.mediaType === 'movie' &&
      (selection.season !== undefined || selection.episode !== undefined)
    )
      invalid('Movies do not accept season or episode.');
    if (selection.episode !== undefined && selection.season === undefined)
      invalid('Episode requires a season.');
    if (selection.season !== undefined) {
      const season = requireInteger(selection.season, 0, 999);
      const episode =
        selection.episode === undefined ? undefined : requireInteger(selection.episode, 0, 999);
      const suffix = query.match(TV_NUMBERING_SUFFIX);
      if (
        suffix &&
        (Number(suffix[1]) !== season ||
          (episode !== undefined && Number(suffix[2]) !== episode) ||
          (episode === undefined && suffix[2] !== undefined))
      )
        invalid('Query numbering conflicts with selection.');
      if (!suffix) tvNumbering = { season, episode };
    }
  }
  if (input.numbering !== undefined && input.numbering !== 'tvdb' && input.numbering !== 'release')
    invalid();
  if (input.numbering === 'release' && params.get('kind') !== 'sonarr')
    invalid('Release numbering requires a TV selection.');
  params.set('q', query);
  params.set('numbering', String(input.numbering ?? 'tvdb'));
  let indexerIds: number[] | undefined;
  if (input.indexerIds !== undefined) {
    if (
      !Array.isArray(input.indexerIds) ||
      !input.indexerIds.length ||
      input.indexerIds.length > API_LIMITS.selectedIndexers
    )
      invalid('Choose 1–100 indexers.');
    indexerIds = [...new Set(input.indexerIds.map((id) => requireInteger(id, 1, 2_147_483_647)))];
  }
  return {
    params,
    tvNumbering,
    limit:
      input.limit === undefined
        ? API_LIMITS.defaultSearchResults
        : requireInteger(input.limit, 1, API_LIMITS.searchResults),
    indexerIds,
  };
}
async function readApiBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!JSON_CONTENT_TYPE.test(req.headers['content-type'] ?? ''))
    throw new SearchFailure(
      415,
      'unsupported_media_type',
      'Content-Type must be application/json.',
    );
  try {
    return await readJsonObjectBody(req, API_LIMITS.bodyBytes);
  } catch (error) {
    if (error instanceof Error && error.message === 'Request too large.')
      throw new SearchFailure(413, 'body_too_large', 'Request body exceeds 16 KiB.');
    invalid('Expected a JSON object.');
  }
}
interface ApiV1Options {
  keys: ApiKeys;
  logger: ActivityLog;
  search: SearchService;
  integrations: Integrations;
  prowlarr: ProwlarrService;
  configured: boolean;
  enabled: boolean;
}

function sendCapabilities(res: ServerResponse, requestId: string, options: ApiV1Options): void {
  const connections = options.integrations.list().filter((connection) => connection.enabled);
  sendJson(res, 200, {
    data: {
      version: '1',
      operations: ['search', 'titles.lookup', 'indexers', 'me'],
      searchAvailable: options.configured,
      titleLookup: {
        tv: connections.some((connection) => connection.kind === 'sonarr'),
        movie: connections.some((connection) => connection.kind === 'radarr'),
      },
      limits: {
        ...API_LIMITS,
        liveSearchConcurrency: 1,
        deadlineSeconds: 90,
      },
    },
    meta: { requestId },
  });
}

async function lookupTitles(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  integrations: Integrations,
): Promise<void> {
  const input = await readApiBody(req);
  validateFields(input, ['query', 'mediaType', 'limit']);
  if (
    typeof input.query !== 'string' ||
    input.query.trim().length < API_LIMITS.queryMinCharacters ||
    input.query.length > API_LIMITS.queryMaxCharacters ||
    !['tv', 'movie', 'all'].includes(String(input.mediaType))
  )
    invalid('Query must contain 2–200 characters and mediaType must be tv, movie or all.');
  const limit =
    input.limit === undefined
      ? API_LIMITS.defaultLookupResults
      : requireInteger(input.limit, 1, API_LIMITS.lookupResults);
  const result = (await integrations.execute({
    action: 'lookup',
    title: input.query,
    contentType: input.mediaType,
  })) as {
    matches: Array<{
      kind: string;
      id: number;
      title: string;
      year: number | null;
      aliases: string[];
      imdb?: string;
      poster?: string;
      originalTitle?: string;
    }>;
    failed: number;
    instances: number;
    enrichmentPending: boolean;
    cached?: boolean;
  };
  if (!result.instances)
    throw new SearchFailure(
      503,
      'dependency_unavailable',
      'No title lookup source is configured for this media type.',
    );
  if (result.failed === result.instances)
    throw new SearchFailure(502, 'upstream_failed', 'All title lookup sources failed.');
  const matches = result.matches.slice(0, limit).map((row) => ({
    mediaType: row.kind === 'sonarr' ? 'tv' : 'movie',
    ids: {
      [row.kind === 'sonarr' ? 'tvdb' : 'tmdb']: row.id,
      ...(row.imdb ? { imdb: row.imdb } : {}),
    },
    title: row.title,
    year: row.year,
    aliases: row.aliases,
    originalTitle: row.originalTitle,
    artwork: row.poster,
  }));
  sendJson(res, 200, {
    data: { matches },
    meta: {
      requestId,
      cached: result.cached === true,
      enrichmentPending: result.enrichmentPending,
      truncated: result.matches.length > limit,
      warnings: result.failed
        ? [{ code: 'lookup_partial', message: 'Some title lookup sources failed.' }]
        : [],
    },
  });
}

function toApiRelease(result: Result) {
  const infoUrl =
    result.infoUrl && PUBLIC_DETAILS_PATH.test(new URL(result.infoUrl).pathname)
      ? result.infoUrl
      : undefined;
  return {
    id: result.guid,
    title: result.title,
    indexerId: result.indexerId,
    indexer: result.indexer,
    size: result.size > 0 ? result.size : undefined,
    seeders: result.seeders,
    infoHash: result.infoHash,
    infoUrl,
    categories: result.categories,
    indexerFlags: result.indexerFlags,
  };
}

async function searchReleases(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
  keyId: string,
  options: ApiV1Options,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once('close', abort);
  try {
    const parsed = parseApiSearch(await readApiBody(req));
    if (controller.signal.aborted) return;
    if (parsed.indexerIds) {
      const indexers = await options.prowlarr.getIndexers();
      if (controller.signal.aborted) return;
      if (
        parsed.indexerIds.some(
          (id) => !indexers.some((indexer) => indexer.id === id && indexer.available),
        )
      )
        invalid('Unknown or unavailable indexer ID.');
      parsed.params.set(
        'exclude',
        indexers
          .filter((indexer) => !parsed.indexerIds!.includes(indexer.id))
          .map((indexer) => indexer.id)
          .join(','),
      );
    }
    const snapshot = await options.search.search(
      parsed.params,
      controller.signal,
      () => {
        const retry = options.keys.consumeRequestBudget(keyId, 'live-search');
        if (retry)
          throw new SearchFailure(
            429,
            'rate_limited',
            'Live search attempt budget exceeded.',
            retry,
          );
      },
      parsed.indexerIds ? new Set(parsed.indexerIds) : undefined,
      parsed.tvNumbering,
    );
    const results = [...snapshot.results]
      .sort(
        (left, right) => left.indexerId - right.indexerId || left.guid.localeCompare(right.guid),
      )
      .slice(0, parsed.limit)
      .map(toApiRelease);
    if (!controller.signal.aborted)
      sendJson(res, 200, {
        data: { results },
        meta: {
          requestId,
          retrievedAt: snapshot.retrievedAt,
          cached: snapshot.cached,
          cacheAgeMs: snapshot.cacheAgeMs,
          effectiveQuery: snapshot.effectiveQuery,
          searchMode: snapshot.searchMode,
          numbering: parsed.params.get('numbering'),
          textFallback: snapshot.textFallback,
          completeness: 'unknown',
          truncated: snapshot.results.length > parsed.limit,
          warnings: [
            { code: 'initial_response', message: snapshot.note },
            ...(snapshot.cacheWarning
              ? [{ code: 'cache_write_failed', message: snapshot.cacheWarning }]
              : []),
          ],
        },
      });
  } finally {
    res.off('close', abort);
  }
}

export function registerApiV1Routes(router: Router, options: ApiV1Options): void {
  const operations: Record<string, { method: string; scope?: ApiScope }> = {
    '/api/v1/capabilities': { method: 'GET' },
    '/api/v1/me': { method: 'GET' },
    '/api/v1/indexers': { method: 'GET', scope: 'indexers:read' },
    '/api/v1/titles/lookup': { method: 'POST', scope: 'titles:read' },
    '/api/v1/search': { method: 'POST', scope: 'search:read' },
  };
  const handler = (path: string) => async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = Date.now();
    let keyId = 'unauthenticated';
    let reasonCode = 'ok';
    res.once('finish', () =>
      options.logger.log(
        'info',
        `API ${requestId} key=${keyId} operation=${operations[path] ? path : 'unknown'} status=${res.statusCode} reason=${reasonCode} durationMs=${Date.now() - started}`,
      ),
    );
    const fail = (error: SearchFailure) => {
      reasonCode = error.code;
      if (error.status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="match-api-v1"');
      if (error.retryAfterSeconds) res.setHeader('Retry-After', String(error.retryAfterSeconds));
      sendJson(res, error.status, {
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
        },
      });
    };
    try {
      if (!options.enabled) throw new SearchFailure(503, 'api_disabled', 'API v1 is disabled.');
      const key = options.keys.authenticate(req.headers.authorization);
      if (!key) throw new SearchFailure(401, 'unauthorized', 'A valid bearer API key is required.');
      keyId = key.id;
      const retry = options.keys.consumeRequestBudget(key.id);
      if (retry)
        throw new SearchFailure(
          429,
          'rate_limited',
          'Request budget exceeded. Retry shortly.',
          retry,
        );
      const requestPath = new URL(req.url ?? '/', 'http://localhost').pathname;
      const operation = requestPath === '/' || requestPath === path ? operations[path] : undefined;
      if (!operation) throw new SearchFailure(404, 'not_found', 'Unknown API route.');
      if (req.method !== operation.method) {
        res.setHeader('Allow', operation.method);
        throw new SearchFailure(405, 'method_not_allowed', `${operation.method} required.`);
      }
      if (operation.scope && !key.scopes.includes(operation.scope))
        throw new SearchFailure(403, 'insufficient_scope', `Requires ${operation.scope}.`);
      if (req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site')
        throw new SearchFailure(
          403,
          'browser_origin_not_supported',
          'Cross-origin browser API clients are not supported.',
        );
      if (path.endsWith('/me')) {
        sendJson(res, 200, { data: key, meta: { requestId } });
        return;
      }
      if (path.endsWith('/capabilities')) return sendCapabilities(res, requestId, options);
      if (path.endsWith('/titles/lookup'))
        return await lookupTitles(req, res, requestId, options.integrations);
      if (!options.configured)
        throw new SearchFailure(503, 'dependency_unavailable', 'Prowlarr is not connected.');
      if (path.endsWith('/indexers')) {
        const indexers = (await options.prowlarr.getIndexers()).map(
          ({ id, name, categories, available }) => ({ id, name, categories, available }),
        );
        sendJson(res, 200, { data: { indexers }, meta: { requestId } });
        return;
      }
      await searchReleases(req, res, requestId, key.id, options);
    } catch (error) {
      if (res.destroyed) return;
      if (error instanceof SearchFailure) fail(error);
      else if (error instanceof UpstreamPaused)
        fail(
          new SearchFailure(
            429,
            'upstream_paused',
            'Upstream requested a pause.',
            Math.max(1, Math.ceil((error.until - Date.now()) / 1000)),
          ),
        );
      else if (error instanceof Error && error.message.includes('lookup is busy'))
        fail(new SearchFailure(429, 'lookup_busy', 'Title lookup is busy.', 1));
      else
        fail(
          new SearchFailure(502, 'upstream_failed', 'Could not complete the upstream operation.'),
        );
    }
  };
  for (const path of Object.keys(operations)) router.use(path, handler(path));
  router.use('/api/v1', handler('/api/v1'));
}
