# Changelog

All notable changes to xseek match will be documented in this file.

## 0.2.0 - 2026-11-23

Adds an API, single sign-on and a Yata integration, and groups more copies of the same release.

### API v1
- Search your trackers and look up TV and movie titles from your own scripts and tools.
- Named API keys with scopes and expiry, managed under **Settings → API access**. Keys are shown once and can't sign in to the app.
- Documented with an OpenAPI 3.1 contract and a quickstart.

### Single sign-on
- Sign in with Pocket ID or any standard OpenID Connect provider.
- Link and unlink the owner account under **Accounts → Security**. Password sign-in keeps working as a fallback.
- Review and revoke active provider sessions.

### Yata
- See your ratio, buffer, hit and runs and promotion progress on each tracker next to its results.
- Get warned before a grab overdraws your buffer.
- Freeleech copies and trackers you're working towards a promotion on rank higher in a release group.

### Matching
- Re-releases group with the original year, and more anime, fansub and encoder group variants match across indexers.
- `HDR` matches `HDR10`, `DV HDR10+` matches `DV HDR`, and HLG is now its own HDR type.
- `H.264`/`x264` and `H.265`/`x265` count as the same encoder.

### Changed
- The screenshot fixture no longer contains real tracker names.

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
