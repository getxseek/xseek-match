import { SEARCH_TTL_MINUTES_DEFAULT, SEARCH_TTL_MINUTES_MIN } from '../../contracts/preferences.js';
import type { IPreferencesStore } from '../storage/preferences-store.js';
import type { SearchCacheStore } from '../storage/search-cache-store.js';
import type { ActivityLog } from './activity-log.js';

const TTL_PREFERENCE = 'xseek-match-cache-ttl';

/** The live search-cache TTL, its usage counters and serialized background pruning. */
export class SearchCacheState {
  ttlMinutes = SEARCH_TTL_MINUTES_DEFAULT;
  private hits = 0;
  private lastSearchAt: number | null = null;
  private maintenance = Promise.resolve();

  constructor(
    private readonly cacheStore: SearchCacheStore,
    private readonly preferences: IPreferencesStore,
    private readonly logger: ActivityLog,
  ) {}

  /**
   * Adopts the TTL saved in preferences, falling back to the one kept beside the cache
   * files; a fallback value is copied into preferences so later starts find it there.
   */
  async restoreTtl(): Promise<void> {
    try {
      const storedTtl = this.preferences.snapshot().values[TTL_PREFERENCE];
      const ttl = storedTtl ? JSON.parse(storedTtl) : await this.cacheStore.readSettingsTtl();
      if (!Number.isInteger(ttl) || ttl < SEARCH_TTL_MINUTES_MIN) return;

      this.ttlMinutes = ttl;
      if (!storedTtl) this.preferences.save({ [TTL_PREFERENCE]: JSON.stringify(ttl) });
    } catch {}
  }

  setTtl(minutes: number): void {
    this.ttlMinutes = minutes;
  }

  recordSearch(): void {
    this.hits++;
    this.lastSearchAt = Date.now();
  }

  stats(): { hits: number; lastSearchAt: number | null; ttlMinutes: number } {
    return { hits: this.hits, lastSearchAt: this.lastSearchAt, ttlMinutes: this.ttlMinutes };
  }

  /** Queues a prune behind any running one so cache files are never pruned concurrently. */
  schedulePrune(): Promise<void> {
    this.maintenance = this.maintenance
      .then(() => this.cacheStore.prune(this.ttlMinutes * 60_000))
      .catch(() => this.logger.log('error', 'Cache maintenance failed'));
    return this.maintenance;
  }

  settled(): Promise<void> {
    return this.maintenance;
  }
}
