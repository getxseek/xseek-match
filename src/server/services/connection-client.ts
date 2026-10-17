import { validateBaseUrl } from '../lib/safe-url.js';
import type { ConnectionRecord as Connection } from '../storage/integrations-store.js';
import { pinnedRequest } from './pinned-http.js';
import { OriginPauses } from './upstream-policy.js';

type ConnectionTarget = Pick<Connection, 'baseUrl' | 'apiKey'>;

const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 15_000;
const PAUSED_MESSAGE = 'Service requested a pause. Retry shortly.';
const UNEXPECTED_RESPONSE_MESSAGE = 'Unexpected response. Check the service type and base URL.';

const pauses = new OriginPauses();

function requestHeaders(apiKey: string, payload: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    Accept: 'application/json',
  };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }
  return headers;
}

/** Operator-facing message for a non-200 status; upstream bodies are never echoed. */
function statusFailureMessage(statusCode: number): string {
  if (statusCode === 429) return PAUSED_MESSAGE;
  if (statusCode === 401 || statusCode === 403) {
    return 'API key rejected. Check the key and any reverse-proxy authentication.';
  }
  if (statusCode >= 300 && statusCode < 400) {
    return 'Connection redirected. Use the final service URL.';
  }
  return 'Service returned an error. Check the base URL and URL base.';
}

/** GETs (or POSTs `body` as JSON to) a Sonarr, Radarr or qui API path and parses the JSON reply. */
export async function requestConnection(
  connection: ConnectionTarget,
  path: string,
  body?: unknown,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
): Promise<unknown> {
  const url = new URL(validateBaseUrl(connection.baseUrl) + path);
  if (pauses.isPaused(url.origin)) throw new Error(PAUSED_MESSAGE);

  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await pinnedRequest(url, {
    method: payload ? 'POST' : 'GET',
    headers: requestHeaders(connection.apiKey, payload),
    payload,
    maxBytes,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 200) {
    if (response.statusCode === 429) {
      pauses.pause(url.origin, String(response.headers['retry-after'] || '') || null);
    }
    throw new Error(statusFailureMessage(response.statusCode));
  }
  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
  }
}

function describeQuiInstances(data: unknown): string {
  const isInstanceList =
    Array.isArray(data) &&
    data.every((row) => row && Number.isInteger(row.id) && typeof row.name === 'string');
  if (!isInstanceList) throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
  return `Connected · ${data.length} client ${data.length === 1 ? 'instance' : 'instances'}`;
}

function describeArrStatus(data: any, kind: Connection['kind']): string {
  const isExpectedApp =
    data &&
    typeof data.version === 'string' &&
    typeof data.appName === 'string' &&
    data.appName.toLowerCase() === kind;
  if (!isExpectedApp) throw new Error(UNEXPECTED_RESPONSE_MESSAGE);
  return `Connected · ${data.version.replace(/[^\w.+-]/g, '').slice(0, 40)}`;
}

/** Confirms the URL and key reach the expected service and returns a short status line. */
export async function probeConnection(
  connection: Pick<Connection, 'kind' | 'baseUrl' | 'apiKey'>,
): Promise<string> {
  if (connection.kind === 'qui') {
    return describeQuiInstances(await requestConnection(connection, '/api/instances'));
  }
  const status = await requestConnection(connection, '/api/v3/system/status');
  return describeArrStatus(status, connection.kind);
}
