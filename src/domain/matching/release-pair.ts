/**
 * Pair rules for two parsed releases — derived from detect-core v5 src/release-pair.ts (detect-core:7a89b3e).
 */
import {
  extractBracketReleaseGroup,
  normalizeGroup,
  prepareNameForGroupExtraction,
  toRomanNumeral,
} from '../../parser/parse-release-name.js';

type Hdr = { hdrDv: string | null };

/**
 * A name that says only `HDR` is HDR10. Under Dolby Vision the parser already
 * folds `HDR` and `HDR10` into `DV.HDR`, and `DV.HDR10+` joins them: trackers
 * drop the + there (one writes `DV HDR10+` where another writes the same bytes
 * as `DV.HDR`), so a missing + under DV is not evidence of a different file.
 */
function hdrMatchClass(hdrDv: string | null): string | null {
  if (hdrDv === 'HDR') return 'HDR10';
  if (hdrDv === 'DV.HDR10+') return 'DV.HDR';
  return hdrDv;
}

/** HDR labels agree. Plain HDR10+, HLG and Dolby Vision on one side only never pair with anything else. */
export function hdrCompatible(left: Hdr, right: Hdr): boolean {
  return hdrMatchClass(left.hdrDv) === hdrMatchClass(right.hdrDv);
}

export type GroupFields = {
  rawName: string;
  group: string | null;
  normalizedGroup: string | null;
  collective: string | null;
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * `x265-Hoshi-Subs` parses as group `Subs`, but may be the hyphenated group
 * `Hoshi-Subs`. Returns that longer reading: one more hyphen part, directly
 * after a release tag (`x265`), so `x265-Big-Hoshi-Subs` has none.
 */
function hyphenatedSuffixGroup(release: GroupFields): string | null {
  if (!release.group) return null;
  const name = prepareNameForGroupExtraction(release.rawName);
  const match = name.match(
    new RegExp(
      `(?:^|[.\\s_])[^.\\s_-]+-([A-Za-z0-9][A-Za-z0-9&_]*-${escapeRegExp(release.group)})\\s*$`,
      'i',
    ),
  );
  return match?.[1] ?? null;
}

/** The group, when it came from a leading `[Group]` tag and has a hyphen in it. */
function leadingHyphenatedBracketGroup(release: GroupFields): string | null {
  if (!release.group?.includes('-')) return null;
  return extractBracketReleaseGroup(release.rawName) === release.group ? release.group : null;
}

/** `(… - Wren) [Lattice]` read as one space-joined group, as other trackers write it: `wren lattice`. */
function collectiveJoinedGroup(release: GroupFields): string | null {
  return release.group && release.collective
    ? normalizeGroup(`${release.group} ${release.collective}`)
    : null;
}

/**
 * Groups this release can pair under, for lookup buckets: its own, the
 * hyphenated reading of a `-Hoshi-Subs` suffix, and group + collective joined
 * with a space (`wren lattice`). `releaseGroupsMatch` decides.
 */
export function groupAliases(release: GroupFields): string[] {
  const aliases = new Set<string>();
  if (release.normalizedGroup) aliases.add(release.normalizedGroup);
  const hyphenated = hyphenatedSuffixGroup(release);
  if (hyphenated) aliases.add(normalizeGroup(hyphenated));
  const joined = collectiveJoinedGroup(release);
  if (joined) aliases.add(joined);
  return [...aliases];
}

/**
 * Same release group. Equal groups match unless both name a collective and the
 * collectives differ. Beyond that, decided per pair:
 * - a leading `[Hoshi-Subs]` matches a name ending in exactly `-Hoshi-Subs`,
 *   because `x265-Hoshi-Subs` on its own could be group `Subs`;
 * - `(… - Wren) [Lattice]` matches `(… - Wren Lattice)`. A multi-word group is
 *   never split, so `Wren Lattice` does not match a bare `Wren`.
 */
export function releaseGroupsMatch(left: GroupFields, right: GroupFields): boolean {
  if (left.normalizedGroup && left.normalizedGroup === right.normalizedGroup) {
    return (
      !left.collective ||
      !right.collective ||
      normalizeGroup(left.collective) === normalizeGroup(right.collective)
    );
  }
  const leftJoined = collectiveJoinedGroup(left);
  const rightJoined = collectiveJoinedGroup(right);
  if (leftJoined && leftJoined === right.normalizedGroup && !right.collective) return true;
  if (rightJoined && rightJoined === left.normalizedGroup && !left.collective) return true;
  for (const [bracketSide, suffixSide] of [
    [left, right],
    [right, left],
  ] as const) {
    const bracket = leadingHyphenatedBracketGroup(bracketSide);
    const suffix = bracket ? hyphenatedSuffixGroup(suffixSide) : null;
    if (bracket && suffix && normalizeGroup(bracket) === normalizeGroup(suffix)) return true;
  }
  return false;
}

export type TitleReading = { titleSlug: string; season: number | null };

type TitleFields = {
  titleSlug: string | null;
  season: number | null;
  episode: number | null;
  isPack: boolean;
  seasonNumeral: number | null;
};

/**
 * The ways a release's title and season can be read for matching, as written first:
 * - a pack that states no season (an anime batch) is also that show's season 1;
 * - a title ending in a season numeral (`seasonNumeral`) is also the title
 *   without the numeral, in that season.
 * Lookup keys are built for every reading; two releases share a title when
 * any readings agree.
 */
export function titleReadings(release: TitleFields): TitleReading[] {
  const slug = release.titleSlug;
  if (!slug) return [];
  const readings: TitleReading[] = [{ titleSlug: slug, season: release.season }];
  if (release.isPack && release.season == null && release.episode == null) {
    readings.push({ titleSlug: slug, season: 1 });
  }
  if (release.seasonNumeral != null) {
    const numeral = toRomanNumeral(release.seasonNumeral).toLowerCase();
    if (slug.endsWith(numeral) && slug.length > numeral.length) {
      readings.push({ titleSlug: slug.slice(0, -numeral.length), season: release.seasonNumeral });
    }
  }
  return readings.filter(
    (reading, index) =>
      readings.findIndex(
        (other) => other.titleSlug === reading.titleSlug && other.season === reading.season,
      ) === index,
  );
}
