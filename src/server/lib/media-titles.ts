const ALLOWED_POSTER_HOSTS = new Set([
  'image.tmdb.org',
  'artworks.thetvdb.com',
  'banners.thetvdb.com',
  'www.thetvdb.com',
]);

function normalizeTitleForRanking(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function rankTitles<
  T extends { title: string; year: number | null; originalTitle?: string; aliases?: string[] },
>(rows: T[], term: string): Array<T & { directMatch: boolean; matchedAlias?: string }> {
  const query = normalizeTitleForRanking(term);
  const queryTokens = query.split(' ').filter(Boolean);

  const scoreTitleString = (value: string): number => {
    const normalizedTitle = normalizeTitleForRanking(value);
    if (normalizedTitle === query) return 0;
    if (normalizedTitle.startsWith(query)) return 1;
    if (normalizedTitle.includes(query)) return 2;

    const titleWords = normalizedTitle.split(' ');
    const matchesAllTokenPrefixes = queryTokens.every((token) =>
      titleWords.some((word) => word.startsWith(token)),
    );
    return matchesAllTokenPrefixes ? 3 : Infinity;
  };

  const scoreRow = (row: T): number =>
    Math.min(
      scoreTitleString(row.title),
      row.originalTitle ? scoreTitleString(row.originalTitle) + 0.1 : Infinity,
      ...(row.aliases || []).map((alias) => scoreTitleString(alias) + 0.1),
    ) + (row.year ? 0 : 0.25);

  return rows
    .map((row) => {
      const matchedAlias = row.aliases?.find((alias) => Number.isFinite(scoreTitleString(alias)));
      return {
        ...row,
        directMatch: Number.isFinite(scoreRow(row)),
        ...(matchedAlias ? { matchedAlias } : {}),
      };
    })
    .sort((left, right) => {
      const leftScore = scoreRow(left);
      const rightScore = scoreRow(right);
      return leftScore === rightScore ? 0 : leftScore - rightScore;
    });
}

export function posterUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const isAllowed =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      ALLOWED_POSTER_HOSTS.has(url.hostname);
    return isAllowed ? url.href : undefined;
  } catch {
    return undefined;
  }
}
