# Changelog

All notable changes to xseek match will be documented in this file.

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
