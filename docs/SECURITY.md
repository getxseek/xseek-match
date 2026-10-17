# Security notes

This is a single-owner, self-hosted application. All signed-in users share configuration and history. The Docker console, persistent volume, host and HTTPS reverse proxy are trusted administrative boundaries. Prowlarr and tracker output are treated as untrusted data. A hostile host or stolen complete volume is outside the protection provided by web login.

## Implemented controls

- First-owner creation is intentionally claimable by the first visitor, and the service listens on the local network by default, so create the owner immediately after first start (or bind `127.0.0.1` until you have). Atomic account creation prevents a second owner. There is no setup-code requirement.
- Passwords use the maintained `argon2` library with Argon2id, 19 MiB memory, two iterations, one lane and random salts. A 8-character minimum supports passphrases without arbitrary composition rules. Passwords are never returned or logged.
- Sessions use random 256-bit tokens. SQLite stores token hashes. Cookies are HttpOnly and SameSite=Strict; HTTPS additionally uses Secure, a host-only cookie and the __Host- prefix. Plain-HTTP origins are accepted only for private-network hosts (loopback, RFC 1918, CGNAT, IPv6 unique-local, single-label and private-use DNS names); on those, session cookies travel unencrypted across the LAN, so use HTTPS if the network is shared or untrusted. Public hostnames require HTTPS. Sessions have absolute and idle expiry, and are revoked by logout or password change/reset.
- State-changing requests require the configured Origin. Authenticated writes additionally require a per-session CSRF token. Login/setup use JSON and strict origin validation. Cross-site requests are rejected.
- Expensive password operations are concurrency-limited and failed authentication attempts are throttled persistently; successful sign-ins are not counted and clear that client's failures. Forwarded client/protocol headers are not trusted.
- APIs enforce authentication centrally. Setup is the only unauthenticated account-creation path. There are no email recovery or browser password-reset endpoints. Password changes require the current password; lost-password reset requires local CLI access.
- Optional integration API keys are stored retrievably in SQLite, omitted from all public connection records, and retained when editing with an empty key. Protect the volume and backups: integration keys are not encrypted at rest. Connection tests and indexer favicon fetches pin DNS resolution, reject redirects/link-local and known metadata targets, keep TLS verification enabled, and expose only sanitized results. Internal LAN/Docker destinations are intentionally supported for owner-configured services.
- Prowlarr credentials stay in environment/secret files. API responses and activity logs omit keys and raw upstream failures. Settings inputs are validated and database statements are parameterized.
- The production server applies a CSP, frame restrictions, nosniff and bounded auth request bodies. Containers use a non-root runtime, persistent volume, read-only root filesystem and reduced capabilities. Development uses the same auth model.

## Verification and limits

Tests cover first-owner setup, completed-setup refusal, login/session handling, CSRF/origin rejection, cookie attributes, logout, password reset/session revocation, HTTPS origin requirements, throttling and preference persistence. These are implementation checks, not a penetration test or OWASP certification.

The password settings follow OWASP's [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Session design is informed by the [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). No ASVS compliance claim is made.

TLS termination and HSTS are expected to be handled at the HTTPS reverse proxy. Multi-factor authentication (MFA) and multi-tenant user accounts are not currently implemented. Persistent rate limits apply to failed authentication attempts and can temporarily throttle login requests during an attack, especially when clients share an egress proxy.

## Reporting a vulnerability

If you discover a security vulnerability in xseek match, please report it privately through [GitHub Private Vulnerability Reporting](https://github.com/getxseek/xseek-match/security/advisories/new) rather than opening a public issue.

Never include credentials, setup links, session cookies, database files, or unredacted service logs in public discussions. If credentials are exposed, rotate API keys upstream and reset the owner password using the administrative CLI.
