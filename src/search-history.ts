import type { Numbering } from './contracts/search.js';

export type SearchMode = 'text' | 'enriched' | 'deep';

type HistorySelection = {
  resolvedBy?: 'qui';
  numbering?: Numbering;
  key: string;
  title: string;
  kind: 'sonarr' | 'radarr';
  id: number;
  imdb?: string;
  year: number | null;
  seasons: number[];
};

export type SearchHistoryEntry = {
  query: string;
  at: number;
  mode?: SearchMode;
  selection?: HistorySelection;
};

type SearchJourney = {
  key: string;
  title: string;
  entries: SearchHistoryEntry[];
};

export function historyKey(entry: SearchHistoryEntry): string {
  return JSON.stringify([
    entry.query.toLowerCase(),
    entry.mode || 'text',
    entry.selection?.kind,
    entry.selection?.id,
    entry.selection?.numbering || 'tvdb',
  ]);
}

function isValidSelectionSeasonList(seasons: unknown): seasons is number[] {
  return (
    Array.isArray(seasons) &&
    seasons.length <= 100 &&
    seasons.every(
      (season) => Number.isInteger(season) && Number(season) >= 0 && Number(season) <= 999,
    )
  );
}

export function validHistoryEntry(item: any): item is SearchHistoryEntry {
  if (
    !item ||
    typeof item.query !== 'string' ||
    item.query.length > 200 ||
    !Number.isFinite(item.at)
  ) {
    return false;
  }

  if (item.mode !== undefined && !['text', 'enriched', 'deep'].includes(item.mode)) {
    return false;
  }

  const selection = item.selection;
  if (selection === undefined) {
    return item.mode !== 'enriched';
  }

  return (
    (item.mode === 'enriched' || item.mode === 'deep') &&
    Boolean(selection) &&
    (selection.resolvedBy === undefined || selection.resolvedBy === 'qui') &&
    (selection.numbering === undefined ||
      selection.numbering === 'tvdb' ||
      selection.numbering === 'release') &&
    typeof selection.key === 'string' &&
    selection.key.length <= 80 &&
    typeof selection.title === 'string' &&
    selection.title.length <= 200 &&
    ['sonarr', 'radarr'].includes(selection.kind) &&
    Number.isSafeInteger(selection.id) &&
    selection.id > 0 &&
    selection.id <= 2_147_483_647 &&
    (selection.imdb === undefined ||
      (typeof selection.imdb === 'string' && /^tt\d{1,12}$/.test(selection.imdb))) &&
    (selection.year === null || Number.isInteger(selection.year)) &&
    isValidSelectionSeasonList(selection.seasons)
  );
}

function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function containsWholePhraseMatch(candidateNormalized: string, queryNormalized: string): boolean {
  return (
    queryNormalized.length >= 8 &&
    queryNormalized.split(' ').length >= 2 &&
    ` ${candidateNormalized} `.includes(` ${queryNormalized} `)
  );
}

export function splitTvSearch(query: string): { title: string; suffix: string } {
  const match = query.trim().match(/^(.*?)\s+(S\d{1,3}(?:E\d{1,3})?|E\d{1,3})$/i);
  return {
    title: match ? match[1]!.trim() : query.trim(),
    suffix: match ? match[2]!.toUpperCase() : '',
  };
}

export function searchJourneys(history: SearchHistoryEntry[]): SearchJourney[] {
  const groups = new Map<string, SearchJourney>();

  for (const entry of history) {
    if (!entry.selection) continue;
    const key = `${entry.selection.kind}:${entry.selection.id}`;
    if (!groups.has(key)) {
      groups.set(key, { key, title: entry.selection.title, entries: [] });
    }
  }

  const knownTitles = [...groups.values()];

  for (const entry of history) {
    let key: string;
    if (entry.selection) {
      key = `${entry.selection.kind}:${entry.selection.id}`;
    } else {
      const normalizedQueryTitle = normalizeTitle(splitTvSearch(entry.query).title);
      const matchingGroups = knownTitles.filter((group) => {
        const normalizedGroupTitle = normalizeTitle(group.title);
        return (
          normalizedGroupTitle === normalizedQueryTitle ||
          containsWholePhraseMatch(normalizedGroupTitle, normalizedQueryTitle)
        );
      });
      key = matchingGroups.length === 1 ? matchingGroups[0]!.key : `text:${normalizedQueryTitle}`;
    }

    if (!groups.has(key)) {
      groups.set(key, { key, title: splitTvSearch(entry.query).title, entries: [] });
    }
    groups.get(key)!.entries.push(entry);
  }

  for (const group of groups.values()) {
    group.entries.sort((left, right) => right.at - left.at);
  }

  return [...groups.values()]
    .filter((group) => group.entries.length > 0)
    .sort((left, right) => right.entries[0]!.at - left.entries[0]!.at);
}

export function inferTvTitle<
  T extends { kind: string; id: number; title: string; aliases?: string[]; originalTitle?: string },
>(matches: T[], query: string): T | null {
  const parsed = splitTvSearch(query);
  const normalizedTerm = normalizeTitle(parsed.title);
  if (normalizedTerm.length < 3) return null;

  const candidateNames = (row: T): string[] =>
    [row.title, row.originalTitle, ...(row.aliases || [])]
      .filter((name): name is string => Boolean(name))
      .map(normalizeTitle);

  const tvMatches = matches.filter((row) => row.kind === 'sonarr');
  const exactMatches = tvMatches.filter((row) => candidateNames(row).includes(normalizedTerm));

  const matchingRows = exactMatches.length
    ? exactMatches
    : tvMatches.filter((row) =>
        candidateNames(row).some((name) => containsWholePhraseMatch(name, normalizedTerm)),
      );

  const uniqueById = new Map(matchingRows.map((row) => [row.id, row]));
  return uniqueById.size === 1 ? [...uniqueById.values()][0]! : null;
}

export function recentHistoryKey(entry: SearchHistoryEntry): string {
  return JSON.stringify([historyKey(entry), entry.at]);
}

export function visibleRecentHistory(
  history: SearchHistoryEntry[],
  hidden: readonly string[],
): SearchHistoryEntry[] {
  const hiddenKeys = new Set(hidden);
  return history.filter((entry) => !hiddenKeys.has(recentHistoryKey(entry)));
}
