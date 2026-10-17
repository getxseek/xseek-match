export type IntegrationKind = 'sonarr' | 'radarr' | 'qui';
export type IntegrationCapability =
  | 'tv-title-lookup'
  | 'movie-title-lookup'
  | 'season-selection'
  | 'library-aliases'
  | 'torrent-clients'
  | 'torrent-presence';
export const integrationCapabilities: Record<IntegrationKind, readonly IntegrationCapability[]> = {
  sonarr: ['tv-title-lookup', 'season-selection', 'library-aliases'],
  radarr: ['movie-title-lookup'],
  qui: ['torrent-clients', 'torrent-presence'],
};
export function enabledCapabilities(
  connections: { kind: IntegrationKind; enabled: boolean }[],
): IntegrationCapability[] {
  return [
    ...new Set(
      connections.filter((c) => c.enabled).flatMap((c) => integrationCapabilities[c.kind]),
    ),
  ];
}
