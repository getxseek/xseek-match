import { it, expect } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Integrations } from '../src/server/services/integrations-service';
import { probeConnection } from '../src/server/services/connection-client';
import {
  joinAccounts,
  parseYataSummary,
  parseYataTargets,
} from '../src/server/services/yata-service';
import {
  accountProblem,
  grabImpact,
  grabReasons,
  suggestedGrab,
  trackerHost,
  type TrackerAccount,
} from '../src/tracker-accounts';

const GIB = 1024 ** 3;
const token = `yata_${'e'.repeat(40)}`;

const summary = {
  version: 'Beta-20260921',
  totals: { trackers: 3 },
  trackers: [
    {
      id: '71bf71f14e7e02c3',
      name: 'TrackerAlpha',
      abbr: 'TA',
      url: 'https://www.Alpha-Tracker.example/',
      enabled: true,
      status: 'ok',
      group: 'Iron Fleet',
      ratio: 2,
      uploaded_gib: 1024,
      downloaded_gib: 512,
      buffer_gib: 512,
      seeding: 421,
      hit_and_runs: 0,
      updated_at: 1783958100,
      api_key: 'never-copied',
    },
    {
      id: 'aa',
      name: 'TrackerBeta',
      url: 'https://beta-tracker.example',
      status: 'error',
      error_kind: 'http_401',
      updated_at: 0,
    },
    { id: 'bb', name: 'Not in Prowlarr', url: 'https://elsewhere.example', status: 'ok' },
    { id: 'cc', name: 'Disabled', url: 'https://disabled.example', enabled: false },
    { id: 'dd', name: 'No url' },
  ],
};

const highlights = {
  targets: [
    { tracker_id: '71bf71f14e7e02c3', met: 4, total: 6, remaining: 2 },
    { tracker_id: 'broken', met: 'x' },
  ],
};

const indexers = [
  { id: 1, origin: 'https://alpha-tracker.example' },
  { id: 2, origin: 'https://beta-tracker.example' },
  { id: 3, origin: null },
];

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as { port: number }).port}`),
    ),
  );
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

function account(overrides: Partial<TrackerAccount> = {}): TrackerAccount {
  return {
    indexerId: 1,
    connection: 'Yata',
    name: 'Tracker',
    status: 'ok',
    ratio: 1.5,
    uploadedGib: 150,
    downloadedGib: 100,
    bufferGib: 50,
    updatedAt: 1,
    ...overrides,
  };
}

it('parses Yata trackers defensively and joins them to indexers by hostname', () => {
  const trackers = parseYataSummary(summary);
  expect(trackers.map((row) => row.name)).toEqual([
    'TrackerAlpha',
    'TrackerBeta',
    'Not in Prowlarr',
  ]);
  expect(JSON.stringify(trackers)).not.toContain('never-copied');
  expect(trackers[0]).toMatchObject({ host: 'alpha-tracker.example', ratio: 2, seeding: 421 });
  expect(trackers[1]).toMatchObject({ status: 'error', errorKind: 'http_401' });
  expect(() => parseYataSummary({})).toThrow();

  const targets = parseYataTargets(highlights);
  expect([...targets.keys()]).toEqual(['71bf71f14e7e02c3']);

  const joined = joinAccounts('Yata', trackers, targets, indexers);
  expect(joined.accounts.map((row) => [row.indexerId, row.name])).toEqual([
    [1, 'TrackerAlpha'],
    [2, 'TrackerBeta'],
  ]);
  expect(joined.accounts[0]!.target).toEqual({ met: 4, total: 6, remaining: 2 });
  expect(joined.unmatched).toEqual([{ connection: 'Yata', name: 'Not in Prowlarr' }]);
  expect(trackerHost('https://WWW.Example.org./path')).toBe('example.org');
});

it('reads accounts through a Yata connection with a bearer token and caches the summary', async () => {
  const seen: { path: string; auth?: string; agent?: string }[] = [];
  const yata = createServer((req, res) => {
    seen.push({
      path: req.url!,
      auth: req.headers.authorization,
      agent: req.headers['user-agent'],
    });
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end('{"error":"unauthorized"}');
      return;
    }
    if (req.url === '/api/summary') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(summary));
      return;
    }
    res.writeHead(404).end('{"error":"not_found"}');
  });
  const baseUrl = await listen(yata);
  const dir = mkdtempSync(join(tmpdir(), 'match-yata-'));
  const store = new Integrations(dir, probeConnection, async () => indexers);
  try {
    await expect(
      store.execute({ action: 'save', kind: 'yata', name: 'Yata', baseUrl, apiKey: 'wrong' }),
    ).rejects.toThrow('rejected');
    const saved = (await store.execute({
      action: 'save',
      kind: 'yata',
      name: 'Yata',
      baseUrl,
      apiKey: token,
    })) as { connection: { detail: string; capabilities: string[] } };
    expect(saved.connection.detail).toBe('Connected · 5 trackers');
    expect(saved.connection.capabilities).toEqual(['tracker-accounts']);

    const first = (await store.execute({ action: 'accounts' })) as {
      accounts: TrackerAccount[];
      unmatched: unknown[];
      failed: string[];
    };
    expect(first.accounts.map((row) => row.indexerId)).toEqual([1, 2]);
    // Highlights 404s on this server, so there are no targets rather than a failure.
    expect(first.accounts[0]!.target).toBeUndefined();
    expect(first.failed).toEqual([]);

    const requests = seen.length;
    await store.execute({ action: 'accounts' });
    expect(seen.length).toBe(requests);
    expect(seen.every((row) => row.agent?.startsWith('xseek'))).toBe(true);
  } finally {
    await store.close();
    await close(yata);
    rmSync(dir, { recursive: true, force: true });
  }
});

it('reports grab impact against buffer and ratio, and nothing for freeleech', () => {
  const impact = grabImpact(account(), 60 * GIB, false)!;
  expect(impact.overBuffer).toBe(true);
  expect(impact.bufferAfterGib).toBeCloseTo(-10);
  expect(impact.ratioAfter).toBeCloseTo(150 / 160);
  expect(grabImpact(account(), 10 * GIB, false)!.overBuffer).toBe(false);
  expect(grabImpact(account(), 60 * GIB, true)).toBeNull();
  expect(grabImpact(account({ bufferGib: undefined }), 60 * GIB, false)!.overBuffer).toBe(false);
});

it('suggests one row only when it clearly beats the others', () => {
  const row = (indexerId: number, flags: string[] = []) => ({
    guid: String(indexerId),
    title: 'Show.S01.1080p.WEB-DL-GRP',
    indexerId,
    indexer: `T${indexerId}`,
    size: 60 * GIB,
    indexerFlags: flags,
  });
  const accounts = {
    1: account({ indexerId: 1 }),
    2: account({ indexerId: 2, bufferGib: 500 }),
  };

  expect(grabReasons(accounts[1], 60 * GIB, false).map((reason) => reason.score)).toEqual([-3]);
  expect(suggestedGrab([row(1, ['freeleech']), row(2)], accounts)!.row.indexerId).toBe(1);
  expect(suggestedGrab([row(1), row(2)], accounts)).toBeNull();
  expect(
    suggestedGrab([row(1), row(2)], {
      ...accounts,
      2: account({ indexerId: 2, bufferGib: 500, target: { met: 1, total: 3, remaining: 2 } }),
    })!.row.indexerId,
  ).toBe(2);
  expect(suggestedGrab([row(1, ['freeleech'])], accounts)).toBeNull();
});

it('describes Yata refresh failures briefly', () => {
  expect(accountProblem(account({ status: 'error', errorKind: 'http_401' }))).toBe(
    'API returned 401',
  );
  expect(accountProblem(account({ status: 'error', errorKind: 'timeout' }))).toBe('API timed out');
  expect(accountProblem(account())).toBeNull();
});
