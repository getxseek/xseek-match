/** Size-bounded cache whose entries expire; the oldest entry is evicted when full. */
export class ExpiringCache<K, V> {
  private entries = new Map<K, { expiresAt: number; value: V }>();

  constructor(private readonly limit: number) {}

  /** Returns the value only while it is still fresh. */
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() < entry.expiresAt ? entry.value : undefined;
  }

  /** Returns the value even after it has expired, for stale-on-error fallbacks. */
  peek(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (!this.entries.has(key) && this.entries.size >= this.limit) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { expiresAt: Date.now() + ttlMs, value });
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Concurrent callers asking for the same key share one pending load. */
export class InFlight<K, V> {
  private pending = new Map<K, Promise<V>>();

  get size(): number {
    return this.pending.size;
  }

  get(key: K): Promise<V> | undefined {
    return this.pending.get(key);
  }

  has(key: K): boolean {
    return this.pending.has(key);
  }

  run(key: K, load: () => Promise<V>): Promise<V> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const started = load().finally(() => this.pending.delete(key));
    this.pending.set(key, started);
    return started;
  }

  /** Resolves once every load in progress has settled; used during shutdown. */
  async settled(): Promise<void> {
    await Promise.allSettled(this.pending.values());
  }
}
