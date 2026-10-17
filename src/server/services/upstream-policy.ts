import { XSEEK_USER_AGENT } from '../../version.js';

export function retryAfterAt(value: string | null, now = Date.now(), fallbackMs = 60_000): number {
  const seconds = value?.trim() ? Number(value) : NaN;
  const targetTimestamp =
    Number.isFinite(seconds) && seconds >= 0 ? now + seconds * 1000 : Date.parse(value || '');
  return Math.max(
    now + 1000,
    Number.isFinite(targetTimestamp) ? targetTimestamp : now + fallbackMs,
  );
}

export class UpstreamPaused extends Error {
  constructor(readonly until: number) {
    super('Service requested a pause. Retry later.');
  }
}

/** Per-origin pauses requested by upstream 429 responses. */
export class OriginPauses {
  private pausedUntil = new Map<string, number>();

  until(origin: string): number {
    return this.pausedUntil.get(origin) ?? 0;
  }

  isPaused(origin: string): boolean {
    return Date.now() < this.until(origin);
  }

  pause(origin: string, retryAfterHeader: string | null): void {
    if (!this.pausedUntil.has(origin) && this.pausedUntil.size >= 128) {
      this.pausedUntil.delete(this.pausedUntil.keys().next().value!);
    }
    this.pausedUntil.set(origin, retryAfterAt(retryAfterHeader));
  }
}

/** Shared by Prowlarr probes, indexer discovery, favicons and searches in this process. */
export class UpstreamPolicy {
  private pauses = new OriginPauses();

  async fetch(url: string | URL, options: RequestInit = {}): Promise<Response> {
    const origin = new URL(url).origin;
    if (this.pauses.isPaused(origin)) {
      throw new UpstreamPaused(this.pauses.until(origin));
    }

    const headers = new Headers(options.headers);
    headers.set('User-Agent', XSEEK_USER_AGENT);
    const response = await fetch(url, { ...options, headers, redirect: 'error' });
    if (response.status === 429) {
      this.pauses.pause(origin, response.headers.get('retry-after'));
    }
    return response;
  }
}

export async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }

  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error('Response too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

export async function readJson(response: Response, maxBytes = 16_777_216): Promise<unknown> {
  const bytes = await readBounded(response, maxBytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}
