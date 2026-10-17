export type PosterSources = {
  /** A tiny image shown blurred while the real one loads. */
  preview?: string;
  full: string;
  /** Tried when `full` fails, e.g. a missing thumbnail. */
  fallback?: string;
};

const TMDB_SIZE_SEGMENT = /^\/t\/p\/[^/]+\//;
const TVDB_IMAGE = /^(.*?)(_t)?(\.(?:jpe?g|png|webp))$/i;

/**
 * Picks image sizes that fit a ~34px poster. Sonarr and Radarr hand out full-size artwork
 * (TMDB "original" is often ~1 MB); TMDB w45 is ~2.5 KB and w185 stays sharp on 3x screens.
 * TheTVDB has no tiny variant, but its "_t" thumbnail is about half the original's size.
 */
export function posterSources(url: string): PosterSources {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { full: url };
  }

  if (parsed.hostname === 'image.tmdb.org' && TMDB_SIZE_SEGMENT.test(parsed.pathname)) {
    const sized = (size: string) => {
      const next = new URL(parsed);
      next.pathname = parsed.pathname.replace(TMDB_SIZE_SEGMENT, `/t/p/${size}/`);
      return next.href;
    };
    return { preview: sized('w45'), full: sized('w185') };
  }

  const tvdb = parsed.hostname.endsWith('thetvdb.com') && parsed.pathname.match(TVDB_IMAGE);
  if (tvdb && !tvdb[2]) {
    const thumbnail = new URL(parsed);
    thumbnail.pathname = `${tvdb[1]}_t${tvdb[3]}`;
    return { full: thumbnail.href, fallback: url };
  }

  return { full: url };
}
