/**
 * Release-name vocabulary tables and types — derived from detect-core v4 (detect-core:9bd5477).
 */

/** Emitted lower-case, exactly as written here. */
export const RESOLUTIONS = [
  '480p',
  '576p',
  '720p',
  '1080p',
  '1080i',
  '1440p',
  '2160p',
  '4320p',
] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Source aliases in match order: the first alias found in a lower-cased name
 * wins, so `web-dl` must precede `web` and `uhdrip` must precede `hdrip`.
 * Full DVD discs (`DVD5`, `DVD9`) are matched by word in the parser, since `dvd`
 * alone is a substring of `dvdrip`.
 */
export const SOURCE_ALIASES: ReadonlyArray<readonly [alias: string, source: Source]> = [
  ['web-dl', 'WEB-DL'],
  ['webdl', 'WEB-DL'],
  ['webrip', 'WEBRIP'],
  ['web', 'WEB'],
  ['bluray', 'BLURAY'],
  ['blu-ray', 'BLURAY'],
  ['bdremux', 'BLURAY'],
  ['bdrip', 'BDRIP'],
  ['brrip', 'BDRIP'],
  ['uhdrip', 'BDRIP'],
  ['hdrip', 'HDRIP'],
  ['hdtv', 'HDTV'],
  ['dvdrip', 'DVDRIP'],
];

export type Source =
  'WEB-DL' | 'WEBRIP' | 'WEB' | 'BLURAY' | 'BDRIP' | 'HDRIP' | 'HDTV' | 'DVDRIP' | 'DVD';

/**
 * Video codec aliases, matched as whole words; `h.264` and `h 264` also match `h264`.
 * `avc` is untouched H.264 (as on remuxes), so it maps to H264 like `hevc` maps to H265.
 */
export const ENCODER_ALIASES: ReadonlyArray<readonly [alias: string, encoder: Encoder]> = [
  ['av1', 'AV1'],
  ['x264', 'X264'],
  ['h264', 'H264'],
  ['x265', 'X265'],
  ['h265', 'H265'],
  ['hevc', 'H265'],
  ['avc', 'H264'],
  ['xvid', 'XVID'],
  ['vc-1', 'VC1'],
  ['vc1', 'VC1'],
  ['mpeg-2', 'MPEG2'],
  ['mpeg2', 'MPEG2'],
];

export type Encoder = 'AV1' | 'X264' | 'H264' | 'X265' | 'H265' | 'XVID' | 'VC1' | 'MPEG2';

/** High-dynamic-range labels, most specific first. */
export type HdrFormat = 'DV.HDR' | 'DV' | 'HDR10+' | 'HDR10' | 'HDR';

/**
 * What was done to the source. It is separate from `Source`, because a remux
 * and an encode can share one source.
 */
export const TREATMENT_ALIASES: ReadonlyArray<
  readonly [alias: string, treatment: ReleaseTreatment]
> = [
  ['remux', 'remux'],
  ['full disc', 'full_disc'],
  ['full-disc', 'full_disc'],
  ['complete bluray', 'full_disc'],
  ['bdremux', 'remux'],
];

export type ReleaseTreatment = 'encode' | 'remux' | 'full_disc' | 'rip';
