/**
 * Cross-tracker release grouping and variant compatibility — derived from
 * xseek release-fingerprint (xseek:78f9e8b) and detect-core v4 product-slice (detect-core:9bd5477).
 */
import { parseReleaseName } from '../../parser/parse-release-name.js';
import { releaseLookupKey } from './release-key.js';
import { normalizeInfoHash } from './info-hash.js';
import type { Result } from '../../contracts/search.js';

export type { Result } from '../../contracts/search.js';

type Parsed = ReturnType<typeof parseReleaseName>;
type Evidence = 'hash' | 'release' | 'release_size_off';
type Candidate = { row: Result; parsed: Parsed; key: string | null };

export type ResultGroup = {
  representative: Parsed;
  rows: Result[];
  evidence: Evidence | 'single';
};

export type MatchingConfig = {
  allowedPercent: number;
  disallowedPercent: number;
};

export const defaultMatching: MatchingConfig = {
  allowedPercent: 2,
  disallowedPercent: 50,
};

const NEWZNAB_CATEGORY_NAMES: Readonly<Record<number, string>> = {
  1000: 'Console',
  2000: 'Movies',
  3000: 'Audio',
  4000: 'PC',
  5000: 'TV',
  6000: 'Adult',
  7000: 'Books',
  8000: 'Other',
};

export function categoryNameForId(categoryId: number): string | undefined {
  return NEWZNAB_CATEGORY_NAMES[Math.floor(categoryId / 1000) * 1000];
}

export function validMatching(value: MatchingConfig): boolean {
  return (
    Number.isFinite(value.allowedPercent) &&
    Number.isFinite(value.disallowedPercent) &&
    value.allowedPercent >= 0 &&
    value.allowedPercent < value.disallowedPercent &&
    value.disallowedPercent <= 100
  );
}

function areOptionalTagsCompatible(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return !left || !right || left === right;
}

function hasSameVariantFlags(left: Parsed, right: Parsed): boolean {
  return (
    left.packKind === right.packKind &&
    left.flags.repack === right.flags.repack &&
    left.flags.proper === right.flags.proper &&
    left.hdrDv === right.hdrDv &&
    (left.treatment ?? null) === (right.treatment ?? null)
  );
}

function hasCompatibleSourceAndCodec(left: Parsed, right: Parsed): boolean {
  return (
    areOptionalTagsCompatible(left.source, right.source) &&
    areOptionalTagsCompatible(left.encoder, right.encoder) &&
    areOptionalTagsCompatible(left.webProvider, right.webProvider) &&
    areOptionalTagsCompatible(left.webDelivery, right.webDelivery)
  );
}

function calculateSizeDeviationPercent(leftSize: number, rightSize: number): number | null {
  if (leftSize <= 0 || rightSize <= 0) return null;
  return (Math.abs(leftSize - rightSize) / Math.max(leftSize, rightSize)) * 100;
}

function compareCandidates(
  left: Candidate,
  right: Candidate,
  config: MatchingConfig,
): Evidence | null {
  const leftHash = normalizeInfoHash(left.row.infoHash);
  const rightHash = normalizeInfoHash(right.row.infoHash);
  if (leftHash && rightHash && leftHash === rightHash) return 'hash';

  if (!left.key || left.key !== right.key) return null;

  // Lookup keys are candidate buckets, not proof. Retain variant guards.
  if (!hasSameVariantFlags(left.parsed, right.parsed)) return null;
  if (!hasCompatibleSourceAndCodec(left.parsed, right.parsed)) return null;

  // The parser does not yet expose a season-range end; do not guess box-set identity.
  if (left.parsed.packKind === 'season-range') return null;

  const deviation = calculateSizeDeviationPercent(left.row.size, right.row.size);
  if (deviation !== null && deviation >= config.disallowedPercent) return null;

  const withinAllowedTolerance = deviation !== null && deviation <= config.allowedPercent;
  return withinAllowedTolerance ? 'release' : 'release_size_off';
}

function mergeGroupEvidence(
  current: ResultGroup['evidence'],
  incoming: readonly Evidence[],
): Evidence {
  if (current === 'release_size_off' || incoming.includes('release_size_off')) {
    return 'release_size_off';
  }
  if (current === 'release' || incoming.includes('release')) {
    return 'release';
  }
  return 'hash';
}

function distinctIndexerCount(rows: readonly Result[]): number {
  return new Set(rows.map((row) => row.indexerId)).size;
}

export function groupResults(
  results: Result[],
  config: MatchingConfig = defaultMatching,
  parsedByRow?: ReadonlyMap<Result, Parsed>,
): ResultGroup[] {
  if (!validMatching(config)) throw new Error('Invalid matching thresholds');

  const groups: Array<{ members: Candidate[]; evidence: ResultGroup['evidence'] }> = [];
  const buckets = new Map<string, Set<number>>();
  const seen = new Set<string>();

  for (const row of results) {
    const identity = JSON.stringify([row.indexerId, row.guid]);
    if (seen.has(identity)) continue;
    seen.add(identity);

    const parsed = parsedByRow?.get(row) ?? parseReleaseName(row.title);
    const candidate: Candidate = { row, parsed, key: releaseLookupKey(parsed) };
    const infoHash = normalizeInfoHash(row.infoHash);

    const bucketKeys = [
      ...(infoHash ? [`hash:${infoHash}`] : []),
      ...(candidate.key ? [`release:${candidate.key}`] : []),
    ];
    const candidateGroupIndices = new Set(
      bucketKeys.flatMap((key) => [...(buckets.get(key) ?? [])]),
    );

    let matchedGroupIndex: number | undefined;
    let matchedEvidence: Evidence[] = [];

    for (const groupIndex of candidateGroupIndices) {
      const pairMatches = groups[groupIndex]!.members.map((member) =>
        compareCandidates(candidate, member, config),
      );
      if (pairMatches.every((match): match is Evidence => match !== null)) {
        matchedGroupIndex = groupIndex;
        matchedEvidence = pairMatches;
        break;
      }
    }

    if (matchedGroupIndex === undefined) {
      matchedGroupIndex = groups.length;
      groups.push({ members: [candidate], evidence: 'single' });
    } else {
      const group = groups[matchedGroupIndex]!;
      group.members.push(candidate);
      group.evidence = mergeGroupEvidence(group.evidence, matchedEvidence);
    }

    for (const key of bucketKeys) {
      let groupSet = buckets.get(key);
      if (!groupSet) {
        groupSet = new Set();
        buckets.set(key, groupSet);
      }
      groupSet.add(matchedGroupIndex);
    }
  }

  return groups
    .map((group) => ({
      representative: group.members[0]!.parsed,
      rows: group.members.map((member) => member.row),
      evidence: group.evidence,
    }))
    .sort((left, right) => distinctIndexerCount(right.rows) - distinctIndexerCount(left.rows));
}

/** Only explicit full freeleech flags; partial discounts are not full freeleech. */
export function isFreeleech(result: Result): boolean {
  return (result.indexerFlags ?? []).some(
    (flag) => flag.toLowerCase().replace(/[\s_-]/g, '') === 'freeleech',
  );
}

/** Largest all-pairs size cluster; a majority is required to label outliers. */
export function sizeConsistency(rows: Result[], tolerance = 0.02) {
  const known = rows
    .filter((row) => Number.isFinite(row.size) && row.size > 0)
    .sort((left, right) => left.size - right.size);

  let windowStart = 0;
  let largestCluster: Result[] = [];

  for (let windowEnd = 0; windowEnd < known.length; windowEnd++) {
    while (
      windowStart < windowEnd &&
      (known[windowEnd]!.size - known[windowStart]!.size) / known[windowEnd]!.size > tolerance
    ) {
      windowStart++;
    }
    if (windowEnd - windowStart + 1 > largestCluster.length) {
      largestCluster = known.slice(windowStart, windowEnd + 1);
    }
  }

  const majority = largestCluster.length >= 2 && largestCluster.length > known.length / 2;
  const reference = largestCluster.length
    ? (largestCluster[Math.floor((largestCluster.length - 1) / 2)]!.size +
        largestCluster[Math.floor(largestCluster.length / 2)]!.size) /
      2
    : null;
  const clusterMembers = new Set(largestCluster);

  return {
    total: rows.length,
    known: known.length,
    missing: rows.length - known.length,
    agree: largestCluster.length,
    tolerance,
    reference,
    majority,
    outliers: majority ? known.filter((row) => !clusterMembers.has(row)) : [],
  };
}

export function resultCategories(result: Result): string[] {
  const values = [
    ...new Set(
      (result.categories ?? [])
        .map((category) => categoryNameForId(category.id))
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  return values.length ? values : ['Unknown'];
}

export function matchesResultCategories(
  result: Result,
  include: string[],
  exclude: string[],
): boolean {
  const values = resultCategories(result);
  const isExcluded = values.some((category) => exclude.includes(category));
  const isIncluded = !include.length || values.some((category) => include.includes(category));
  return !isExcluded && isIncluded;
}
