import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreferencesStore, PreferenceConflict } from '../src/server/storage/preferences-store';
import { migrate } from '../src/server/storage/migrations';
import { atomicJson, pruneSearchCache } from '../src/server/storage/cache-files';
import { TrackerDefinitions } from '../src/server/services/tracker-definitions-service';
import { StatisticsStore } from '../src/server/storage/statistics-store';

it('migrates a legacy preferences database without replacing saved values and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    "CREATE TABLE preferences(key TEXT PRIMARY KEY,value TEXT);INSERT INTO preferences VALUES ('fixture','saved')",
  );
  migrate(db);
  migrate(db);
  expect(db.prepare('SELECT value FROM preferences').get()?.value).toBe('saved');
  expect(db.prepare('SELECT count(*) AS n FROM schema_migrations').get()?.n).toBe(1);
  db.close();
});
it('refuses a newer database version', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER);INSERT INTO schema_migrations VALUES (99,0)',
  );
  expect(() => migrate(db)).toThrow('newer');
  db.close();
});
it('recovers valid legacy keys and prevents concurrent whole-key lost updates', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-storage-'));
  const store = new PreferencesStore(join(dir, 'db.sqlite'));
  try {
    store.save(
      {
        'xseek-match-important': '[1]',
        'xseek-match-page': 'obsolete',
        'xseek-match-history': 'invalid',
      },
      true,
    );
    expect(store.snapshot().imported).toBe(true);
    expect(store.snapshot().values).toEqual({ 'xseek-match-important': '[1]' });
    const revision = store.snapshot().revisions['xseek-match-important']!;
    store.save({ 'xseek-match-important': '[1,2]' }, false, { 'xseek-match-important': revision });
    expect(() =>
      store.save({ 'xseek-match-important': '[3]' }, false, { 'xseek-match-important': revision }),
    ).toThrow(PreferenceConflict);
    expect(store.snapshot().values['xseek-match-important']).toBe('[1,2]');
  } finally {
    store.close();
    await rm(dir, { recursive: true });
  }
});
it('writes atomic cache records and prunes only eligible files by age and storage budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-cache-health-'));
  const file = (c: string) => join(dir, 'search-' + c.repeat(64) + '.json');
  try {
    await atomicJson(file('a'), { fixture: true });
    expect(JSON.parse(await readFile(file('a'), 'utf8'))).toEqual({ fixture: true });
    await atomicJson(file('b'), { fixture: 'x'.repeat(100) });
    await utimes(file('a'), new Date(0), new Date(0));
    await writeFile(join(dir, 'match.sqlite'), 'keep');
    await pruneSearchCache(dir, 60000, 10);
    expect(await readdir(dir)).toEqual(['match.sqlite']);
  } finally {
    await rm(dir, { recursive: true });
  }
});
it('honors Retry-After even for manual tracker refreshes and drains on close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-refresh-health-'));
  let calls = 0;
  const store = new TrackerDefinitions(dir, async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'Retry-After': '3600' } });
  });
  try {
    await store.ready;
    await store.refresh();
    const count = calls;
    await store.refresh();
    expect(calls).toBe(count);
    expect(store.snapshot().nextAt).toBeGreaterThan(Date.now());
  } finally {
    await store.close();
    await store.refresh();
    await rm(dir, { recursive: true });
  }
});
it('retains distinct tracker identities when custom labels collide', () => {
  const store = new StatisticsStore(':memory:');
  store.overlap(
    [
      { indexerId: 1, indexer: 'A', infoHash: 'a'.repeat(64) },
      { indexerId: 2, indexer: 'B', infoHash: 'a'.repeat(64) },
    ],
    'fixture',
  );
  expect(store.snapshot({ '1': 'Same', '2': 'Same' }).overlap).toEqual([
    { aId: 1, bId: 2, a: 'Same', b: 'Same', total: 1, evidence: 'hash' },
  ]);
  store.close();
});

it('does not let a corrupt durable overlap job block valid observations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-overlap-health-'));
  const path = join(dir, 'db.sqlite');
  const store = new StatisticsStore(path);
  const db = new DatabaseSync(path);
  try {
    db.prepare('INSERT INTO overlap_jobs VALUES (?,?)').run('poison', '{');
    store.queueOverlap(
      [
        { indexerId: 1, indexer: 'A', infoHash: 'a'.repeat(40) },
        { indexerId: 2, indexer: 'B', infoHash: 'a'.repeat(40) },
      ],
      'valid',
    );
    await store.flushOverlap();
    expect(store.snapshot().counts.overlapJobsFailed).toBe(1);
    expect(store.snapshot().overlap[0]?.total).toBe(1);
    expect(db.prepare('SELECT count(*) AS n FROM overlap_jobs').get()?.n).toBe(0);
  } finally {
    db.close();
    store.close();
    await rm(dir, { recursive: true });
  }
});
