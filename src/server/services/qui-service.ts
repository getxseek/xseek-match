import { defaultMatching, groupResults, type Result } from '../../domain/matching/group.js';
import { releaseLookupKey } from '../../domain/matching/release-key.js';
import { parseReleaseName } from '../../parser/parse-release-name.js';
import { commentEntries, trackerEntry } from '../../tracker-entry.js';
import { ExpiringCache, InFlight } from '../lib/caching.js';

type QuiConnection = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
};

type QuiClient = {
  id: number;
  name: string;
};

type QuiPresence = {
  resultKey?: string;
  evidence?: 'entry' | 'release';
  hash: string;
  connection: string;
  client: string;
  state: 'seeding' | 'downloading' | 'paused' | 'checking' | 'present';
  url: string;
};

type QuiRelease = {
  key: string;
  title: string;
  size: number;
  hash?: string;
  sourceUrl?: string;
};

type QuiRequest = (
  connection: QuiConnection,
  path: string,
  body?: unknown,
  maxBytes?: number,
) => Promise<unknown>;

function isValidInfoHash(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value);
}

function classifyQuiTorrentState(rawState: unknown, progress: unknown): QuiPresence['state'] {
  const normalized = String(rawState || '').toLowerCase();
  if (/check/.test(normalized)) return 'checking';
  if (/paused|stopped/.test(normalized)) return 'paused';
  if (/up$|uploading/.test(normalized) && Number(progress) >= 1) return 'seeding';
  if (/dl$|downloading|metadl/.test(normalized)) return 'downloading';
  return 'present';
}

function parseEnabledQuiClients(data: unknown): QuiClient[] {
  if (!Array.isArray(data)) throw new Error('Unexpected client response');
  return data
    .filter(
      (row) =>
        Number.isSafeInteger(row?.id) &&
        row.id > 0 &&
        typeof row.name === 'string' &&
        row.enabled !== false &&
        row.is_enabled !== false,
    )
    .slice(0, 33) as QuiClient[];
}

async function runConcurrentWorkers<T>(
  items: T[],
  maxConcurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++]!;
        await worker(item);
      }
    }),
  );
}

export function presenceRows(
  data: any,
  connection: QuiConnection,
  client: QuiClient,
  requested: Set<string>,
): QuiPresence[] {
  if (
    !data ||
    (!Array.isArray(data.torrents) && data.torrents !== null) ||
    Number(data.total) > requested.size
  ) {
    throw new Error('Unexpected torrent response');
  }

  return (data.torrents || []).flatMap((row: any) => {
    const matchedHashes = [row.hash, row.infohash_v1, row.infohash_v2]
      .filter(isValidInfoHash)
      .map((hash: string) => hash.toLowerCase())
      .filter((hash: string) => requested.has(hash));
    if (!matchedHashes.length) return [];

    const state = classifyQuiTorrentState(row.state, row.progress);
    const primaryHash = isValidInfoHash(row.hash) ? row.hash.toLowerCase() : matchedHashes[0];
    const instanceUrl = new URL(`${connection.baseUrl}/instances/${client.id}`);
    instanceUrl.searchParams.set('torrent', primaryHash);

    return matchedHashes.map((hash: string) => ({
      hash,
      connection: connection.name,
      client: client.name.slice(0, 80),
      state,
      url: instanceUrl.href,
    }));
  });
}

export function matchQuiReleases(
  releases: QuiRelease[],
  torrents: any[],
  connection: QuiConnection,
  client: QuiClient,
): QuiPresence[] {
  const candidates = torrents
    .filter(
      (row) =>
        isValidInfoHash(row.hash) &&
        typeof row.name === 'string' &&
        row.name.length <= 1000 &&
        Number(row.size) > 0,
    )
    .map((row) => {
      const result: Result = {
        guid: row.hash,
        title: row.name,
        indexerId: -1,
        indexer: client.name,
        size: Number(row.size),
      };
      const parsed = parseReleaseName(result.title);
      return {
        row,
        result,
        parsed,
        key: releaseLookupKey(parsed),
        entries: commentEntries(row.comment),
      };
    });

  const matches: QuiPresence[] = [];

  for (const release of releases) {
    const result: Result = {
      guid: release.key,
      title: release.title,
      size: release.size,
      indexerId: 1,
      indexer: 'Search',
    };
    const parsed = parseReleaseName(result.title);
    const lookupKey = releaseLookupKey(parsed);

    for (const candidate of candidates) {
      const sourceEntry = trackerEntry(release.sourceUrl);
      const isEntryMatch = Boolean(sourceEntry && candidate.entries.has(sourceEntry));

      if (!isEntryMatch && (!lookupKey || lookupKey !== candidate.key)) continue;

      if (!isEntryMatch) {
        const grouped = groupResults(
          [result, candidate.result],
          defaultMatching,
          new Map([
            [result, parsed],
            [candidate.result, candidate.parsed],
          ]),
        );
        if (grouped.length !== 1 || grouped[0]!.evidence !== 'release') continue;
      }

      const context = presenceRows(
        { total: 1, torrents: [candidate.row] },
        connection,
        client,
        new Set([candidate.row.hash.toLowerCase()]),
      )[0];

      if (context) {
        matches.push({
          ...context,
          resultKey: release.key,
          evidence: isEntryMatch ? 'entry' : 'release',
        });
      }
    }
  }

  return matches;
}

export function validateReleases(value: unknown): QuiRelease[] {
  const isValidReleaseRow = (row: any): row is QuiRelease =>
    Boolean(row) &&
    typeof row.key === 'string' &&
    row.key.length <= 4096 &&
    typeof row.title === 'string' &&
    row.title.length > 0 &&
    row.title.length <= 1000 &&
    Number.isFinite(row.size) &&
    row.size >= 0 &&
    (row.hash === undefined || isValidInfoHash(row.hash)) &&
    (row.sourceUrl === undefined ||
      (typeof row.sourceUrl === 'string' && row.sourceUrl.length <= 4096));

  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 20 ||
    !value.every(isValidReleaseRow)
  ) {
    throw new Error('Provide up to 20 valid releases.');
  }
  return value;
}

export function validateHashes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 100 ||
    !value.every(isValidInfoHash)
  ) {
    throw new Error('Provide up to 100 valid infohashes.');
  }
  return value;
}

export class QuiFeatures {
  private cache = new ExpiringCache<string, any>(100);
  private loads = new InFlight<string, any>();
  /** Bumped by clear(); loads that started before a clear must not repopulate the cache. */
  private revision = 0;

  constructor(private request: QuiRequest) {}

  clear(): void {
    this.revision++;
    this.cache.clear();
  }

  close(): Promise<void> {
    return this.loads.settled();
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const saved = this.cache.get(key);
    if (saved !== undefined) return saved;

    const active = this.loads.get(key);
    if (active) return active;
    if (this.loads.size >= 8) {
      throw new Error('qui is busy. Try again shortly.');
    }

    const startRevision = this.revision;
    return this.loads.run(key, async () => {
      const value = await load();
      if (startRevision === this.revision) this.cache.set(key, value, ttlMs);
      return value;
    });
  }

  private fetchClients(connection: QuiConnection): Promise<QuiClient[]> {
    const cacheKey = JSON.stringify([
      'clients',
      connection.id,
      connection.baseUrl,
      connection.apiKey,
    ]);
    return this.cached(cacheKey, 30_000, async () => {
      const data = await this.request(connection, '/api/instances');
      return parseEnabledQuiClients(data);
    });
  }

  async presence(connections: QuiConnection[], hashes: string[]) {
    const wantedHashes = [...new Set(hashes.map((hash) => hash.toLowerCase()))].sort();

    const responses = await Promise.allSettled(
      connections.slice(0, 4).map((connection) => {
        const cacheKey = JSON.stringify([
          'presence',
          connection.id,
          connection.baseUrl,
          connection.apiKey,
          wantedHashes,
        ]);

        return this.cached(cacheKey, 30_000, async () => {
          const clients = await this.fetchClients(connection);
          const scanClients = clients.slice(0, 32);
          const matches: QuiPresence[] = [];
          let failed = Math.max(0, clients.length - 32);

          await runConcurrentWorkers(scanClients, 3, async (client) => {
            try {
              const filters = encodeURIComponent(JSON.stringify({ hashes: wantedHashes }));
              const data = await this.request(
                connection,
                `/api/instances/${client.id}/torrents?limit=100&prefer=stale&filters=${filters}`,
                undefined,
                2_097_152,
              );
              matches.push(...presenceRows(data, connection, client, new Set(wantedHashes)));
            } catch {
              failed++;
            }
          });

          return { matches, failed };
        });
      }),
    );

    return {
      ok: true,
      matches: responses.flatMap((response) =>
        response.status === 'fulfilled' ? response.value.matches : [],
      ),
      failed: responses.reduce(
        (count, response) => count + (response.status === 'fulfilled' ? response.value.failed : 1),
        0,
      ),
      configured: connections.length > 0,
    };
  }

  private async fetchClientReleaseTorrents(
    connection: QuiConnection,
    client: QuiClient,
    searchTerm: string,
  ): Promise<{ torrents: any[]; truncated: boolean }> {
    const cacheKey = JSON.stringify([
      'releases',
      connection.id,
      connection.baseUrl,
      connection.apiKey,
      client.id,
      searchTerm.toLowerCase(),
    ]);

    return this.cached(cacheKey, 30_000, async () => {
      const torrents: any[] = [];
      let total = 0;

      for (let page = 0; page < 2; page++) {
        const data = (await this.request(
          connection,
          `/api/instances/${client.id}/torrents?limit=200&prefer=stale&page=${page}&search=${encodeURIComponent(searchTerm)}`,
          undefined,
          4_194_304,
        )) as any;

        if (!data || (!Array.isArray(data.torrents) && data.torrents !== null)) {
          throw new Error('Unexpected torrent list response');
        }

        const rows = data.torrents || [];
        torrents.push(
          ...rows.map((row: any) => ({
            hash: row.hash,
            infohash_v1: row.infohash_v1,
            infohash_v2: row.infohash_v2,
            name: row.name,
            size: row.size,
            state: row.state,
            progress: row.progress,
            comment: typeof row.comment === 'string' ? row.comment.slice(0, 16_384) : undefined,
          })),
        );

        total = Number(data.total) || 0;
        if (torrents.length >= total || !rows.length) break;
      }

      return { torrents, truncated: total > torrents.length };
    });
  }

  async releasePresence(connections: QuiConnection[], releases: QuiRelease[], title: string) {
    const searchTerm = (title.match(/[\p{L}\p{N}]{3,}/u) ||
      releases[0]?.title.match(/[\p{L}\p{N}]{3,}/u))?.[0];
    const matches: QuiPresence[] = [];

    if (!searchTerm) {
      return {
        ok: true,
        matches,
        failed: 0,
        truncated: false,
        configured: connections.length > 0,
      };
    }

    let failed = 0;
    let truncated = connections.length > 4;

    for (const connection of connections.slice(0, 4)) {
      try {
        const clients = await this.fetchClients(connection);
        if (clients.length > 32) truncated = true;
        const scanClients = clients.slice(0, 32);

        await runConcurrentWorkers(scanClients, 3, async (client) => {
          try {
            const saved = await this.fetchClientReleaseTorrents(connection, client, searchTerm);
            truncated ||= saved.truncated;
            matches.push(...matchQuiReleases(releases, saved.torrents, connection, client));
          } catch {
            failed++;
          }
        });
      } catch {
        failed++;
      }
    }

    const deduplicated = new Map<string, QuiPresence>();
    for (const match of matches) {
      const key = JSON.stringify([match.resultKey, match.url]);
      if (!deduplicated.has(key) || match.evidence === 'entry') {
        deduplicated.set(key, match);
      }
    }

    return {
      ok: true,
      matches: [...deduplicated.values()],
      failed,
      truncated,
      configured: connections.length > 0,
    };
  }
}
