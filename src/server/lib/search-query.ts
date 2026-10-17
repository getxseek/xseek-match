// Prowlarr parses these tokens from query for tvsearch/movie requests.
export function prowlarrQuery(params: URLSearchParams, queryText: string) {
  const kind = params.get('kind');
  const rawId = params.get('id');
  const numbering = params.get('numbering') || 'tvdb';

  if (!['tvdb', 'release'].includes(numbering) || (numbering === 'release' && kind !== 'sonarr')) {
    throw new Error('Invalid numbering');
  }

  if (!kind && !rawId) {
    return { type: 'search', query: queryText };
  }

  const id = Number(rawId);
  const isValidSelection =
    ['sonarr', 'radarr'].includes(kind || '') &&
    Boolean(rawId) &&
    /^\d+$/.test(rawId!) &&
    Number.isSafeInteger(id) &&
    id >= 1 &&
    id <= 2_147_483_647;

  if (!isValidSelection) {
    throw new Error('Invalid selected title.');
  }

  const imdb = params.get('imdb');
  if (imdb && !/^tt\d{1,12}$/.test(imdb)) {
    throw new Error('Invalid IMDb identifier.');
  }

  const seasonEpisodeSuffix =
    kind === 'sonarr' ? queryText.match(/\s+S(\d{1,3})(?:E(\d{1,3}))?$/i) : null;
  const baseTitle = seasonEpisodeSuffix
    ? queryText.slice(0, seasonEpisodeSuffix.index).trim()
    : queryText;

  // Scene numbering is searched literally: structured IDs do not establish an episode-numbering contract.
  if (numbering === 'release') {
    return { type: 'search', query: queryText };
  }

  // Keep a title fallback for indexer adapters that cannot search the supplied IDs.
  const idTokenKey = kind === 'sonarr' ? 'tvdbid' : 'tmdbid';
  const tokens = [
    `{${idTokenKey}:${id}}`,
    ...(imdb ? [`{imdbid:${imdb}}`] : []),
    ...(seasonEpisodeSuffix
      ? [
          `{season:${Number(seasonEpisodeSuffix[1])}}`,
          ...(seasonEpisodeSuffix[2] ? [`{episode:${Number(seasonEpisodeSuffix[2])}}`] : []),
        ]
      : []),
  ];

  return {
    type: kind === 'sonarr' ? 'tvsearch' : 'movie',
    query: `${baseTitle} ${tokens.join(' ')}`,
  };
}
