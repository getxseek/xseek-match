# Security notes

This is a single-owner, self-hosted application. All signed-in users share configuration and history. The Docker console, persistent volume, host and HTTPS reverse proxy are trusted administrative boundaries. Prowlarr and tracker output are treated as untrusted data. A hostile host or stolen complete volume is outside the protection provided by web login.

## Implemented controls

- First-owner creation is intentionally claimable by the first visitor, and the service listens on the local network by default, so create the owner immediately after first start (or bind `127.0.0.1` until you have). Atomic account creation prevents a second owner. There is no setup-code requirement.
- Passwords use the maintained `argon2` library with Argon2id, 19 MiB memory, two iterations, one lane and random salts. A 8-character minimum supports passphrases without arbitrary composition rules. Passwords are never returned or logged.
- Sessions use random 256-bit tokens. SQLite stores token hashes. Cookies are HttpOnly and SameSite=Strict; HTTPS additionally uses Secure, a host-only cookie and the __Host- prefix. Plain-HTTP origins are accepted only for private-network hosts (loopback, RFC 1918, CGNAT, IPv6 unique-local, single-label and private-use DNS names); on those, session cookies travel unencrypted across the LAN, so use HTTPS if the network is shared or untrusted. Public hostnames require HTTPS. Sessions have absolute and idle expiry, and are revoked by logout or password change/reset.
- State-changing requests require the configured Origin. Authenticated writes additionally require a per-session CSRF token. Login/setup use JSON and strict origin validation. Cross-site requests are rejected.
- Expensive password operations are concurrency-limited. Password failures and OIDC initiation are throttled persistently per client and globally; each failure extends the window. Successful sign-ins clear that client's failures and give the browser a device cookie (random token, hashed in SQLite, 180 days, revoked by password change/reset). Attempts carrying a valid device cookie are limited per device only, so failures from elsewhere cannot lock the owner out. Forwarded headers are ignored unless `TRUST_PROXY` is set; then the client address is read from `X-Forwarded-For`, counted from the right by the number of trusted proxies. Set it only when every request passes through the proxy, or clients can choose their own address.
- Optional OpenID Connect sign-in requires password-authorized owner linking and validates the issuer/subject through `openid-client`. Provider sessions expire within one hour, capped by ID-token expiry. Unlinking or disabling OIDC revokes provider sessions. See [OIDC setup and recovery](oidc.md) for configuration, revocation limits and rollback requirements.
- APIs enforce authentication centrally. Setup is the only unauthenticated account-creation path. There are no email recovery or browser password-reset endpoints. Password changes require the current password; lost-password reset requires local CLI access.
- Optional integration API keys are stored retrievably in SQLite, omitted from all public connection records, and retained when editing with an empty key as long as the address keeps its origin; changing the origin requires the key again, so a stored key is never sent to a new host. Protect the volume and backups: integration keys are not encrypted at rest. Connection tests and indexer favicon fetches pin DNS resolution, reject redirects/link-local and known metadata targets, keep TLS verification enabled, and expose only sanitized results. Internal LAN/Docker destinations are intentionally supported for owner-configured services.
- Prowlarr credentials stay in environment/secret files. API responses and activity logs omit keys and raw upstream failures. Settings inputs are validated and database statements are parameterized.
- The production server applies a CSP, frame restrictions, nosniff and bounded auth request bodies. Containers use a non-root runtime, persistent volume, read-only root filesystem and reduced capabilities. Development uses the same auth model.

## Verification and limits

Tests cover first-owner setup, completed-setup refusal, login/session handling, CSRF/origin rejection, cookie attributes, logout, password reset/session revocation, HTTPS origin requirements, throttling and preference persistence. These are implementation checks, not a penetration test or OWASP certification.

OIDC tests exercise the real client against a signed mock provider: discovery, JWKS rotation, signatures, claims, state/nonce/PKCE, transaction replay, concurrent linking, session expiry and offline recovery. Before release, run the deployed Pocket ID smoke described in the OIDC runbook.

The password settings follow OWASP's [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Session design is informed by the [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). No ASVS compliance claim is made.

TLS termination and HSTS are expected to be handled at the HTTPS reverse proxy. Multi-factor authentication (MFA) and multi-tenant user accounts are not currently implemented. Persistent rate limits apply to failed authentication attempts and can temporarily throttle login requests during an attack from browsers without a device cookie, especially when clients share an egress proxy and `TRUST_PROXY` is not set.

## Reporting a vulnerability

If you discover a security vulnerability in xseek match, please report it privately through [GitHub Private Vulnerability Reporting](https://github.com/getxseek/xseek-match/security/advisories/new) rather than opening a public issue.

Never include credentials, setup links, session cookies, database files, or unredacted service logs in public discussions. If credentials are exposed, rotate any exposed Prowlarr or integration API key upstream and reset the owner password using the administrative CLI.

## Machine API v1

API v1 requires an opaque bearer key, with no browser-cookie fallback. Keys contain 256 random secret bits and only SHA-256 digests are stored in the additive `api_keys` table. Keys have explicit search/title/indexer scopes and cannot authenticate internal browser, account or integration routes. Owner key changes require session, origin, CSRF and current-password verification. Lifecycle audit events are non-secret, bounded to 1,000 events and pruned after 30 days on startup/activity; last-used writes are throttled to one minute.

Rotate by creating and testing a replacement, then explicitly revoking the old key. Expiry/revocation stops subsequent requests immediately; running requests can finish. Browser logout, password changes, OIDC unlinking and session revocation do not revoke API keys: use the separate revoke-all-keys control during compromise recovery. `API_V1_ENABLED=false` disables machine access after restart without deleting records.

External DTOs omit source integration names/URLs, library presence, download links and credentials. Release identity is opaque; optional details URLs use the shared query sanitizer plus a strict path allowlist. Bounded JSON/results, per-key request/search-attempt budgets and a shared single live-search slot limit work. These admission budgets are process-local: multiple replicas are unsupported until coordination is added. Query text and bearer tokens are excluded from API access diagnostics. See [API operating limits](api/README.md) for the contract and limitations.
