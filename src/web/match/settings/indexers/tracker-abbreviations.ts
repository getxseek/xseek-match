const API_LABEL_SUFFIX = /\s*\(API\)/gi;
const DOMAIN_SUFFIX = /\.[a-z]{2,6}$/i;

function normalizeTrackerName(name: string): string {
  return name
    .replace(API_LABEL_SUFFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const abbreviations = new Map<string, string>();

/** Some Prowlarr labels carry the site's domain (`Name.io`); fall back to the bare name. */
export function trackerAbbreviation(name: string): string | null {
  const exact = abbreviations.get(normalizeTrackerName(name));
  if (exact) return exact;
  const label = name.replace(API_LABEL_SUFFIX, '').trim();
  const withoutDomain = label.replace(DOMAIN_SUFFIX, '');
  if (withoutDomain === label) return null;
  return abbreviations.get(normalizeTrackerName(withoutDomain)) ?? null;
}

export function updateTrackerDefinitions(trackers: Array<Record<string, string>>) {
  const next = new Map<string, string>();
  for (const row of trackers) {
    if (
      typeof row.Name !== 'string' ||
      typeof row.Abbreviation !== 'string' ||
      !row.Abbreviation.trim() ||
      row.Abbreviation === '-'
    )
      continue;
    next.set(normalizeTrackerName(row.Name), row.Abbreviation);
  }
  abbreviations.clear();
  for (const [name, abbreviation] of next) abbreviations.set(name, abbreviation);
}

export function clearTrackerDefinitions(): void {
  abbreviations.clear();
}
