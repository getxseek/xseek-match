# Changelog

All notable changes to xseek match will be documented in this file.

## Unreleased

- Respect provider Retry-After pauses across OpenID Connect requests.
- Preserve the API's 200-character query allowance when adding TV season and episode numbering.
- Stop disconnected API requests before starting a search after indexer discovery.
- Keep local password sign-in available when provider sign-in reaches its rate limit.
- Include API searches in completed-search counts, cache-hit rates and tracker overlap statistics.
- Group a re-release with its original year (`Title 1981 2004 Director's Cut` with `Title 1981`), read `Title Season 3 2011` as a movie rather than a season pack, and read a leading `[Title] 2009` as the title rather than a group tag.
- Keep a movie's year when a word in its title reads like a release tag (`Web`, `Dual`, `Hybrid`, `Internal`), so two copies of such a movie group together again and different years stay apart.
- Group more copies of the same release across indexers: anime batches with no season (`[Group] Show (BD 1080p) [Batch]`), fansub groups written as a leading `[Name-Subs]` or a trailing `-Name-Subs`, encoder groups inside the spec block (`(1080p … - Encoder) [Collective]` and `(… - Encoder Collective)`), and titles that end in a Roman-numeral season (`Show.XI.S11` with `Show.S11`). `Ma10` is read as a 10-bit tag, never as a group or part of the title, and `(Season 7)` in parentheses is read as season 7.
- Treat a plain `HDR` tag as HDR10 and `DV HDR10+` as the same file as `DV HDR` when grouping. HLG is now its own HDR value instead of reading as SDR.
- Verify provider sessions can manage consumer keys without granting keys access to browser authentication routes.

- Use filled neutral authentication buttons with readable text contrast.
- Remove the unused session-revocation UI branch from provider settings.
- Place Test OIDC connection beside the provider heading and show its result inside the card with a green success icon.
- Remove the tracker-definition source caption from Tasks.
- Add task-header padding and responsive wrapping, and use consistent neutral Run now buttons without refresh icons.
- Remove redundant provider helper copy and give Link account and Confirm unlink a filled button treatment.
- Apply the selected Icon toolbar style to provider settings: unboxed status with an icon and grouped ghost actions instead of capsule chips and outlined controls.
- Hide password confirmation for linked providers until Unlink provider is selected. Cancel clears the password and leaves the link intact.
- Mark linked providers green, simplify Security to provider controls, and add an OIDC configuration check for discovery, capabilities and signing-key access. Client credentials and callbacks remain verified by sign-in.
- Show incorrect-password errors beside the relevant account or provider password field, with accessible field associations.
- Separate provider linking and active sessions into clear Security cards, show link status, and move connection diagnostics into troubleshooting.
- Reject ID tokens containing audiences other than the configured client ID, even when the authorized party matches. Test string and single-element array audiences.
- Add standard OpenID Connect owner sign-in using maintained openid-client, discovery, code flow with PKCE/state/nonce, and signature/JWKS/issuer/audience validation. Pocket ID is the primary compatibility target.
- Add explicit password-authorized linking/unlinking, bounded single-use transactions and callback cookies, one-hour maximum provider sessions, session list/revocation, safe logout and local recovery.
- Add server-only OIDC configuration, provider discovery diagnostics, bounded security events, setup/rollback runbook, and signed mock-provider security tests. Local sign-in remains enabled; real Pocket ID smoke is a release gate.
- Use the application User-Agent for OIDC requests and format feature SQL for review.
- Recheck password-confirmed unlink authorization in the same transaction as identity removal.
- Prevent a search cancelled during cache lookup from starting upstream work or producing an unhandled rejection. Covered by a disconnect regression.

### API v1
- Make API key creation and saved-key details easier to scan, with aligned scopes, quiet action toolbars, green success states, and password errors beside the field.
- Return the standard API error response for the bare `/api/v1` root as well as versioned subpaths.
- Add bearer-only search, TV/movie title lookup, capability/indexer discovery and credential inspection with a documented OpenAPI 3.1 contract and consumer examples.
- Add named SHA-256-digested scoped keys, expiry, explicit replacement/revocation, bounded security events, and password-confirmed Settings > API access management. Credentials are shown once and cannot authorize internal browser/admin routes.
- Share search cache, upstream pauses, deadline and one live admission slot across UI/API; coalesce identical work with independent waiter cancellation, bounded responses and per-key budgets.
- Preserve browser session origin/CSRF checks; return stable API errors/request IDs and secret-free external DTOs with explicit unknown completeness.

## 0.1.1 - 2026-10-17

### Fixed
- Container image publish: disabled SLSA provenance attestations (`provenance: false`) so multi-arch images are published with Docker v2 manifest lists, restoring compatibility with older Docker daemons (< 20.10.21) and LTS server distributions.

## 0.1.0 - 2026-10-17

Initial release of xseek match: a release-matching search frontend for your Prowlarr indexers, with *arr and torrent client integrations.

### Search & release matching
- Query all configured Prowlarr indexers in parallel with fuzzy release grouping.
- Match uploads across trackers using parsed metadata rather than raw file names.
- Star preferred indexers to prioritize grabs and buffer building across result cards.
- View freeleech status, seed counts, file sizes, and release group watermarks at a glance.
- Cache search results with configurable TTL (15 to 1440 minutes, defaulting to 60 minutes).

### Integrations
- **Sonarr & Radarr**: TV and movie title lookups directly in the search bar, with posters, aliases, and TheXEM scene numbering for season/episode searches.
- **qui**: Real-time presence detection to flag releases already downloading or seeding in your client.
- In-app connection management with instant test feedback for multiple service instances.

### Customization & themes
- 12 dark themes: xseek (original rose-red `#e5484d` on near-black), Midnight, Dracula, Nord, Catppuccin Mocha, Gruvbox, Solarized Dark, One Dark, Monokai, Tokyo Night, GitHub Dark, and Rosé Pine.
- Custom accent color picker with live WCAG contrast checking.

### Statistics & history
- Content overlap matrix displaying cross-seeding and release overlap across indexers.
- Response time metrics comparing live indexer latencies against cache lookups.
- Persistent search journey history with quick re-run shortcuts.

### Deployment & security
- Docker Compose and baremetal (Node 24+) deployment options.
- First-run owner account setup with Argon2id password hashing, session tokens, and CSRF protection.
- Brute-force sign-in throttling per IP and globally.
- Pinned DNS transport blocking private metadata IPs and SSRF risks on outbound requests.
- Headless fixture and screenshot capture tooling (`npm run screenshot`).
