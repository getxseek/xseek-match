# src/server

Node HTTP backend for xseek-match. Imports flow one way: `routes → services → storage → lib`.
A layer never imports from a layer to its left.

| Path                | What lives here                                                                    |
| ------------------- | ---------------------------------------------------------------------------------- |
| `main.ts`           | Process entry: env, port, graceful shutdown.                                       |
| `reset-password.ts` | CLI entry for `npm run reset-password`.                                            |
| `http.ts`           | The `http.Server`: security headers, auth gate, route dispatch, static files.      |
| `api.ts`            | Composition root: builds stores and services, registers every route, drains them.  |
| `routes/`           | One file per API area. Parse the request, call a service or store, write JSON.     |
| `services/`         | Stateful logic and outbound calls (Prowlarr, Sonarr/Radarr, qui, XEM, auth).       |
| `storage/`          | SQLite stores, migrations and on-disk cache files.                                 |
| `lib/`              | Pure helpers with no state: HTTP utils, URL safety, title ranking, result parsing. |

Naming: `routes/*-route.ts`, `services/*-service.ts`, `storage/*-store.ts`.
