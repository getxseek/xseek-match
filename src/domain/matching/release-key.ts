/**
 * Release lookup key construction — derived from xseek (xseek:78f9e8b).
 */
function normalizedTag(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export type ReleaseSlice = {
  season: number | null;
  episode: number | null;
  episodeEnd?: number | null;
  isPack: boolean;
  part?: number | null;
  resolution?: string | null;
  releaseYear?: number | null;
  titleSlug?: string | null;
  airDate?: string | null;
};

export function isMovieSlice(parts: ReleaseSlice): boolean {
  if (parts.airDate) return false;
  return (
    !parts.isPack &&
    parts.season == null &&
    parts.episode == null &&
    parts.releaseYear != null &&
    parts.titleSlug != null
  );
}

export function isDatedTvSlice(
  parts: Pick<ReleaseSlice, 'airDate' | 'titleSlug' | 'isPack'>,
): boolean {
  return !parts.isPack && Boolean(parts.airDate && parts.titleSlug);
}

export function isEpisodeSlice(parts: ReleaseSlice): boolean {
  if (parts.isPack || isDatedTvSlice(parts) || isMovieSlice(parts)) return false;
  return parts.season != null || parts.episode != null;
}

/** Stable lookup key for matching evidence. It is not a universal release identity. */
export function releaseLookupKey(
  parts: ReleaseSlice & { normalizedGroup: string | null },
): string | null {
  const group = parts.normalizedGroup?.trim();
  const resolution = normalizedTag(parts.resolution);
  if (!group || !resolution) return null;

  let slice: string;
  if (parts.isPack) {
    const slug = parts.titleSlug?.trim();
    if (!slug) return null;
    slice = parts.season != null ? `pack:${slug}:S${parts.season}` : `pack:${slug}`;
    // Range packs (S01E01-E03) and split seasons (S01 Part 2) are different packs from the whole season.
    if (parts.episode != null) slice += `:E${parts.episode}-E${parts.episodeEnd ?? '?'}`;
    if (parts.part != null) slice += `:P${parts.part}`;
  } else if (isDatedTvSlice(parts)) {
    slice = `date:${parts.titleSlug}:${parts.airDate}`;
  } else if (isMovieSlice(parts)) {
    slice = `movie:${parts.titleSlug}:${parts.releaseYear}`;
  } else if (isEpisodeSlice(parts)) {
    const slug = parts.titleSlug?.trim();
    if (!slug) return null;
    if (parts.episodeEnd != null && parts.season != null && parts.episode != null) {
      slice = `ep:${slug}:S${parts.season}E${parts.episode}E${parts.episodeEnd}`;
    } else {
      slice = `ep:${slug}:S${parts.season ?? '?'}E${parts.episode ?? '?'}`;
    }
  } else {
    return null;
  }
  return `${group}|${slice}|${resolution}`;
}
