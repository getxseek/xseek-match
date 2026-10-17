import { XSEEK_USER_AGENT } from '../../version.js';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson } from '../storage/cache-files.js';
import { readJson, retryAfterAt } from './upstream-policy.js';

export const trackerSource =
  'https://raw.githubusercontent.com/fHori/Private-Trackers-Spreadsheet/refs/heads/master/trackers.json';

const REFRESH_INTERVAL_MS = 86_400_000;
const RETRY_DELAY_MS = 3_600_000;

export function parseDefinitions(input: unknown): Record<string, string>[] {
  const rows = (input as { trackers?: unknown })?.trackers;
  if (!Array.isArray(rows) || !rows.length || rows.length > 10_000) {
    throw new Error('Invalid tracker definitions');
  }

  return rows.map((row) => {
    if (!row || typeof row.Name !== 'string' || !row.Name.trim() || row.Name.length > 150) {
      throw new Error('Invalid tracker definition');
    }
    return Object.fromEntries(
      Object.entries(row).filter(
        ([key, value]) => key.length < 100 && typeof value === 'string' && value.length <= 2000,
      ),
    ) as Record<string, string>;
  });
}

export class TrackerDefinitions {
  private data: { at: number; trackers: Record<string, string>[] } = { at: 0, trackers: [] };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | undefined;
  private closed = false;
  private nextAt = 0;
  private error: string | null = null;
  private pausedUntil = 0;
  readonly ready: Promise<void>;

  constructor(
    private dir: string,
    private fetcher: typeof fetch = fetch,
  ) {
    this.ready = this.load();
    void this.ready.then(() => {
      if (this.closed) return;
      if (Date.now() - this.data.at >= REFRESH_INTERVAL_MS) {
        void this.refresh();
      } else {
        this.schedule(this.data.at + REFRESH_INTERVAL_MS);
      }
    });
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(join(this.dir, 'tracker-definitions.json'), 'utf8');
      const stored = JSON.parse(raw);
      const trackers = parseDefinitions(stored);
      if (Number.isFinite(stored.at) && stored.at > 0) {
        this.data = { at: stored.at, trackers };
      }
    } catch {}
  }

  private schedule(at: number): void {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.nextAt = at;
    this.timer = setTimeout(() => void this.refresh(), Math.max(1, at - Date.now()));
    this.timer.unref();
  }

  snapshot() {
    return {
      ...this.data,
      source: trackerSource,
      nextAt: this.nextAt,
      running: Boolean(this.flight),
      error: this.error,
    };
  }

  refresh(): Promise<void> {
    if (this.flight) return this.flight;
    if (this.closed || Date.now() < this.pausedUntil) return Promise.resolve();

    this.flight = (async () => {
      await this.ready;
      let retryAt = Date.now() + RETRY_DELAY_MS;

      try {
        const response = await this.fetcher(trackerSource, {
          headers: { 'User-Agent': XSEEK_USER_AGENT },
          signal: AbortSignal.timeout(15_000),
          redirect: 'error',
        });

        if (response.status === 429) {
          this.pausedUntil = retryAfterAt(response.headers.get('retry-after'));
          retryAt = Math.max(retryAt, this.pausedUntil);
        }
        if (!response.ok) throw new Error('Upstream tracker definitions error');

        const trackers = parseDefinitions(await readJson(response, 4_000_000));
        const data = { at: Date.now(), trackers };

        await mkdir(this.dir, { recursive: true });
        await atomicJson(join(this.dir, 'tracker-definitions.json'), data);

        this.data = data;
        this.error = null;
        this.schedule(data.at + REFRESH_INTERVAL_MS);
      } catch {
        this.error = 'Refresh failed; keeping the last saved definitions.';
        this.schedule(retryAt);
      }
    })().finally(() => {
      this.flight = undefined;
    });

    return this.flight;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.flight;
  }
}
