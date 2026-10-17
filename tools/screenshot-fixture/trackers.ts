export interface ParodyTracker {
  id: number;
  realName: string;
  name: string;
  abbr: string;
  categories: string[];
  isPrimary?: boolean;
}

export const PARODY_TRACKERS: ParodyTracker[] = [
  // Primaries
  {
    id: 1,
    realName: 'Seedpool',
    name: 'SeedLagoon',
    abbr: 'SL',
    categories: ['Anime', 'TV', 'Movies'],
    isPrimary: true,
  },
  {
    id: 2,
    realName: 'Orpheus',
    name: 'Eurydice',
    abbr: 'EURY',
    categories: ['Music', 'Audio'],
    isPrimary: true,
  },
  {
    id: 3,
    realName: 'MyAnonaMouse',
    name: 'MySecretHamster',
    abbr: 'MSH',
    categories: ['Books', 'Audiobooks'],
    isPrimary: true,
  },
  {
    id: 4,
    realName: 'AnimeBytes',
    name: 'WaifuBytes',
    abbr: 'WB',
    categories: ['Anime', 'Manga'],
    isPrimary: true,
  },
  // Secondaries & References
  {
    id: 5,
    realName: 'MidnightScene',
    name: '3AMPre',
    abbr: '3AM',
    categories: ['TV', 'Movies'],
  },
  {
    id: 6,
    realName: 'DigitalCore',
    name: 'CyberCore',
    abbr: 'CC',
    categories: ['General', '0day'],
  },
  {
    id: 7,
    realName: 'PixelCove',
    name: 'VoxelBay',
    abbr: 'VB',
    categories: ['Games', 'Apps', '3D'],
  },
  {
    id: 8,
    realName: 'Zenith',
    name: 'ApexPeak',
    abbr: 'APX',
    categories: ['TV', 'Movies'],
  },
];

export function getTrackerDefinitionsPayload() {
  return {
    at: Date.now(),
    trackers: PARODY_TRACKERS.map((t) => ({
      Name: t.name,
      Abbreviation: t.abbr,
    })),
    nextAt: Date.now() + 86_400_000,
  };
}

export function getIndexersPayload() {
  return {
    message: `${PARODY_TRACKERS.length} available`,
    trackers: PARODY_TRACKERS.map((t) => ({
      id: t.id,
      name: t.name,
      available: true,
      categories: t.categories,
    })),
  };
}
