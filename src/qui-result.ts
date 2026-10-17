export function quiResultKey(row: { indexerId: number; guid: string }) {
  return JSON.stringify([row.indexerId, row.guid]);
}

export function preferredQuiMatches<T extends { evidence?: string }>(matches: T[]): T[] {
  const entries = matches.filter((match) => match.evidence === 'entry');
  return entries.length ? entries : matches;
}

export function hasQuiMatch(matches: { evidence?: string }[] | undefined, trackerOnly = false) {
  return !!matches?.some((match) => !trackerOnly || match.evidence === 'entry');
}
