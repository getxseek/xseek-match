/**
 * Release-name parser types — derived from detect-core v4 (detect-core:9bd5477) and
 * trimmed to the fields consumed by xseek-match.
 */
import type { ReleaseTreatment } from './vocabulary.js';
import type { WebDelivery } from './web-providers.js';

/** season = one season (S01); range = episode span in one season; season-range = S01-S07 box sets */
export type PackKind = 'season' | 'range' | 'season-range' | null;

export type ReleaseFlags = {
  proper: boolean;
  repack: boolean;
};

export type ParsedRelease = {
  // Season/episode (filename-first)
  season: number | null;
  /** Episode, or the first episode of a range pack (S01E01-E03). Null for whole-season packs. */
  episode: number | null;
  /** Last episode: dual-ep in one file (S01E21E22) or the end of a range pack (S01E01-E03). */
  episodeEnd: number | null;
  isPack: boolean;
  packKind: PackKind;
  /** Split-season part (`S01 Part 2`); Part 1 and Part 2 are different packs. Null when unstated. */
  part?: number | null;

  // Identity / matching
  group: string | null; // extracted group (un-normalized)
  normalizedGroup: string | null;

  // Product slice tags
  source: string | null; // WEB-DL, BluRay, HDTV, ...
  /**
   * What was done to the source, where the name says so. A BluRay remux is
   * `source: "BLURAY"` with `treatment: "remux"`: remux is a property of a
   * disc source, not an alternative to it. `null` means the name did not say,
   * which is not the same as `encode`.
   */
  treatment?: ReleaseTreatment | null;
  /** Streaming origin when present (AMZN, PMTP, NF, …). Null for BluRay/HDTV/Remux. */
  webProvider: string | null;
  /** WEB-DL vs WEBRip vs group web re-encode (`.WEB.H265`). */
  webDelivery: WebDelivery | null;
  resolution: string | null; // 720p, 1080p, 2160p, ...
  hdrDv: string | null; // DV, HDR, HDR10, ...
  encoder: string | null; // x264, H264, x265, H265, AV1 ...

  flags: ReleaseFlags;

  /** Movie release year (null for TV). */
  releaseYear: number | null;
  /** Stable title slug for cross-match keys: movie title, TV show, or dated-TV show name. */
  titleSlug: string | null;

  /** Daily/dated TV air date (e.g. Jeopardy! 2026-05-28). */
  airDate: string | null;
};
