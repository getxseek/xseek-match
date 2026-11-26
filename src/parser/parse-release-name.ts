/**
 * Release-name parser — derived from detect-core v6 (detect-core:128aa23) and
 * tree-shaken to the release-key and search-input surface used by xseek-match.
 */
import type { ParsedRelease, ReleaseFlags } from './types.js';
import {
  ENCODER_ALIASES,
  RESOLUTIONS,
  SOURCE_ALIASES,
  TREATMENT_ALIASES,
  type Encoder,
  type HdrFormat,
  type ReleaseTreatment,
  type Resolution,
  type Source,
} from './vocabulary.js';
import { extractWebDelivery, extractWebProvider } from './web-providers.js';

function toIntSafe(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGroup(group: string): string {
  return group.toLowerCase().replace(/[._&]/g, '');
}

/** Container / file extensions — not release groups. */
const CONTAINER_EXTENSIONS_RE = /\.(mkv|mp4|avi|m4v|ts|wmv|flv|mov|webm)$/i;

/** Strip trailing container extension before group extraction. */
function stripContainerExtension(raw: string): string {
  return raw.replace(CONTAINER_EXTENSIONS_RE, '');
}

/** Trailing sample clip markers on filenames (not a release group). */
function stripSampleMarkerSuffix(raw: string): string {
  return raw.replace(/(?:[-._])sample$/i, '');
}

/** Tracker moderation suffix tags appended after the real -GROUP (not release groups). */
const MODERATION_SUFFIX_RE = /(?:[-._])(?:TRUMPABLE|TOREVIEW)\s*$/i;

/** Strip trailing -TRUMPABLE / -TOREVIEW (repeatable, e.g. both present). */
function stripModerationSuffixes(raw: string): string {
  let name = raw.trim();
  while (MODERATION_SUFFIX_RE.test(name)) {
    name = name.replace(MODERATION_SUFFIX_RE, '').trimEnd();
  }
  return name;
}

/** Indexer tag glued to the group: `-NTb[TGx]`, `-GRP[rarbg]`. A spaced `[1080p]` is left alone. */
const ATTACHED_INDEXER_TAG_RE = /(?<=[A-Za-z0-9])\[[^\]\s]{1,24}\]$/;

/** Suffixes reposters and indexers add after the real -GROUP. */
const REPOST_SUFFIX_RE = /-(?:xpost|obfuscated|postbot|scrambled|asrequested|rakuten)$/i;

export function prepareNameForGroupExtraction(raw: string): string {
  let name = stripModerationSuffixes(stripSampleMarkerSuffix(stripContainerExtension(raw.trim())));
  name = name.replace(ATTACHED_INDEXER_TAG_RE, '');
  while (REPOST_SUFFIX_RE.test(name)) {
    name = name.replace(REPOST_SUFFIX_RE, '');
  }
  return name;
}

/** Groups whose name contains a hyphen, which the trailing -GROUP rule would cut in half. */
const HYPHENATED_RELEASE_GROUPS = ['D-Z0N3'] as const;

const HYPHENATED_GROUP_SUFFIX_RE = new RegExp(
  `-(${HYPHENATED_RELEASE_GROUPS.map((group) => group.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|')})\\s*$`,
  'i',
);

/** Tokens that are release tags, not scene groups. */
const NOT_RELEASE_GROUP = new Set([
  'AAC',
  'AC3',
  'AV1',
  'AVI',
  'DDP',
  'DL',
  'EAC3',
  'FLV',
  'FHD',
  'H264',
  'H265',
  'HD',
  'HEVC',
  'HFR',
  'MKV',
  'MP4',
  'M4V',
  'MA10',
  'MOV',
  'OPUS',
  'SD',
  'SAMPLE',
  'TOREVIEW',
  'TRUMPABLE',
  'TS',
  'UHD',
  'WEB',
  'WEBDL',
  'WEBM',
  'WEBRIP',
  'WMV',
  'X264',
  'X265',
  '1080P',
  '720P',
  '2160P',
  '4320P',
]);

/** Scene + compound username groups (e.g. DramaticUppishBisonOfBeauty). */
const MAX_SCENE_GROUP_LEN = 40;

const SCENE_GROUP_SUFFIX_RE = new RegExp(
  `(?<![Ww][Ee][Bb])-([A-Za-z0-9][A-Za-z0-9&_]{0,${MAX_SCENE_GROUP_LEN - 1}})\\s*$`,
);

/** Trailing (tag) looks like release specs, not a scene group name. */
function looksLikeReleaseSpecTag(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  if (/\b\d{3,4}[pi]\b/i.test(trimmed)) return true;
  if (/\b\d{3,4}x\d{3,4}\b/i.test(trimmed)) return true;
  if (
    /\b(H\.?264|H\.?265|HEVC|X264|X265|AV1|AAC|AC3|EAC3|DDP|FLAC|OPUS|ATmos|10bit|8bit|Ma10)\b/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  if (/\b(BD|WEB|WEBRIP|WEB-DL|HDTV|DVDRIP|BLURAY|DUAL AUDIO|MULTI)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

/** `[CR]`, `[SWEDiSH]` — source/language tags, not release groups. */
const BRACKET_METADATA_TAGS = new Set([
  'ADN',
  'AMZN',
  'CHINESE',
  'CR',
  'DANISH',
  'DUAL',
  'DUTCH',
  'ENGLISH',
  'FINNISH',
  'FRENCH',
  'FUNI',
  'GERMAN',
  'HIDIVE',
  'ITALIAN',
  'JAPANESE',
  'KOREAN',
  // Ma10: 10-bit encode, as fansub names write it.
  'MA10',
  'MULTI',
  'NORWEGIAN',
  'POLISH',
  'PORTUGUESE',
  'SPANISH',
  'SWEDISH',
  'VRV',
]);

/** Anime-style [Group] prefix (SubsPlease, shincaps, …). */
function isPlausibleBracketReleaseGroup(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_SCENE_GROUP_LEN) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9&_.+\- ]*$/.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  const upper = trimmed.toUpperCase();
  if (NOT_RELEASE_GROUP.has(upper)) return false;
  if (BRACKET_METADATA_TAGS.has(upper)) return false;
  if (looksLikeReleaseSpecTag(trimmed)) return false;
  return true;
}

/** Leading `[Group]` tag on anime releases. */
export function extractBracketReleaseGroup(raw: string): string | null {
  const match = raw.trim().match(/^\[([^\]]{1,48})\]\s*/);
  if (!match?.[1]) return null;
  const groupCandidate = match[1].trim();
  return isPlausibleBracketReleaseGroup(groupCandidate) ? groupCandidate : null;
}

/** S01E02 / s04e02 — episode labels, not scene groups. */
function looksLikeEpisodeToken(token: string): boolean {
  return /^s?\d{1,2}e\d{1,3}$/i.test(token.trim());
}

/** Scene groups; reject codec/source tails (e.g. WEB-DL → DL.AAC.H264). */
function isPlausibleSceneReleaseGroup(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length < 2 || trimmed.length > MAX_SCENE_GROUP_LEN) return false;
  if (looksLikeEpisodeToken(trimmed)) return false;
  if (trimmed.includes('.')) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9&_]*$/.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  const upper = trimmed.toUpperCase();
  if (NOT_RELEASE_GROUP.has(upper)) return false;
  if (/^H?26[45]$/.test(upper)) return false;
  return true;
}

/** Codec tails after a dot — not part of a release group name (e.g. DL.AAC). */
const DOTTED_GROUP_CODEC_TAILS = new Set([
  'AAC',
  'AC3',
  'AV1',
  'DDP',
  'EAC3',
  'H264',
  'H265',
  'HEVC',
  'OPUS',
  'X264',
  'X265',
]);

/** Lead token before a dot is a release tag, not part of a group name (Dual-Audio.MALD). */
const DOTTED_GROUP_NOISE_LEADS = new Set(['AUDIO', 'DUAL', 'MULTI', 'SUB', 'DUB', 'ENG']);

/** One-dot release groups (e.g. XPERT.HD). */
function isPlausibleDottedReleaseGroup(token: string): boolean {
  const trimmed = token.trim();
  const dotIndex = trimmed.indexOf('.');
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return false;
  if (trimmed.indexOf('.', dotIndex + 1) >= 0) return false;
  if (trimmed.length < 4 || trimmed.length > MAX_SCENE_GROUP_LEN) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9&_]*\.[A-Za-z0-9][A-Za-z0-9&_]*$/.test(trimmed)) return false;

  const lead = trimmed.slice(0, dotIndex);
  const tail = trimmed.slice(dotIndex + 1);
  if (DOTTED_GROUP_NOISE_LEADS.has(lead.toUpperCase())) return false;
  if (!isPlausibleSceneReleaseGroup(lead)) return false;
  if (/^\d+$/.test(tail)) return false;
  const tailUpper = tail.toUpperCase();
  if (DOTTED_GROUP_CODEC_TAILS.has(tailUpper)) return false;
  if (/^H?26[45]$/.test(tailUpper)) return false;
  return true;
}

/** `-GROUP.timestamp` strips timestamp; `-GROUP.TAIL` keeps full name when plausible. */
function extractDottedGroupSuffix(name: string): string | null {
  const match = name.match(/(?<![Ww][Ee][Bb])-([A-Za-z0-9][A-Za-z0-9&_.]+)\s*$/);
  if (!match?.[1]) return null;
  const capture = match[1];
  if (!capture.includes('.')) return null;

  const timestampMatch = capture.match(/^([A-Za-z0-9][A-Za-z0-9&_]+)\.(\d{10,})$/);
  if (timestampMatch?.[1] && isPlausibleSceneReleaseGroup(timestampMatch[1])) {
    return timestampMatch[1];
  }

  return isPlausibleDottedReleaseGroup(capture) ? capture : null;
}

/**
 * Human episode filenames (spaces/dashes, not scene dots):
 *   S01E02 - Confrontation
 *   Show - S01E04 - Episode Title
 *   Show - S01E02          (episode only, no separate title)
 */
function looksLikeTitleNamedEpisodeStructure(basename: string): boolean {
  const trimmed = basename.trim();
  if (!/s?\d{1,2}e\d{1,3}/i.test(trimmed)) return false;
  if (/^S?\d{1,2}E\d{1,3}\s+-\s+.+/i.test(trimmed)) return true;
  if (/\s-\s*S?\d{1,2}E\d{1,3}\s+-\s+.+/i.test(trimmed)) return true;
  if (/\s-\s*S?\d{1,2}E\d{1,3}\s*$/i.test(trimmed)) return true;
  if (/\sS?\d{1,2}E\d{1,3}\s+-\s+.+/i.test(trimmed)) return true;
  return false;
}

/** Scene-style release group only (-GROUP, " - Group", or (Group)). No last-token fallback. */
function extractSceneReleaseGroup(raw: string): string | null {
  const name = prepareNameForGroupExtraction(raw);

  if (looksLikeTitleNamedEpisodeStructure(name)) return null;

  const hyphenatedMatch = name.match(HYPHENATED_GROUP_SUFFIX_RE);
  if (hyphenatedMatch?.[1]) return hyphenatedMatch[1];

  // 1) trailing -GROUP (scene style) — wins over [CR]/[SWEDiSH] metadata prefixes
  const sceneSuffixMatch = name.match(SCENE_GROUP_SUFFIX_RE);
  if (sceneSuffixMatch?.[1] && isPlausibleSceneReleaseGroup(sceneSuffixMatch[1])) {
    return sceneSuffixMatch[1];
  }

  const dottedGroup = extractDottedGroupSuffix(name);
  if (dottedGroup) return dottedGroup;

  const bracketGroup = extractBracketReleaseGroup(name);
  if (bracketGroup) return bracketGroup;

  // 2) trailing " - Group" (spaced dash)
  const spacedDashMatch = name.match(/\s+-\s+([A-Za-z0-9][A-Za-z0-9&_ ]{0,48})\s*$/);
  if (spacedDashMatch?.[1]) {
    const groupCandidate = spacedDashMatch[1].trim();
    if (isPlausibleSceneReleaseGroup(groupCandidate)) return groupCandidate;
  }

  // 3) trailing (Group) — not resolution/codec spec blocks
  const parenthesizedMatch = name.match(/\(([^)]{2,48})\)\s*$/);
  if (parenthesizedMatch?.[1]) {
    const groupCandidate = parenthesizedMatch[1].trim();
    if (!looksLikeReleaseSpecTag(groupCandidate) && isPlausibleSceneReleaseGroup(groupCandidate)) {
      return groupCandidate;
    }
  }

  // 4) encoder at the end of a spec block: `(1080p … DDP 5.1 - Wren)`, maybe followed by `[Collective]`
  const specBlock = extractSpecBlockGroup(name);
  if (specBlock) return specBlock.group;

  return null;
}

const SPEC_BLOCK_GROUP_RE =
  /\(([^()]*?)\s-\s([A-Za-z0-9][A-Za-z0-9&_ ]{0,39}?)\s*\)\s*(?:\[([^\]]{1,40})\])?\s*$/;

/**
 * `(1080p NF WEB-DL x265 DDP 5.1 - Wren) [Lattice]` and `(… - Wren Lattice)`.
 * The group after ` - ` may have several words and is kept whole, because real
 * group names can contain spaces; the trailing bracket is the collective.
 */
function extractSpecBlockGroup(name: string): { group: string; collective: string | null } | null {
  const match = name.match(SPEC_BLOCK_GROUP_RE);
  if (!match?.[1] || !match[2]) return null;
  if (!looksLikeReleaseSpecTag(match[1])) return null;
  const group = match[2].trim();
  if (!group.split(/\s+/).every(isPlausibleSceneReleaseGroup) || looksLikeReleaseSpecTag(group)) {
    return null;
  }
  const collective = match[3]?.trim() ?? null;
  return {
    group,
    collective: collective && isPlausibleCollective(collective) ? collective : null,
  };
}

/** `[TAoE]` names a collective; `[REPACK]`, `[PROPER]` or `[ENGLISH DUB]` are release tags. */
function isPlausibleCollective(token: string): boolean {
  if (!isPlausibleBracketReleaseGroup(token)) return false;
  return token
    .split(/\s+/)
    .every(
      (word) =>
        !RELEASE_TAG_TOKEN_RE.test(word) &&
        !/^(?:repack|rerip)\d?$|^(?:dub|dubbed|sub|subbed)$/i.test(word) &&
        !BRACKET_METADATA_TAGS.has(word.toUpperCase()),
    );
}

/** The collective in `(… - Wren) [Lattice]`: the release circle the encoder posts for. Null in any other shape. */
function extractReleaseCollective(raw: string): string | null {
  const name = prepareNameForGroupExtraction(raw);
  const specBlock = extractSpecBlockGroup(name);
  return specBlock && extractSceneReleaseGroup(raw) === specBlock.group
    ? specBlock.collective
    : null;
}

function extractGroup(raw: string): string | null {
  const sceneGroup = extractSceneReleaseGroup(raw);
  if (sceneGroup) return sceneGroup;

  // 4) fallback: last token after final dot, if plausible (general parsing only)
  const name = prepareNameForGroupExtraction(raw);
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex >= 0 && lastDotIndex < name.length - 1) {
    const token = name.slice(lastDotIndex + 1).trim();
    if (isPlausibleSceneReleaseGroup(token)) return token;
  }

  return null;
}

function extractFlags(lower: string): ReleaseFlags {
  return {
    proper: /\bproper\b/.test(lower),
    // Anime groups mark re-releases as v2/v3 (standalone or glued to S01, E05 or an
    // absolute ` - 05`), which trackers often rewrite as REPACK.
    repack: /\b(?:repack|rerip)\d?\b|(?:\b|(?<=(?:^|[\s._-]|[se])\d{1,4}))v[2-9]\b/.test(lower),
  };
}

const RESOLUTION_PATTERN = new RegExp(`\\b(${RESOLUTIONS.join('|')})\\b`);

function extractResolution(lower: string): Resolution | null {
  const match = lower.match(RESOLUTION_PATTERN);
  return (match?.[1]?.toLowerCase() as Resolution | undefined) ?? null;
}

function extractSource(lower: string): Source | null {
  // Deliberately coarse. SOURCE_ALIASES is ordered, so "web-dl" beats "web".
  for (const [alias, source] of SOURCE_ALIASES) {
    if (lower.includes(alias)) return source;
  }
  // Shorthand on vague pack titles (e.g. "S06 br 10bit hevc-d3g").
  if (/\bbr\b/.test(lower)) return 'BLURAY';
  // Full DVD discs: DVD5 / DVD9 / DVDR.
  if (/\bdvd(?:5|9|r)?\b/.test(lower)) return 'DVD';
  return null;
}

/**
 * Remux and full-disc releases say so in the name. An encode says nothing, so
 * an unstated treatment stays null rather than being assumed to be an encode.
 */
const TREATMENT_PATTERNS: ReadonlyArray<readonly [RegExp, ReleaseTreatment]> =
  TREATMENT_ALIASES.map(
    ([alias, treatment]) =>
      [new RegExp(`\\b${alias.split(' ').join('[\\s._-]+')}\\b`), treatment] as const,
  );

function extractTreatment(lower: string): ReleaseTreatment | null {
  for (const [pattern, treatment] of TREATMENT_PATTERNS) {
    if (pattern.test(lower)) return treatment;
  }
  return null;
}

function extractHdrDv(lower: string): HdrFormat | null {
  if (
    /\b(?:dv|dovi)\b/.test(lower) ||
    lower.includes('dolby.vision') ||
    lower.includes('dolbyvision')
  ) {
    // DV with HDR10+ metadata is a different file from DV with HDR10, so the + is kept.
    if (lower.includes('hdr10+') || lower.includes('hdr10plus')) return 'DV.HDR10+';
    if (/\bhdr\b/.test(lower) || lower.includes('hdr10')) return 'DV.HDR';
    return 'DV';
  }
  if (lower.includes('hdr10+') || lower.includes('hdr10plus')) return 'HDR10+';
  if (lower.includes('hdr10')) return 'HDR10';
  if (/\bhdr\b/.test(lower)) return 'HDR';
  // HLG is HDR too; without its own value it would read as SDR.
  if (/\bhlg\b/.test(lower)) return 'HLG';
  return null;
}

// `h264` and `h265` also match `h.264` / `h 264`; the separator is stripped before lookup.
const ENCODER_PATTERN = new RegExp(
  `\\b(${ENCODER_ALIASES.map(([alias]) => (alias.startsWith('h') ? alias.replace('h', 'h[.\\s]?') : alias)).join('|')})\\b`,
);
const ENCODER_BY_ALIAS = new Map<string, Encoder>(
  ENCODER_ALIASES.map(([alias, encoder]) => [alias, encoder]),
);

function extractEncoder(lower: string): Encoder | null {
  const match = lower.match(ENCODER_PATTERN);
  if (!match?.[1]) return null;
  return ENCODER_BY_ALIAS.get(match[1].replace(/[.\s]/, '')) ?? null;
}

type SeasonEpisodeInference =
  | { season: number; episode: number; episodeEnd: number | null; isPack: false; packKind: null }
  | { season: null; episode: number; episodeEnd: null; isPack: false; packKind: null }
  | { season: number; episode: null; episodeEnd: null; isPack: true; packKind: 'season' }
  | {
      season: number;
      episode: number | null;
      episodeEnd: number | null;
      isPack: true;
      packKind: 'range';
    }
  | { season: null; episode: number; episodeEnd: number; isPack: true; packKind: 'range' }
  | { season: number; episode: null; episodeEnd: null; isPack: true; packKind: 'season-range' }
  | { season: null; episode: null; episodeEnd: null; isPack: true; packKind: 'season' }
  | { season: null; episode: null; episodeEnd: null; isPack: false; packKind: null };

/** Anime re-release marker glued to an episode or season number (E05v2, S01v2, - 05v2). */
const VERSION_SUFFIX = String.raw`(?:v\d)?`;

/** Leading `[Group]` tag, as on anime releases. */
const LEADING_BRACKET_TAG_RE = /^\s*\[[^\]]{1,48}\]\s*/;

/** `[Batch]` / `(BD Batch)`: a whole-show or whole-season pack in anime naming. */
const BATCH_MARKER_RE = /[[(][^\])]*\bbatch\b[^\])]*[\])]/i;

/** `[Group] Show (specs) [Batch]` with no season marker: a pack whose season the name does not state. */
function isBracketedBatch(name: string): boolean {
  return (
    LEADING_BRACKET_TAG_RE.test(name) &&
    BATCH_MARKER_RE.test(name.replace(LEADING_BRACKET_TAG_RE, ''))
  );
}

const SEASON_PART_RE =
  /(?:^|[.\s_-])s\d{1,3}(?:[.\s_-]*e\d{1,4})?[.\s_-]+part[.\s_-]*(\d{1,2})(?:$|[.\s_-])/i;

const YEAR_EPISODE_RE = new RegExp(
  String.raw`(?:^|[.\s_-])s(20\d{2}|19\d{2})[.\s_-]*e(\d{1,4})${VERSION_SUFFIX}(?:$|[.\s_-])`,
  'i',
);
const YEAR_PACK_RE = /(?:^|[.\s_-])s(20\d{2}|19\d{2})(?!\d*[.\s_-]*e\d)(?:$|[.\s_-])/i;
const DUAL_EPISODE_RE = new RegExp(
  String.raw`(?:^|[.\s_-])s(\d{1,3})[.\s_-]*e(\d{1,4})e(\d{1,4})${VERSION_SUFFIX}(?:$|[.\s_-])`,
  'i',
);
const EPISODE_RANGE_RE =
  /(?:^|[.\s_-])s(\d{1,3})[.\s_-]*e(\d{1,4})[.\s_-]*-[.\s_-]*e?(\d{1,4})(?:$|[.\s_-])/i;
const SINGLE_EPISODE_RE = new RegExp(
  String.raw`(?:^|[.\s_-])s(\d{1,3})[.\s_-]*e(\d{1,4})${VERSION_SUFFIX}(?:$|[.\s_-])`,
  'i',
);
const ALT_EPISODE_RE = /(?:^|[.\s_-])(\d{1,2})x(\d{2,4})(?:$|[.\s_-])/i;
const ANIME_EPISODE_RE = new RegExp(String.raw`\s-\s(\d{1,4})${VERSION_SUFFIX}(?=$|[\s[(.])`, 'i');
const ANIME_SEASON_EPISODE_RE = new RegExp(String.raw`\ss(\d{1,2})${ANIME_EPISODE_RE.source}`, 'i');
/** Anime batch span: `[Group] Show - 01 ~ 28`, `- 01-12`, `S2 - 13 ~ 24`. */
const ANIME_EPISODE_RANGE_RE = new RegExp(
  String.raw`(?:\ss(\d{1,2}))?\s-\s(\d{1,4})${VERSION_SUFFIX}\s*[~–-]\s*(\d{1,4})${VERSION_SUFFIX}(?=$|[\s[(.])`,
  'i',
);
const SEASON_RANGE_RE = /(?:^|[.\s_-])s(\d{1,2})\s*[-–]\s*s(\d{1,2})(?:$|[.\s_-])/i;
const EPISODE_SPAN_WITHOUT_SEASON_RE =
  /(?:^|[.\s_-])e\d{1,3}[.\s_-]*-[.\s_-]*e?\d{1,3}(?:$|[.\s_-])/i;
const LEADING_SEASON_TOKEN_RE = /(?:^|[.\s_-])s(\d{1,2})/i;
const SEASON_PACK_RE = new RegExp(
  String.raw`(?:^|[.\s_-])s(\d{1,2})${VERSION_SUFFIX}(?!\d*[.\s_-]*e\d)(?:$|[.\s_-])`,
  'i',
);
const SPELLED_SEASON_PACK_RE =
  /(?:^|[.\s_(\[-])season[.\s_-]*(\d{1,2})(?!\d*[.\s_-]*e(?:pisode)?[.\s_-]*\d)(?:$|[.\s_)\]-])/i;

/** `S01 Part 2` / `S01.Part.2`: a split season, which is a different pack from Part 1. */
function extractSeasonPart(name: string): number | null {
  const match = name.match(SEASON_PART_RE);
  return toIntSafe(match?.[1]);
}

function matchSingleSeasonEpisode(name: string, pattern: RegExp): SeasonEpisodeInference | null {
  const match = name.match(pattern);
  const season = toIntSafe(match?.[1]);
  const episode = toIntSafe(match?.[2]);
  if (season == null || episode == null) return null;
  return { season, episode, episodeEnd: null, isPack: false, packKind: null };
}

function matchSeasonPack(name: string, pattern: RegExp): SeasonEpisodeInference | null {
  const match = name.match(pattern);
  const season = toIntSafe(match?.[1]);
  if (season == null) return null;
  return { season, episode: null, episodeEnd: null, isPack: true, packKind: 'season' };
}

/**
 * `Open Season 3 2010`: "Season N" is part of a movie title only when all hold:
 * "Season" and an unpadded number are separate words (`SEASON1` is a marker),
 * a single year follows the number directly (`Season.2.2005-2006` is a broadcast
 * span), no year comes before it, and the name has no other season or episode
 * marker (`S01`, `S01E02`, `Complete`). TV packs write `Show 1974 Season 1`,
 * `Show.2010.Season.8.1080p` or `Show-Season.02.2023`.
 */
function isSeasonInMovieTitle(name: string, match: RegExpMatchArray): boolean {
  const num = match[1] ?? '';
  if (num.startsWith('0') || match.index == null) return false;
  const numStart = name.indexOf(num, match.index);
  if (!/season[.\s_-]+$/i.test(name.slice(match.index, numStart))) return false;
  if (/(?:^|[.\s_(\[-])(?:19|20)\d{2}(?:$|[.\s_)\]-])/.test(name.slice(0, match.index + 1)))
    return false;
  if (/(?:^|[.\s_(\[-])(?:s\d{1,3}(?:[.\s_-]*e\d{1,4})?|complete)(?:$|[.\s_)\]-])/i.test(name))
    return false;
  return /^[.\s_-]+(?:19|20)\d{2}(?![-–]\d{2,4})(?:$|[.\s_)\]-])/.test(
    name.slice(numStart + num.length),
  );
}

function inferSeasonEpisode(name: string): SeasonEpisodeInference {
  // 0) Variety / long-runner: S2026E801 (broadcast year + absolute episode)
  const yearEpisode = matchSingleSeasonEpisode(name, YEAR_EPISODE_RE);
  if (yearEpisode) return yearEpisode;

  // 0b) Same format, year-only pack: Running Man 2010 S2025
  const yearPack = matchSeasonPack(name, YEAR_PACK_RE);
  if (yearPack) return yearPack;

  // 0c) Dual episode in one file: Arthur S01E21E22 (PBS-style)
  const dualEpisodeMatch = name.match(DUAL_EPISODE_RE);
  if (dualEpisodeMatch?.[1] && dualEpisodeMatch?.[2] && dualEpisodeMatch?.[3]) {
    const season = toIntSafe(dualEpisodeMatch[1]);
    const episode = toIntSafe(dualEpisodeMatch[2]);
    const episodeEnd = toIntSafe(dualEpisodeMatch[3]);
    if (season != null && episode != null && episodeEnd != null && episodeEnd > episode) {
      return { season, episode, episodeEnd, isPack: false, packKind: null };
    }
  }

  // 0d) Episode range within one season: S01E01-E03 / S01E01-03. Checked before the single form,
  // which would otherwise read the span as episode 1. The end must not run into a resolution (E05-720p).
  const rangeMatch = name.match(EPISODE_RANGE_RE);
  if (rangeMatch?.[1] && rangeMatch?.[2] && rangeMatch?.[3]) {
    const season = toIntSafe(rangeMatch[1]);
    const episode = toIntSafe(rangeMatch[2]);
    const episodeEnd = toIntSafe(rangeMatch[3]);
    if (season != null && episode != null && episodeEnd != null && episodeEnd > episode) {
      return { season, episode, episodeEnd, isPack: true, packKind: 'range' };
    }
  }

  // 1) Standard single: S02E06 / S02.E06 / S02 E06 / S01E05v2 (episode up to 4 digits for long-runners)
  const standardSingle = matchSingleSeasonEpisode(name, SINGLE_EPISODE_RE);
  if (standardSingle) return standardSingle;

  // 3) Alternate single forms: 2x06
  const alternateSingle = matchSingleSeasonEpisode(name, ALT_EPISODE_RE);
  if (alternateSingle) return alternateSingle;

  // 3b) Anime: `[Group] Show S2 - 05` and absolute `[Group] Show - 1100`. Only after a leading
  // [Group] tag, so a spaced movie title like `Movie - 2020` is not read as an episode.
  if (LEADING_BRACKET_TAG_RE.test(name)) {
    // Checked before the single forms, which would read `- 01 ~ 28` as episode 1.
    const animeRange = name.match(ANIME_EPISODE_RANGE_RE);
    const rangeStart = toIntSafe(animeRange?.[2]);
    const rangeEnd = toIntSafe(animeRange?.[3]);
    if (rangeStart != null && rangeEnd != null && rangeEnd > rangeStart) {
      const range = {
        episode: rangeStart,
        episodeEnd: rangeEnd,
        isPack: true,
        packKind: 'range',
      } as const;
      const season = toIntSafe(animeRange?.[1]);
      return season == null ? { ...range, season: null } : { ...range, season };
    }

    const animeWithSeason = matchSingleSeasonEpisode(name, ANIME_SEASON_EPISODE_RE);
    if (animeWithSeason) return animeWithSeason;

    const absoluteMatch = name.match(ANIME_EPISODE_RE);
    const episode = toIntSafe(absoluteMatch?.[1]);
    if (episode != null) {
      return { season: null, episode, episodeEnd: null, isPack: false, packKind: null };
    }
  }

  // Multi-season box sets: S01-S07 (not a single-season complete pack)
  const seasonRangeMatch = name.match(SEASON_RANGE_RE);
  if (seasonRangeMatch?.[1] && seasonRangeMatch?.[2]) {
    const season = toIntSafe(seasonRangeMatch[1]);
    const seasonEnd = toIntSafe(seasonRangeMatch[2]);
    if (season != null && seasonEnd != null && seasonEnd > season) {
      return {
        season,
        episode: null,
        episodeEnd: null,
        isPack: true,
        packKind: 'season-range',
      };
    }
  }

  // 4) Episode span without a leading season tag on the span: S01 ... E01-E10
  if (EPISODE_SPAN_WITHOUT_SEASON_RE.test(name)) {
    const seasonMatch = name.match(LEADING_SEASON_TOKEN_RE);
    const season = toIntSafe(seasonMatch?.[1]);
    if (season != null) {
      return { season, episode: null, episodeEnd: null, isPack: true, packKind: 'range' };
    }
  }

  // 2) Season pack: S01 / S01v2 / S01 COMPLETE (not followed by E##)
  const seasonPack = matchSeasonPack(name, SEASON_PACK_RE);
  if (seasonPack) return seasonPack;

  // 2b) Spelled out: Show.Season.1 / Show Season 01
  const spelledSeason = name.match(SPELLED_SEASON_PACK_RE);
  const spelledSeasonPack =
    spelledSeason && !isSeasonInMovieTitle(name, spelledSeason)
      ? matchSeasonPack(name, SPELLED_SEASON_PACK_RE)
      : null;
  if (spelledSeasonPack) return spelledSeasonPack;

  if (isBracketedBatch(name)) {
    return { season: null, episode: null, episodeEnd: null, isPack: true, packKind: 'season' };
  }

  return { season: null, episode: null, episodeEnd: null, isPack: false, packKind: null };
}

/** Collapse a title to a stable alphanumeric slug for cross-match keys. */
function normalizeTitleSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '');
}

function looksLikeTvRelease(
  name: string,
  seasonEpisode: { season: number | null; episode: number | null; isPack: boolean },
  airDate?: string | null,
): boolean {
  if (airDate) return true;
  if (seasonEpisode.season != null || seasonEpisode.episode != null) return true;
  if (seasonEpisode.isPack) return true;
  return /\bs?(?:\d{1,2}|20\d{2}|19\d{2})e\d{1,4}(?:e\d{1,4})?\b/i.test(name);
}

const AIR_DATE_RE = /\b(20\d{2}|19\d{2})[-.](\d{2})[-.](\d{2})\b/;

/** YYYY-MM-DD air date for daily/dated TV releases. */
function extractAirDate(name: string): string | null {
  const match = name.match(AIR_DATE_RE);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/** Dated TV: show name + air date instead of SxxExx (e.g. Jeopardy! 2026-05-28). */
function inferDatedTvIdentity(
  name: string,
  seasonEpisode: { season: number | null; episode: number | null; isPack: boolean },
): { airDate: string; showSlug: string } | null {
  if (seasonEpisode.season != null || seasonEpisode.episode != null || seasonEpisode.isPack) {
    return null;
  }

  const match = name.match(AIR_DATE_RE);
  if (!match?.[1] || match.index == null) return null;

  const airDate = extractAirDate(name);
  if (!airDate) return null;

  const prefixBeforeDate = name
    .slice(0, match.index)
    .trim()
    .replace(/\.mkv$/i, '');
  const primaryTitle = prefixBeforeDate.split(/\s+AKA\s+/i)[0]?.trim() ?? prefixBeforeDate;
  const showSlug = normalizeTitleSlug(primaryTitle);
  if (!showSlug || showSlug.length < 2) return null;

  return { airDate, showSlug };
}

const TV_SHOW_SLUG_CUT_PATTERNS = [
  /(?:^|[.\s_-])s(20\d{2}|19\d{2})[.\s_-]*e\d{1,4}/i,
  /(?:^|[.\s_-])s\d{1,3}[.\s_-]*e\d{1,4}/i,
  /(?:^|[.\s_-])(\d{1,2})x(\d{2,4})(?:$|[.\s_-])/i,
  /(?:^|[.\s_-])s(20\d{2}|19\d{2})(?!\d*[.\s_-]*e\d)(?:$|[.\s_-])/i,
  /(?:^|[.\s_-])s(\d{1,2})(?:v\d)?(?!\d*[.\s_-]*e\d)(?:$|[.\s_-])/i,
  /(?:^|[.\s_(\[-])season[.\s_-]*\d{1,2}(?:$|[.\s_)\]-])/i,
] as const;

const ANIME_SLUG_CUT_PATTERN = /\s-\s\d{1,4}(?:v\d)?(?=$|[\s[(.~–-])/i;

/** A seasonless batch has no marker to cut at; the title ends at its first spec block. */
const BATCH_SLUG_CUT_PATTERN = /\s*[[(]/;

/** Tags that can sit among the title words but are never part of the title. */
const TITLE_STOP_TOKEN_RE = /^ma10$/i;

/** Text before first Sxx / SxxExx / 2x06 / Season N / anime ` - 05` token → show slug (TV packs and episodes). */
function inferTvShowSlug(name: string): string | null {
  const title = inferTvShowTitle(name);
  const showSlug = title ? normalizeTitleSlug(title) : '';
  if (!showSlug || showSlug.length < 2) return null;
  return showSlug;
}

/** The show title as written, before it is slugged. */
function inferTvShowTitle(name: string): string | null {
  const isBracketed = LEADING_BRACKET_TAG_RE.test(name);
  const body = name.replace(LEADING_BRACKET_TAG_RE, '');
  const patterns = [
    ...TV_SHOW_SLUG_CUT_PATTERNS,
    ...(isBracketed ? [ANIME_SLUG_CUT_PATTERN] : []),
    ...(isBracketedBatch(name) ? [BATCH_SLUG_CUT_PATTERN] : []),
  ];

  let earliestMatchIndex: number | null = null;
  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.index != null && (earliestMatchIndex == null || match.index < earliestMatchIndex)) {
      earliestMatchIndex = match.index;
    }
  }
  if (earliestMatchIndex == null || earliestMatchIndex === 0) return null;

  let titlePrefix = body
    .slice(0, earliestMatchIndex)
    .trim()
    .replace(/\.mkv$/i, '');
  titlePrefix = titlePrefix.split(/\s+AKA\s+/i)[0]?.trim() ?? titlePrefix;
  titlePrefix = titlePrefix.replace(/\s*\(\s*(19\d{2}|20\d{2})\s*\)\s*$/i, '').trim();
  titlePrefix = titlePrefix.replace(/[.\s_-]+(19\d{2}|20\d{2})\s*$/i, '').trim();
  titlePrefix = titlePrefix
    .split(/([.\s_-]+)/)
    .filter((token) => !TITLE_STOP_TOKEN_RE.test(token))
    .join('');

  return titlePrefix;
}

const ROMAN_NUMERAL_RE =
  /^(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const ROMAN_VALUES: ReadonlyArray<readonly [string, number]> = [
  ['M', 1000],
  ['CM', 900],
  ['D', 500],
  ['CD', 400],
  ['C', 100],
  ['XC', 90],
  ['L', 50],
  ['XL', 40],
  ['X', 10],
  ['IX', 9],
  ['V', 5],
  ['IV', 4],
  ['I', 1],
];

/** `XI` → 11. Only well-formed upper-case numerals, as release names write them. */
function romanNumeralValue(token: string): number | null {
  if (!ROMAN_NUMERAL_RE.test(token)) return null;
  let rest = token;
  let value = 0;
  for (const [numeral, amount] of ROMAN_VALUES) {
    while (rest.startsWith(numeral)) {
      value += amount;
      rest = rest.slice(numeral.length);
    }
  }
  return value;
}

/** 11 → `XI`. */
export function toRomanNumeral(value: number): string {
  let rest = value;
  let out = '';
  for (const [numeral, amount] of ROMAN_VALUES) {
    while (rest >= amount) {
      out += numeral;
      rest -= amount;
    }
  }
  return out;
}

/**
 * A Roman numeral ending a TV title can name the season: `Show.XI.S11`, or a
 * seasonless `[Group] Show II [Batch]`. With a season marker it must equal the
 * season (any value); without one, only II to X on a pack count. Episodes
 * without a marker keep their absolute numbering, and movies never have one.
 * The value is kept apart from `season`, because `Show II` may also be the
 * whole title.
 */
function inferSeasonNumeral(
  name: string,
  seasonEpisode: { season: number | null; episode: number | null; isPack: boolean },
): number | null {
  const words = (inferTvShowTitle(name) ?? '').split(/[.\s_-]+/).filter(Boolean);
  if (words.length < 2) return null;
  const value = romanNumeralValue(words[words.length - 1]!);
  if (value == null) return null;
  if (seasonEpisode.season != null) return value === seasonEpisode.season ? value : null;
  if (seasonEpisode.isPack && seasonEpisode.episode == null && value >= 2 && value <= 10) {
    return value;
  }
  return null;
}

/** First token that is a release tag, not part of a title (resolution, source, codec, …). */
const RELEASE_TAG_TOKEN_RE =
  /^(?:\d{3,4}[pi]|4k|uhd|bluray|blu|bdrip|brrip|bdremux|remux|web|webdl|webrip|hdtv|hdrip|dvdrip|dvd\d?|x26[45]|h26[45]|hevc|avc|av1|xvid|ma10|proper|repack|internal|hybrid|multi|dual)$/i;

/**
 * Parse movie title + year from scene-style names (e.g. Title.Words.1972.1080p…).
 * The release year is the last year before the release tags, so a year in the title stays in the
 * title: Blade.Runner.2049.2017 is "bladerunner2049" (2017), 1917.2019 is "1917" (2019).
 * A re-release (`Alien 1979 2003 Director's Cut`) takes the first year instead.
 */
const YEAR_TOKEN_RE = /^(19\d{2}|20\d{2})$/;

/** `[REC] 2007 …`: a leading bracket followed directly by a year is the title, not a group tag. */
const LEADING_BRACKET_TITLE_RE = /^\s*\[[^\]]{1,48}\]\s*(?:19|20)\d{2}(?:$|[.\s_-])/;

/**
 * Words of an edition label (Director's Cut, Restored, Re-Release, Cinema Release, …).
 * IMAX is left out on purpose: in `Wonder Woman 1984 2020 IMAX` it is a format tag.
 */
const EDITION_TOKEN_RE =
  /^(?:director['’]?s?|directors|cut|restored|restoration|remaster(?:ed)?|re|release|rerelease|extended|special|edition|assembly|cinema|theatrical|uncut|unrated|final|anniversary)$/i;
/** Words that can open an edition label right after the second year. */
const EDITION_LEAD_TOKEN_RE =
  /^(?:director['’]?s?|directors|restored|restoration|remaster(?:ed)?|re|rerelease|extended|special|assembly|cinema|theatrical|uncut|unrated|final|anniversary)$/i;

/**
 * `Title 1979 2003 Director's Cut`: with two years and an edition label after or
 * between them, the first year is the film's and the second the re-release's.
 * Returns the index of the original year, or `yearIndex` when the rule does not apply.
 */
function originalYearIndex(tokens: string[], yearIndex: number): number {
  let index = yearIndex - 1;
  while (index > 0 && EDITION_TOKEN_RE.test(tokens[index]!) && !YEAR_TOKEN_RE.test(tokens[index]!))
    index--;
  if (index <= 0 || !YEAR_TOKEN_RE.test(tokens[index]!)) return yearIndex;
  if (Number.parseInt(tokens[index]!, 10) >= Number.parseInt(tokens[yearIndex]!, 10))
    return yearIndex;
  const editionBetween = yearIndex - index > 1;
  const editionAfter = EDITION_LEAD_TOKEN_RE.test(tokens[yearIndex + 1] ?? '');
  return editionBetween || editionAfter ? index : yearIndex;
}

function inferMovieIdentity(
  name: string,
  seasonEpisode: { season: number | null; episode: number | null; isPack: boolean },
): { releaseYear: number | null; titleSlug: string | null } {
  if (looksLikeTvRelease(name, seasonEpisode) || extractAirDate(name)) {
    return { releaseYear: null, titleSlug: null };
  }

  const trimmed = stripContainerExtension(name.trim());
  const tokens = (
    LEADING_BRACKET_TITLE_RE.test(trimmed) ? trimmed : trimmed.replace(LEADING_BRACKET_TAG_RE, '')
  )
    .split(/[.\s_\-()[\]]+/)
    .filter((token) => token && !TITLE_STOP_TOKEN_RE.test(token));
  // Tags only end the search after a year candidate: a title word that reads like
  // a tag (Madame.Web.2024, Dual.2022, Internal.Affairs.1990) must not hide its year.
  const firstYearIndex = tokens.findIndex((token) => YEAR_TOKEN_RE.test(token));
  const firstTagIndex =
    firstYearIndex < 0
      ? -1
      : tokens.findIndex(
          (token, index) => index > firstYearIndex && RELEASE_TAG_TOKEN_RE.test(token),
        );
  const searchEndIndex = firstTagIndex < 0 ? tokens.length : firstTagIndex;

  let yearTokenIndex = -1;
  for (let index = searchEndIndex - 1; index > 0; index--) {
    if (YEAR_TOKEN_RE.test(tokens[index] ?? '')) {
      yearTokenIndex = index;
      break;
    }
  }
  if (yearTokenIndex <= 0) {
    return { releaseYear: null, titleSlug: null };
  }
  yearTokenIndex = originalYearIndex(tokens, yearTokenIndex);

  const releaseYear = Number.parseInt(tokens[yearTokenIndex]!, 10);
  const titleSlug = normalizeTitleSlug(tokens.slice(0, yearTokenIndex).join(''));
  if (!titleSlug || titleSlug.length < 2) {
    return { releaseYear: null, titleSlug: null };
  }
  return { releaseYear, titleSlug };
}

export function parseReleaseName(name: string): ParsedRelease {
  const lower = name.toLowerCase();
  const flags = extractFlags(lower);

  const seasonEpisode = inferSeasonEpisode(name);
  const group = extractGroup(name);
  const normalizedGroup = group ? normalizeGroup(group) : null;

  const resolution = extractResolution(lower);
  const source = extractSource(lower);
  const treatment = extractTreatment(lower);
  // A provider tag inside the trailing -GROUP (GROUP.CN) is part of the group name, not the source.
  const groupStartIndex = group ? name.lastIndexOf(`-${group}`) : -1;
  const webProvider = extractWebProvider(
    groupStartIndex > 0 ? name.slice(0, groupStartIndex) : name,
    source,
  );
  const webDelivery = extractWebDelivery(lower);
  const hdrDv = extractHdrDv(lower);
  const encoder = extractEncoder(lower);
  const datedTv = inferDatedTvIdentity(name, seasonEpisode);
  const movie = inferMovieIdentity(name, seasonEpisode);
  const titleSlug =
    datedTv?.showSlug ??
    movie.titleSlug ??
    (looksLikeTvRelease(name, seasonEpisode) ? inferTvShowSlug(name) : null);

  return {
    season: seasonEpisode.season,
    episode: seasonEpisode.episode,
    episodeEnd: seasonEpisode.episodeEnd,
    isPack: seasonEpisode.isPack,
    packKind: seasonEpisode.packKind,
    part: extractSeasonPart(name),
    seasonNumeral:
      !datedTv && !movie.titleSlug && looksLikeTvRelease(name, seasonEpisode)
        ? inferSeasonNumeral(name, seasonEpisode)
        : null,

    group,
    normalizedGroup,
    collective: group ? extractReleaseCollective(name) : null,

    source,
    treatment,
    webProvider,
    webDelivery,
    resolution,
    hdrDv,
    encoder,

    flags,

    releaseYear: datedTv ? null : movie.releaseYear,
    titleSlug,
    airDate: datedTv?.airDate ?? null,
  };
}
