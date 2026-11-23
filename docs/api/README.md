# Match API v1

Resolve TV/movie titles and search releases from another application. Create a named key in **Settings → API access**, choose its scopes, and copy it into your consumer's secret store. Keys expire after 90 days unless you choose no expiry. The secret is shown once.

See the [OpenAPI 3.1 contract](openapi.yaml) for request and response schemas.

## Quickstart

Set `MATCH_URL` to your match origin and load `MATCH_API_KEY` from your secret store. Avoid embedding keys in scripts or URLs.

```sh
curl --fail-with-body -H "Authorization: Bearer $MATCH_API_KEY" "$MATCH_URL/api/v1/me"
curl --fail-with-body -H "Authorization: Bearer $MATCH_API_KEY" "$MATCH_URL/api/v1/capabilities"
curl --fail-with-body -H "Authorization: Bearer $MATCH_API_KEY" "$MATCH_URL/api/v1/indexers"
curl --fail-with-body -H "Authorization: Bearer $MATCH_API_KEY" -H 'Content-Type: application/json' \
  --data '{"query":"Horizon Line","mediaType":"tv","limit":10}' "$MATCH_URL/api/v1/titles/lookup"
curl --fail-with-body -H "Authorization: Bearer $MATCH_API_KEY" -H 'Content-Type: application/json' \
  --data '{"query":"Horizon Line S01","limit":100}' "$MATCH_URL/api/v1/search"
```

For structured search, copy a lookup result's `mediaType` and `ids` into `selection`. TV uses `tvdb`; movies use `tmdb`. Both accept an optional `imdb`. TV selections also accept `season` and `episode`. Example with a placeholder provider ID:

```json
{"query":"Example Show","selection":{"mediaType":"tv","ids":{"tvdb":123},"season":1,"episode":2},"numbering":"tvdb","limit":100}
```

`numbering: "release"` requires a TV selection and searches literal numbering. A numeric suffix in `query` must agree with explicit season/episode fields.

Omit `indexerIds` to search all enabled, searchable torrent indexers, independently of browser preferences. An explicit list must contain 1 to 100 known available IDs. Discovery omits disabled and non-searchable indexers; temporarily unavailable indexers have `available: false`.

## Responses

Success uses `{ "data": ..., "meta": { "requestId": ... } }`. Errors use `{ "error": { "code", "message", "requestId", "retryAfterSeconds"? } }`. Every response includes `X-Request-Id` for diagnostics.

| Status | Action |
| --- | --- |
| 400 | Correct the request fields or JSON. |
| 401 | Replace the missing, invalid, expired or revoked key. |
| 403 | Review the key's scopes. Cross-origin browser calls are unsupported. |
| 404 | Check the endpoint path. |
| 405 | Use the method in `Allow`. |
| 413 / 415 | Reduce the body or use `application/json`. |
| 429 | Wait for `Retry-After`. |
| 502 / 503 / 504 | Check dependency failures, availability or search deadline. |

Search metadata includes retrieval time (Unix milliseconds), cache hit/age, effective query, numbering, search mode, warnings, truncation and text fallback. Structured searches retry once as text when empty. `textFallback` is `null` for cached snapshots because the existing cache does not retain it.

Prowlarr's initial response can omit results, so `completeness` is always `unknown`. `truncated` describes the returned snapshot. Missing size, seeders and hashes are omitted. Results contain opaque hashed IDs and optional allowlisted detail-page URLs.

Title matches omit source instance names, library presence and paths. `enrichmentPending` means aliases are still loading. Partial source failures return a `lookup_partial` warning; all failed sources return 502; no configured source returns 503.

## Limits

| Limit | Value |
| --- | --- |
| JSON body | 16 KiB; unknown fields rejected |
| Query | 2 to 200 characters |
| Search results | Default 100, maximum 500; sorted by indexer ID then release ID |
| Title matches | Default 10, maximum 50 |
| Requests per key | 30 per fixed one-minute window |
| Uncached search attempts per key | 5 per window; joins and busy responses count |
| Live search | One shared browser/API slot, 16 waiters, 90-second deadline |
| Upstream search response | 16 MiB, 10,000 decoded rows |
| Distinct title lookups | Two concurrent; existing lookup cache/coalescing applies |

Cached calls consume the general request budget. Identical live searches share work; disconnecting one caller leaves other waiters running. Work stops when all waiters leave, at the deadline or on shutdown. Upstream `Retry-After` pauses remain authoritative. Budgets are process-local; multiple replicas require shared coordination.

## Keys and recovery

Rotate by creating a replacement, updating/testing the consumer with `/me`, then revoking the old key. Expiry and revocation stop subsequent requests immediately; running work can finish. Password changes, browser logout, session revocation and OIDC unlinking do not revoke keys. Use **Revoke all keys** during compromise recovery.

Key changes require an owner session, origin/CSRF checks and current-password verification. Keys work only under `/api/v1`; cookies cannot authorize v1. Call from your backend. Bearer headers cannot authorize internal account or integration routes.

Keys contain 256 random secret bits. SQLite stores SHA-256 digests. Last-used writes occur at most once per minute. Non-secret lifecycle events are limited to 1,000 entries and pruned after 30 days on startup/activity. The additive `api_keys` and `api_key_events` tables leave owner/session schemas untouched. Back up `match.sqlite` before upgrading.

Set `API_V1_ENABLED=false` and restart to disable v1 without deleting keys. Shared cache/live/upstream metrics include API work; browser search journey counts remain browser-only. Access diagnostics omit query text and credentials.

## Compatibility

Clients must ignore unknown response fields and handle new error/warning codes conservatively. Required field types, meanings and identity namespaces remain stable within v1. Grouping, downloads and snapshot pagination are deferred.

Before release, smoke-test a consumer against your deployed Prowlarr/Sonarr/Radarr versions. Fixture tests do not exercise those deployments.
