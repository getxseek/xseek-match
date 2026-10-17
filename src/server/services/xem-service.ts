import { XSEEK_USER_AGENT } from '../../version.js';
import { InFlight } from '../lib/caching.js';
import { XemStore, type XemMapping } from '../storage/xem-store.js';
import { readJson, retryAfterAt } from './upstream-policy.js';

export type { XemMapping };

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
}

export function parseXem(data: any): XemMapping[] {
  if (
    data?.result === 'failure' &&
    /no single connection|no show with|no mapping/i.test(String(data.message))
  ) {
    return [];
  }
  if (data?.result !== 'success' || !Array.isArray(data.data) || data.data.length > 20_000) {
    throw new Error('Invalid mapping response');
  }

  return data.data
    .filter(
      (row: any) =>
        row?.scene &&
        row?.tvdb &&
        isIntegerInRange(row.scene.season, 0, 999) &&
        isIntegerInRange(row.tvdb.season, 0, 999) &&
        isIntegerInRange(row.scene.episode, 1, 99_999) &&
        isIntegerInRange(row.tvdb.episode, 1, 99_999),
    )
    .map((row: any) => ({
      tvdbSeason: row.tvdb.season,
      tvdbEpisode: row.tvdb.episode,
      sceneSeason: row.scene.season,
      sceneEpisode: row.scene.episode,
    }));
}

export class Xem {
  private store: XemStore;
  private loads = new InFlight<number, { mappings: XemMapping[]; stale: boolean }>();
  private pausedUntil = 0;

  constructor(
    path: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.store = new XemStore(path);
  }

  async get(id: number) {
    if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647) {
      throw new Error('Invalid TVDB ID');
    }

    const cached = this.store.get(id);
    if (cached && cached.expires > Date.now()) {
      return { mappings: cached.mappings, stale: false };
    }

    const active = this.loads.get(id);
    if (active) return active;

    const fallbackMappings = () => (cached ? cached.mappings : []);

    if (Date.now() < this.pausedUntil || this.loads.size >= 4) {
      return { mappings: fallbackMappings(), stale: true };
    }

    return this.loads.run(id, async () => {
      try {
        const response = await this.fetcher(`https://thexem.info/map/all?origin=tvdb&id=${id}`, {
          headers: { 'User-Agent': XSEEK_USER_AGENT },
          signal: AbortSignal.timeout(12_000),
          redirect: 'error',
        });

        if (response.status === 429) {
          this.pausedUntil = Math.max(
            Date.now() + 60_000,
            retryAfterAt(response.headers.get('retry-after')),
          );
        }
        if (!response.ok) throw new Error('XEM HTTP error');

        const mappings = parseXem(await readJson(response, 4_000_000));
        const ttlDays = mappings.length ? 7 : 1;

        this.store.set(id, mappings, ttlDays * 86_400_000);

        return { mappings, stale: false };
      } catch {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + 60_000);
        return { mappings: fallbackMappings(), stale: true };
      }
    });
  }

  async close() {
    await this.loads.settled();
    this.store.close();
  }
}
