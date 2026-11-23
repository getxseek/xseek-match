export const API_SCOPES = ['search:read', 'titles:read', 'indexers:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export interface PublicApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export const API_LIMITS = {
  bodyBytes: 16_384,
  queryMinCharacters: 2,
  queryMaxCharacters: 200,
  searchResults: 500,
  defaultSearchResults: 100,
  lookupResults: 50,
  defaultLookupResults: 10,
  selectedIndexers: 100,
  requestsPerMinute: 30,
  liveSearchAttemptsPerMinute: 5,
} as const;
