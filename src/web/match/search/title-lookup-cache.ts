type LookupRow = { title: string; originalTitle?: string; aliases?: string[] };

const FRESH_MS = 15 * 60_000;
const MAX_ENTRIES = 100;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function rowMatches(row: LookupRow, normalizedTerm: string): boolean {
  return [row.title, row.originalTitle, ...(row.aliases ?? [])].some(
    (name) => name !== undefined && normalize(name).includes(normalizedTerm),
  );
}

/**
 * Title suggestions already fetched in this browser session. Exact repeats are served from
 * here, and while a new lookup is pending the best earlier result is narrowed to the new text.
 */
export class TitleLookupCache<Row extends LookupRow> {
  private entries = new Map<string, { at: number; term: string; scope: string; rows: Row[] }>();

  private key(term: string, scope: string): string {
    return JSON.stringify([normalize(term), scope]);
  }

  get(term: string, scope: string): Row[] | undefined {
    const entry = this.entries.get(this.key(term, scope));
    return entry && Date.now() - entry.at < FRESH_MS ? entry.rows : undefined;
  }

  set(term: string, scope: string, rows: Row[]): void {
    const key = this.key(term, scope);
    this.entries.delete(key);
    if (this.entries.size >= MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { at: Date.now(), term: normalize(term), scope, rows });
  }

  /** Rows from the longest cached earlier prefix of `term` that still match it, if any. */
  preview(term: string, scope: string): Row[] | undefined {
    const normalizedTerm = normalize(term);
    let best: { term: string; rows: Row[] } | undefined;
    for (const entry of this.entries.values()) {
      if (entry.scope !== scope || Date.now() - entry.at >= FRESH_MS) continue;
      if (!normalizedTerm.startsWith(entry.term) || entry.term === normalizedTerm) continue;
      if (!best || entry.term.length > best.term.length) best = entry;
    }
    return best?.rows.filter((row) => rowMatches(row, normalizedTerm));
  }
}
