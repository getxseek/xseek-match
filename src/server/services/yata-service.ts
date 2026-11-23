import { trackerHost, type TrackerAccount } from '../../tracker-accounts.js';
import { ExpiringCache, InFlight } from '../lib/caching.js';
import type { Indexer } from '../lib/prowlarr-results.js';

type YataConnection = {
  id: string;
  kind: 'yata';
  name: string;
  baseUrl: string;
  apiKey: string;
};

type YataRequest = (connection: YataConnection, path: string) => Promise<unknown>;

/** A Yata tracker before it is joined to an indexer. */
type YataTracker = Omit<TrackerAccount, 'indexerId' | 'connection'> & {
  id: string;
  host: string;
};

type AccountsResponse = {
  accounts: TrackerAccount[];
  unmatched: { connection: string; name: string }[];
  failed: string[];
};

/** Yata refreshes trackers every 30 minutes by default. */
const SUMMARY_TTL_MS = 5 * 60_000;
const MAX_TRACKERS = 500;
const STATUSES: readonly TrackerAccount['status'][] = [
  'ok',
  'error',
  'disabled',
  'opted_out',
  'retired',
  'unknown',
];

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function count(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

export function parseYataSummary(data: any): YataTracker[] {
  if (!data || !Array.isArray(data.trackers)) throw new Error('Unexpected Yata response');
  return data.trackers.slice(0, MAX_TRACKERS).flatMap((row: any): YataTracker[] => {
    const id = text(row?.id, 64);
    const name = text(row?.name, 120);
    const host = typeof row?.url === 'string' ? trackerHost(row.url) : null;
    if (!id || !name || !host || row.enabled === false) return [];
    const status = STATUSES.includes(row.status) ? row.status : 'unknown';
    return [
      {
        id,
        host,
        name,
        abbr: text(row.abbr, 20),
        status,
        errorKind: status === 'error' ? text(row.error_kind, 40) : undefined,
        group: text(row.group, 80),
        ratio: number(row.ratio),
        uploadedGib: number(row.uploaded_gib),
        downloadedGib: number(row.downloaded_gib),
        bufferGib: number(row.buffer_gib),
        seeding: count(row.seeding),
        bonusPoints: number(row.bonus_points),
        hitAndRuns: count(row.hit_and_runs),
        warnings: count(row.warnings),
        updatedAt: count(row.updated_at) ?? 0,
      },
    ];
  });
}

export function parseYataTargets(data: any): Map<string, TrackerAccount['target']> {
  const targets = new Map<string, TrackerAccount['target']>();
  if (!data || !Array.isArray(data.targets)) return targets;
  for (const row of data.targets) {
    const id = text(row?.tracker_id, 64);
    const met = count(row?.met);
    const total = count(row?.total);
    const remaining = count(row?.remaining);
    if (id && met !== undefined && total && remaining !== undefined) {
      targets.set(id, { met, total, remaining });
    }
  }
  return targets;
}

/** Joins Yata trackers to Prowlarr indexers by site hostname. */
export function joinAccounts(
  connection: string,
  trackers: YataTracker[],
  targets: Map<string, TrackerAccount['target']>,
  indexers: Pick<Indexer, 'id' | 'origin'>[],
): Pick<AccountsResponse, 'accounts' | 'unmatched'> {
  const indexersByHost = new Map<string, number[]>();
  for (const indexer of indexers) {
    const host = indexer.origin ? trackerHost(indexer.origin) : null;
    if (host) indexersByHost.set(host, [...(indexersByHost.get(host) ?? []), indexer.id]);
  }

  const accounts: TrackerAccount[] = [];
  const unmatched: AccountsResponse['unmatched'] = [];
  for (const { id, host, ...tracker } of trackers) {
    const indexerIds = indexersByHost.get(host);
    if (!indexerIds) {
      unmatched.push({ connection, name: tracker.name });
      continue;
    }
    for (const indexerId of indexerIds) {
      accounts.push({ ...tracker, indexerId, connection, target: targets.get(id) });
    }
  }
  return { accounts, unmatched };
}

/** Reads account standing from Yata's read-only token API. */
export class YataAccounts {
  private cache = new ExpiringCache<string, YataTracker[] | Map<string, TrackerAccount['target']>>(
    32,
  );
  private loads = new InFlight<string, unknown>();
  private revision = 0;

  constructor(private request: YataRequest) {}

  clear(): void {
    this.revision++;
    this.cache.clear();
  }

  close(): Promise<void> {
    return this.loads.settled();
  }

  async accounts(
    connections: YataConnection[],
    indexers: Pick<Indexer, 'id' | 'origin'>[],
  ): Promise<AccountsResponse> {
    const response: AccountsResponse = { accounts: [], unmatched: [], failed: [] };
    const claimed = new Set<number>();
    const loaded = await Promise.all(
      connections.map(async (connection) => {
        try {
          const [trackers, targets] = await Promise.all([
            this.summary(connection),
            this.targets(connection),
          ]);
          return { connection, trackers, targets };
        } catch {
          response.failed.push(connection.name);
          return null;
        }
      }),
    );

    // The first connection that knows a tracker wins, in the order connections are listed.
    for (const entry of loaded) {
      if (!entry) continue;
      const joined = joinAccounts(entry.connection.name, entry.trackers, entry.targets, indexers);
      for (const account of joined.accounts) {
        if (claimed.has(account.indexerId)) continue;
        claimed.add(account.indexerId);
        response.accounts.push(account);
      }
      response.unmatched.push(...joined.unmatched);
    }
    return response;
  }

  private summary(connection: YataConnection): Promise<YataTracker[]> {
    return this.cached(['summary', connection], async () =>
      parseYataSummary(await this.request(connection, '/api/summary')),
    );
  }

  /** Older Yata builds have no highlights endpoint, so they report no targets. */
  private targets(connection: YataConnection): Promise<Map<string, TrackerAccount['target']>> {
    return this.cached(['targets', connection], async () => {
      try {
        return parseYataTargets(await this.request(connection, '/api/highlights?limit=25'));
      } catch {
        return new Map();
      }
    });
  }

  private async cached<T extends YataTracker[] | Map<string, TrackerAccount['target']>>(
    [kind, connection]: [string, YataConnection],
    load: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([kind, connection.id, connection.baseUrl, connection.apiKey]);
    const saved = this.cache.get(key);
    if (saved !== undefined) return saved as T;

    const startRevision = this.revision;
    return this.loads.run(key, async () => {
      const value = await load();
      if (startRevision === this.revision) this.cache.set(key, value, SUMMARY_TTL_MS);
      return value;
    }) as Promise<T>;
  }
}
