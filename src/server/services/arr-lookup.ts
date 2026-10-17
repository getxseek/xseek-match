import type { IntegrationKind } from '../../integration-capabilities.js';
import { posterUrl } from '../lib/media-titles.js';
import type { ConnectionRecord as Connection } from '../storage/integrations-store.js';
import { requestConnection } from './connection-client.js';

export type ArrLookupResult = {
  key: string;
  title: string;
  originalTitle: string | undefined;
  year: number | null;
  kind: IntegrationKind;
  id: number;
  source: string;
  imdb: string | undefined;
  poster: string | undefined;
  seasons: number[];
};

type ArrConnection = Pick<Connection, 'kind' | 'baseUrl' | 'apiKey' | 'name'>;

const MAX_LOOKUP_ROWS = 20;
const MAX_TITLE_LENGTH = 200;
const IMDB_ID = /^tt\d{1,12}$/;

function distinctOriginalTitle(row: any): string | undefined {
  const isDistinct =
    typeof row.originalTitle === 'string' &&
    row.originalTitle.trim().toLowerCase() !== row.title.trim().toLowerCase();
  return isDistinct ? row.originalTitle.trim().slice(0, MAX_TITLE_LENGTH) : undefined;
}

function rowPoster(row: any): string | undefined {
  const posterImage = Array.isArray(row.images)
    ? row.images.find((image: any) => image.coverType === 'poster')?.remoteUrl
    : undefined;
  return posterUrl(row.remotePoster) || posterUrl(posterImage);
}

function sonarrSeasons(row: any): number[] {
  if (!Array.isArray(row.seasons)) return [];
  return row.seasons
    .map((season: any) => season.seasonNumber)
    .filter(
      (seasonNumber: unknown) => Number.isSafeInteger(seasonNumber) && Number(seasonNumber) > 0,
    )
    .slice(0, 100);
}

function toLookupResult(row: any, connection: ArrConnection): ArrLookupResult | undefined {
  const externalId = connection.kind === 'sonarr' ? row.tvdbId : row.tmdbId;
  if (typeof row.title !== 'string' || !Number.isSafeInteger(externalId) || externalId <= 0) {
    return undefined;
  }
  return {
    key: `${connection.kind}:${externalId}`,
    title: row.title.slice(0, MAX_TITLE_LENGTH),
    originalTitle: distinctOriginalTitle(row),
    year: Number.isInteger(row.year) ? row.year : null,
    kind: connection.kind,
    id: externalId,
    source: connection.name,
    imdb: typeof row.imdbId === 'string' && IMDB_ID.test(row.imdbId) ? row.imdbId : undefined,
    poster: rowPoster(row),
    seasons: connection.kind === 'sonarr' ? sonarrSeasons(row) : [],
  };
}

/** Searches one Sonarr (series) or Radarr (movie) instance by title. */
export async function lookupArr(
  connection: ArrConnection,
  title: string,
): Promise<ArrLookupResult[]> {
  const resource = connection.kind === 'sonarr' ? 'series' : 'movie';
  const data = await requestConnection(
    connection,
    `/api/v3/${resource}/lookup?term=${encodeURIComponent(title)}`,
  );
  if (!Array.isArray(data)) throw new Error('Unexpected title lookup response.');

  return data
    .slice(0, MAX_LOOKUP_ROWS)
    .map((row) => toLookupResult(row, connection))
    .filter((result): result is ArrLookupResult => result !== undefined);
}
