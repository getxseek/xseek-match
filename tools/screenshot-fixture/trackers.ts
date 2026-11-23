export interface ParodyTracker {
  id: number;
  name: string;
  abbr: string;
  categories: string[];
  isPrimary?: boolean;
}

// Your own real-to-mock map: copy real-names.example.json to .local/screenshot-fixture/real-names.json (gitignored).
export const PARODY_TRACKERS: ParodyTracker[] = [
  // Primaries
  {
    id: 1,
    name: 'SeedLagoon',
    abbr: 'SL',
    categories: ['Anime', 'TV', 'Movies'],
    isPrimary: true,
  },
  {
    id: 2,
    name: 'Eurydice',
    abbr: 'EURY',
    categories: ['Music', 'Audio'],
    isPrimary: true,
  },
  {
    id: 3,
    name: 'MySecretHamster',
    abbr: 'MSH',
    categories: ['Books', 'Audiobooks'],
    isPrimary: true,
  },
  {
    id: 4,
    name: 'WaifuBytes',
    abbr: 'WB',
    categories: ['Anime', 'Manga'],
    isPrimary: true,
  },
  // Secondaries & References
  {
    id: 5,
    name: '3AMPre',
    abbr: '3AM',
    categories: ['TV', 'Movies'],
  },
  {
    id: 6,
    name: 'CyberCore',
    abbr: 'CC',
    categories: ['General', '0day'],
  },
  {
    id: 7,
    name: 'VoxelBay',
    abbr: 'VB',
    categories: ['Games', 'Apps', '3D'],
  },
  {
    id: 8,
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
