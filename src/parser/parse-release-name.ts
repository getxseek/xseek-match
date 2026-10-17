/**
 * Release-name parser — derived from detect-core v4 (detect-core:9bd5477) and
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

function normalizeGroup(group: string): string {
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

function prepareNameForGroupExtraction(raw: string): string {
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
    /\b(H\.?264|H\.?265|HEVC|X264|X265|AV1|AAC|AC3|EAC3|DDP|FLAC|OPUS|ATmos|10bit|8bit)\b/i.test(
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
function extractBracketReleaseGroup(raw: string): string | null {
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

  return null;
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
    if (/\bhdr\b/.test(lower) || lower.includes('hdr10')) return 'DV.HDR';
    return 'DV';
  }
  if (lower.includes('hdr10+') || lower.includes('hdr10plus')) return 'HDR10+';
  if (lower.includes('hdr10')) return 'HDR10';
  if (/\bhdr\b/.test(lower)) return 'HDR';
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
  | { season: number; episode: null; episodeEnd: null; isPack: true; packKind: 'season-range' }
  | { season: null; episode: null; episodeEnd: null; isPack: false; packKind: null };

/** Anime re-release marker glued to an episode or season number (E05v2, S01v2, - 05v2). */
const VERSION_SUFFIX = String.raw`(?:v\d)?`;

/** Leading `[Group]` tag, as on anime releases. */
const LEADING_BRACKET_TAG_RE = /^\s*\[[^\]]{1,48}\]\s*/;

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
const SEASON_RANGE_RE = /(?:^|[.\s_-])s(\d{1,2})\s*[-–]\s*s(\d{1,2})(?:$|[.\s_-])/i;
const EPISODE_SPAN_WITHOUT_SEASON_RE =
  /(?:^|[.\s_-])e\d{1,3}[.\s_-]*-[.\s_-]*e?\d{1,3}(?:$|[.\s_-])/i;
const LEADING_SEASON_TOKEN_RE = /(?:^|[.\s_-])s(\d{1,2})/i;
const SEASON_PACK_RE = new RegExp(
  String.raw`(?:^|[.\s_-])s(\d{1,2})${VERSION_SUFFIX}(?!\d*[.\s_-]*e\d)(?:$|[.\s_-])`,
  'i',
);
const SPELLED_SEASON_PACK_RE =
  /(?:^|[.\s_-])season[.\s_-]*(\d{1,2})(?!\d*[.\s_-]*e(?:pisode)?[.\s_-]*\d)(?:$|[.\s_-])/i;

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
  const spelledSeasonPack = matchSeasonPack(name, SPELLED_SEASON_PACK_RE);
  if (spelledSeasonPack) return spelledSeasonPack;

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
  /(?:^|[.\s_-])season[.\s_-]*\d{1,2}(?:$|[.\s_-])/i,
] as const;

const ANIME_SLUG_CUT_PATTERN = /\s-\s\d{1,4}(?:v\d)?(?=$|[\s[(.])/i;

/** Text before first Sxx / SxxExx / 2x06 / Season N / anime ` - 05` token → show slug (TV packs and episodes). */
function inferTvShowSlug(name: string): string | null {
  const isBracketed = LEADING_BRACKET_TAG_RE.test(name);
  const body = name.replace(LEADING_BRACKET_TAG_RE, '');
  const patterns = isBracketed
    ? [...TV_SHOW_SLUG_CUT_PATTERNS, ANIME_SLUG_CUT_PATTERN]
    : TV_SHOW_SLUG_CUT_PATTERNS;

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

  const showSlug = normalizeTitleSlug(titlePrefix);
  if (!showSlug || showSlug.length < 2) return null;
  return showSlug;
}

/** First token that is a release tag, not part of a title (resolution, source, codec, …). */
const RELEASE_TAG_TOKEN_RE =
  /^(?:\d{3,4}[pi]|4k|uhd|bluray|blu|bdrip|brrip|bdremux|remux|web|webdl|webrip|hdtv|hdrip|dvdrip|dvd\d?|x26[45]|h26[45]|hevc|avc|av1|xvid|proper|repack|internal|hybrid|multi|dual)$/i;

/**
 * Parse movie title + year from scene-style names (e.g. Title.Words.1972.1080p…).
 * The release year is the last year before the release tags, so a year in the title stays in the
 * title: Blade.Runner.2049.2017 is "bladerunner2049" (2017), 1917.2019 is "1917" (2019).
 */
function inferMovieIdentity(
  name: string,
  seasonEpisode: { season: number | null; episode: number | null; isPack: boolean },
): { releaseYear: number | null; titleSlug: string | null } {
  if (looksLikeTvRelease(name, seasonEpisode) || extractAirDate(name)) {
    return { releaseYear: null, titleSlug: null };
  }

  const tokens = stripContainerExtension(name.trim())
    .replace(LEADING_BRACKET_TAG_RE, '')
    .split(/[.\s_\-()[\]]+/)
    .filter(Boolean);
  const firstTagIndex = tokens.findIndex(
    (token, index) => index > 0 && RELEASE_TAG_TOKEN_RE.test(token),
  );
  const searchEndIndex = firstTagIndex < 0 ? tokens.length : firstTagIndex;

  let yearTokenIndex = -1;
  for (let index = searchEndIndex - 1; index > 0; index--) {
    if (/^(19\d{2}|20\d{2})$/.test(tokens[index] ?? '')) {
      yearTokenIndex = index;
      break;
    }
  }
  if (yearTokenIndex <= 0) {
    return { releaseYear: null, titleSlug: null };
  }

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

    group,
    normalizedGroup,

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
