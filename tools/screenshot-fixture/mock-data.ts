import type { Result } from '../../src/contracts/search.js';
import { PARODY_TRACKERS } from './trackers.js';

function getTracker(name: string) {
  const t = PARODY_TRACKERS.find((item) => item.name === name);
  if (!t) throw new Error(`Tracker ${name} not found`);
  return t;
}

export const MOCK_SEARCH_QUERY = 'Frasier S03';

export const MOCK_SEARCH_RESULTS: Result[] = [
  // Group 1: 1080p BluRay Remux - Group: NERVOSA (Cafe Nervosa)
  // Cross-matched across SeedLagoon, WaifuBytes, CyberCore
  {
    guid: 'sl-frasier-101',
    indexerId: getTracker('SeedLagoon').id,
    indexer: getTracker('SeedLagoon').name,
    title: 'Frasier.S03.1080p.BluRay.Remux.AVC.DTS-HD.MA.2.0-NERVOSA',
    size: 36_400_000_000,
    seeders: 58,
    infoHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    infoUrl: 'https://seedlagoon.example/torrents/101',
    categories: [{ id: 5000, name: 'TV' }],
    indexerFlags: ['Freeleech'],
  },
  {
    guid: 'wb-frasier-201',
    indexerId: getTracker('WaifuBytes').id,
    indexer: getTracker('WaifuBytes').name,
    title: 'Frasier.S03.1080p.BluRay.Remux.AVC.DTS-HD.MA.2.0-NERVOSA',
    size: 36_400_000_000,
    seeders: 94,
    infoHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    infoUrl: 'https://waifubytes.example/torrents/201',
    categories: [{ id: 5000, name: 'TV' }],
    indexerFlags: ['Freeleech'],
  },
  {
    guid: 'cc-frasier-301',
    indexerId: getTracker('CyberCore').id,
    indexer: getTracker('CyberCore').name,
    title: 'Frasier.S03.1080p.BD.Remux.AVC.DTS-HD-NERVOSA',
    size: 36_420_000_000,
    seeders: 23,
    infoHash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    infoUrl: 'https://cybercore.example/torrents/301',
    categories: [{ id: 5000, name: 'TV' }],
  },

  // Group 2: 1080p WEB-DL - Group: CRANE (Dr. Frasier Crane)
  // Cross-matched across SeedLagoon, 3AMPre, ApexPeak
  {
    guid: 'sl-frasier-102',
    indexerId: getTracker('SeedLagoon').id,
    indexer: getTracker('SeedLagoon').name,
    title: 'Frasier.S03.1080p.WEB-DL.DDP2.0.x264-CRANE',
    size: 18_200_000_000,
    seeders: 41,
    infoHash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
    infoUrl: 'https://seedlagoon.example/torrents/102',
    categories: [{ id: 5000, name: 'TV' }],
    indexerFlags: ['Freeleech'],
  },
  {
    guid: '3am-frasier-401',
    indexerId: getTracker('3AMPre').id,
    indexer: getTracker('3AMPre').name,
    title: 'Frasier.S03.1080p.WEB-DL.DDP2.0.x264-CRANE',
    size: 18_200_000_000,
    seeders: 17,
    infoHash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
    infoUrl: 'https://3ampre.example/torrents/401',
    categories: [{ id: 5000, name: 'TV' }],
  },
  {
    guid: 'apx-frasier-501',
    indexerId: getTracker('ApexPeak').id,
    indexer: getTracker('ApexPeak').name,
    title: 'Frasier.S03.1080p.WEB-DL.DDP2.0.H264-CRANE',
    size: 18_200_000_000,
    seeders: 31,
    infoHash: 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1',
    infoUrl: 'https://apexpeak.example/torrents/501',
    categories: [{ id: 5000, name: 'TV' }],
  },

  // Group 3: 720p WEB-DL - Group: KACL (780 AM KACL Seattle)
  // Cross-matched across SeedLagoon, 3AMPre, ApexPeak
  {
    guid: 'sl-frasier-103',
    indexerId: getTracker('SeedLagoon').id,
    indexer: getTracker('SeedLagoon').name,
    title: 'Frasier.S03.720p.WEB-DL.AAC2.0.x264-KACL',
    size: 9_100_000_000,
    seeders: 26,
    infoHash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    infoUrl: 'https://seedlagoon.example/torrents/103',
    categories: [{ id: 5000, name: 'TV' }],
    indexerFlags: ['Freeleech'],
  },
  {
    guid: '3am-frasier-402',
    indexerId: getTracker('3AMPre').id,
    indexer: getTracker('3AMPre').name,
    title: 'Frasier.S03.720p.WEB-DL.AAC2.0.x264-KACL',
    size: 9_100_000_000,
    seeders: 12,
    infoHash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    infoUrl: 'https://3ampre.example/torrents/402',
    categories: [{ id: 5000, name: 'TV' }],
  },
  {
    guid: 'apx-frasier-502',
    indexerId: getTracker('ApexPeak').id,
    indexer: getTracker('ApexPeak').name,
    title: 'Frasier.S03.720p.WEB-DL.AAC2.0.H264-KACL',
    size: 9_100_000_000,
    seeders: 19,
    infoHash: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    infoUrl: 'https://apexpeak.example/torrents/502',
    categories: [{ id: 5000, name: 'TV' }],
  },
];

export const MOCK_RECENT_HISTORY = [
  {
    query: 'Frasier S03',
    at: Date.now() - 1000 * 60 * 15,
    mode: 'enriched',
    selection: {
      key: 'sonarr:2001',
      title: 'Frasier',
      kind: 'sonarr',
      id: 2001,
      year: 1993,
      seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    },
  },
  {
    query: 'Dungeon Meshi',
    at: Date.now() - 1000 * 60 * 60 * 2,
    mode: 'text',
  },
  {
    query: 'Severance S01',
    at: Date.now() - 1000 * 60 * 60 * 24,
    mode: 'text',
  },
];

export const MOCK_STATISTICS = {
  counts: {
    searches: 86,
    indexers: PARODY_TRACKERS.length,
    groups: 240,
    matches: 512,
  },
  timings: [
    { operation: 'search_live', count: 54, mean: 320, median: 295, p75: 360, p90: 410, p95: 470, min: 180, max: 610 },
    { operation: 'search_cached', count: 180, mean: 12, median: 9, p75: 14, p90: 19, p95: 24, min: 3, max: 42 },
    { operation: 'lookup_live', count: 48, mean: 115, median: 105, p75: 130, p90: 155, p95: 180, min: 65, max: 230 },
    { operation: 'prowlarr_request', count: 54, mean: 290, median: 270, p75: 320, p90: 380, p95: 430, min: 160, max: 540 },
  ],
  overlap: [
    { aId: 1, bId: 4, a: 'SeedLagoon', b: 'WaifuBytes', total: 214, evidence: 'hash' },
    { aId: 1, bId: 6, a: 'SeedLagoon', b: 'CyberCore', total: 128, evidence: 'release' },
    { aId: 4, bId: 6, a: 'WaifuBytes', b: 'CyberCore', total: 95, evidence: 'release' },
    { aId: 5, bId: 8, a: '3AMPre', b: 'ApexPeak', total: 72, evidence: 'hash' },
    { aId: 1, bId: 5, a: 'SeedLagoon', b: '3AMPre', total: 58, evidence: 'release' },
    { aId: 2, bId: 3, a: 'Eurydice', b: 'MySecretHamster', total: 41, evidence: 'release' },
    { aId: 6, bId: 7, a: 'CyberCore', b: 'VoxelBay', total: 34, evidence: 'release' },
  ],
};

export const MOCK_TITLE_LOOKUP_MATCHES = [
  {
    key: 'sonarr:2001',
    title: 'Frasier',
    originalTitle: 'Frasier',
    aliases: ['Tossed Salads and Scrambled Eggs', 'Dr. Frasier Crane'],
    year: 1993,
    kind: 'sonarr',
    id: 2001,
    directMatch: true,
    seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  {
    key: 'sonarr:2002',
    title: 'Frasier (2023)',
    originalTitle: 'Frasier (2023)',
    aliases: ['Frasier Revival'],
    year: 2023,
    kind: 'sonarr',
    id: 2002,
    directMatch: false,
    seasons: [1, 2],
  },
  {
    key: 'sonarr:2003',
    title: 'Cheers',
    originalTitle: 'Cheers',
    aliases: ['Where Everybody Knows Your Name'],
    year: 1982,
    kind: 'sonarr',
    id: 2003,
    directMatch: false,
    seasons: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
];
