import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { atomicJson } from '../storage/cache-files.js';
import { pinnedRequest } from './pinned-http.js';
import { retryAfterAt } from './upstream-policy.js';

const MAX_FAVICON_BYTES = 262_144;
const FAVICON_TIMEOUT_MS = 5_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ALLOWED_FAVICON_TYPES = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

type CachedFavicon = {
  at: number;
  type: string;
  body: string;
};

function hasValidImageMagicBytes(contentType: string, bytes: Buffer): boolean {
  if (contentType === 'image/png') {
    return bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  }
  if (contentType === 'image/x-icon' || contentType === 'image/vnd.microsoft.icon') {
    return (
      bytes.length >= 6 &&
      bytes.readUInt16LE(0) === 0 &&
      bytes.readUInt16LE(2) === 1 &&
      bytes.readUInt16LE(4) > 0
    );
  }
  if (contentType === 'image/jpeg') {
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  }
  if (contentType === 'image/webp') {
    return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  }
  return ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6));
}

export async function serveIndexerFavicon(options: {
  id: number;
  origin: string | null | undefined;
  cacheDir: string;
  ttlMs: number;
  iconRetryAfter: Map<number, number>;
  res: ServerResponse;
}): Promise<void> {
  const { id, origin, cacheDir, ttlMs, iconRetryAfter, res } = options;

  try {
    if (!origin) throw new Error('Missing tracker origin');

    const cachePath = `${cacheDir}/icon-${id}.json`;
    let cachedIcon: CachedFavicon | null = null;
    try {
      cachedIcon = JSON.parse(await readFile(cachePath, 'utf8')) as CachedFavicon;
    } catch {}

    const isStale = !cachedIcon || Date.now() - cachedIcon.at >= ttlMs;
    const canRetryNow = Date.now() >= (iconRetryAfter.get(id) ?? 0);

    if (isStale && canRetryNow) {
      try {
        // Indexer origins come from Prowlarr, so resolve them through the address-checked path.
        const response = await pinnedRequest(new URL('/favicon.ico', origin), {
          maxBytes: MAX_FAVICON_BYTES,
          timeoutMs: FAVICON_TIMEOUT_MS,
        });

        if (response.statusCode === 429) {
          iconRetryAfter.set(
            id,
            retryAfterAt(String(response.headers['retry-after'] ?? '') || null),
          );
        }
        if (response.statusCode !== 200) throw new Error('Favicon fetch failed');

        const contentType = String(response.headers['content-type'] ?? '').split(';')[0]!;
        if (!ALLOWED_FAVICON_TYPES.has(contentType)) {
          throw new Error('Unsupported favicon content-type');
        }

        const bytes = response.body;
        if (!bytes.length || bytes.length > MAX_FAVICON_BYTES) {
          throw new Error('Favicon payload out of bounds');
        }
        if (!hasValidImageMagicBytes(contentType, bytes)) {
          throw new Error('Favicon magic-byte mismatch');
        }

        // Persist only valid image payloads so a transient failure never overwrites a working icon.
        const freshIcon: CachedFavicon = {
          at: Date.now(),
          type: contentType,
          body: bytes.toString('base64'),
        };
        cachedIcon = freshIcon;
        iconRetryAfter.delete(id);

        try {
          await atomicJson(cachePath, freshIcon);
        } catch {}
      } catch {
        iconRetryAfter.set(id, Math.max(Date.now() + ttlMs, iconRetryAfter.get(id) || 0));
      }
    }

    if (!cachedIcon?.type || !cachedIcon.body) {
      throw new Error('No favicon available');
    }

    res.setHeader('Content-Type', cachedIcon.type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(Buffer.from(cachedIcon.body, 'base64'));
  } catch {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.end();
  }
}
