/** Normalize BitTorrent v1 SHA-1 and v2 SHA-256 hashes. */
export function normalizeInfoHash(value: unknown): string | undefined {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}
