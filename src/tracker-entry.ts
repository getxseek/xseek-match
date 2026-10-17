export function trackerEntry(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return null;
    }

    let torrentId = url.pathname.match(/^\/(?:torrents?|torrents\/view)\/(\d+)(?:\/|$)/i)?.[1];
    if (!torrentId && /^\/(?:details|torrents)\.php$/i.test(url.pathname)) {
      torrentId = url.searchParams.get('id') || undefined;
    }

    if (!torrentId || !/^\d{1,15}$/.test(torrentId) || Number(torrentId) <= 0) {
      return null;
    }

    const normalizedHost = url.host
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');

    return `${normalizedHost}:${String(Number(torrentId))}`;
  } catch {
    return null;
  }
}

export function commentEntries(value: unknown): Set<string> {
  const entries = new Set<string>();
  if (typeof value !== 'string') return entries;

  for (const match of value.slice(0, 16_384).matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const cleanedUrl = match[0].replace(/[)\]}.!,;]+$/, '');
    const entry = trackerEntry(cleanedUrl);
    if (entry) entries.add(entry);
  }
  return entries;
}
