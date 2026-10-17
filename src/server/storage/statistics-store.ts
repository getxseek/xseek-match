import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { groupResults, type Result } from '../../domain/matching/group.js';
import { normalizeInfoHash } from '../../domain/matching/info-hash.js';
import { openDatabase } from './migrations.js';

export interface TimingSummary {
  operation: string;
  count: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  min: number;
  max: number;
}

export interface OverlapSampleRow {
  indexerId: number;
  indexer: string;
  infoHash?: string;
  title?: string;
  size?: number;
  guid?: string;
}

export interface OverlapSummaryItem {
  aId: number;
  bId: number;
  a: string;
  b: string;
  total: number;
  evidence: 'hash' | 'release';
}

export interface StatisticsSnapshot {
  timings: TimingSummary[];
  counts: Record<string, number>;
  overlap: OverlapSummaryItem[];
}

export interface IStatisticsStore {
  count(name: string, amount?: number): void;
  timing(operation: string, ms: number): void;
  queueOverlap(rows: OverlapSampleRow[], sample: string): void;
  processNextJob(): boolean;
  snapshot(customNames?: Record<string, string>): StatisticsSnapshot;
  close(): void;
}

const STATISTICS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS overlap_sample_times (
    sample TEXT PRIMARY KEY,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS overlap_jobs (
    sample TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS timing_samples (
    id INTEGER PRIMARY KEY,
    operation TEXT,
    ms REAL
  );
  CREATE TABLE IF NOT EXISTS overlap_samples (
    id TEXT PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS inferred_overlap (
    a INTEGER,
    b INTEGER,
    name_a TEXT,
    name_b TEXT,
    total INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE TABLE IF NOT EXISTS operation_counts (
    name TEXT PRIMARY KEY,
    total INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tracker_overlap (
    a INTEGER,
    b INTEGER,
    name_a TEXT,
    name_b TEXT,
    total INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
  CREATE INDEX IF NOT EXISTS timing_operation ON timing_samples (operation, id);
`;

const SAMPLE_RETENTION_MS = 366 * 86_400_000;

function recordPairwiseOverlap(
  statement: StatementSync,
  sortedTrackers: Array<[number, string]>,
): void {
  for (let i = 0; i < sortedTrackers.length; i++) {
    for (let j = i + 1; j < sortedTrackers.length; j++) {
      const [idA, nameA] = sortedTrackers[i]!;
      const [idB, nameB] = sortedTrackers[j]!;
      statement.run(idA, idB, nameA, nameB);
    }
  }
}

function summarizeSortedTimings(operation: string, sortedValues: number[]): TimingSummary {
  const count = sortedValues.length;
  const sum = sortedValues.reduce((acc, value) => acc + value, 0);
  const median =
    count % 2
      ? sortedValues[Math.floor(count / 2)]!
      : (sortedValues[count / 2 - 1]! + sortedValues[count / 2]!) / 2;

  return {
    operation,
    count,
    mean: sum / count,
    median,
    p75: sortedValues[Math.ceil(count * 0.75) - 1]!,
    p90: sortedValues[Math.ceil(count * 0.9) - 1]!,
    p95: sortedValues[Math.ceil(count * 0.95) - 1]!,
    min: sortedValues[0]!,
    max: sortedValues[count - 1]!,
  };
}

export class StatisticsStore implements IStatisticsStore {
  readonly db: DatabaseSync;
  private statements = new Map<string, StatementSync>();
  private timingSummary?: TimingSummary[];
  private countSummary?: Record<string, number>;
  private overlapSummary?: ReturnType<StatementSync['all']>;
  private pending: ReturnType<typeof setImmediate> | undefined;

  constructor(path: string) {
    this.db = openDatabase(path, STATISTICS_SCHEMA_SQL);
    this.db
      .prepare('INSERT OR IGNORE INTO overlap_sample_times SELECT id, ? FROM overlap_samples')
      .run(Date.now());
    this.schedule();
  }

  private statement(sql: string): StatementSync {
    let prepared = this.statements.get(sql);
    if (!prepared) {
      prepared = this.db.prepare(sql);
      this.statements.set(sql, prepared);
    }
    return prepared;
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = setImmediate(() => {
      this.pending = undefined;
      if (this.processNextJob()) this.schedule();
    });
  }

  count(name: string, amount = 1): void {
    this.countSummary = undefined;
    this.statement(
      'INSERT INTO operation_counts VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET total = total + excluded.total',
    ).run(name, amount);
  }

  timing(operation: string, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.timingSummary = undefined;
    this.statement('INSERT INTO timing_samples(operation, ms) VALUES (?, ?)').run(operation, ms);
    this.statement(
      'DELETE FROM timing_samples WHERE operation = ? AND id NOT IN (SELECT id FROM timing_samples WHERE operation = ? ORDER BY id DESC LIMIT 1000)',
    ).run(operation, operation);
  }

  queueOverlap(rows: OverlapSampleRow[], sample: string): void {
    const payload = JSON.stringify(
      rows.map(({ indexerId, indexer, title, size, infoHash, guid }) => ({
        indexerId,
        indexer,
        title,
        size,
        infoHash,
        guid,
      })),
    );
    this.statement(
      'INSERT OR IGNORE INTO overlap_jobs(sample, payload) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM overlap_samples WHERE id = ?)',
    ).run(sample, payload, sample);
    this.schedule();
  }

  async flushOverlap(): Promise<void> {
    if (this.pending) {
      clearImmediate(this.pending);
      this.pending = undefined;
    }
    while (this.processNextJob()) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  processNextJob(): boolean {
    const job = this.statement(
      'SELECT sample, payload FROM overlap_jobs ORDER BY rowid LIMIT 1',
    ).get() as { sample: string; payload: string } | undefined;
    if (!job) return false;

    try {
      this.overlap(JSON.parse(job.payload), job.sample);
      this.statement('DELETE FROM overlap_jobs WHERE sample = ?').run(job.sample);
      return true;
    } catch {
      this.statement('DELETE FROM overlap_jobs WHERE sample = ?').run(job.sample);
      this.count('overlapJobsFailed');
      return true;
    }
  }

  overlap(rows: OverlapSampleRow[], sample?: string): void {
    if (sample && this.statement('SELECT 1 FROM overlap_samples WHERE id = ?').get(sample)) return;

    const trackersByHash = new Map<string, Map<number, string>>();
    for (const row of rows) {
      const hash = normalizeInfoHash(row.infoHash);
      if (!Number.isSafeInteger(row.indexerId) || row.indexerId < 1 || !hash) continue;

      let trackers = trackersByHash.get(hash);
      if (!trackers) {
        trackers = new Map();
        trackersByHash.set(hash, trackers);
      }
      trackers.set(row.indexerId, row.indexer);
    }

    const insertHashOverlap = this.statement(
      'INSERT INTO tracker_overlap VALUES (?, ?, ?, ?, 1) ON CONFLICT(a, b) DO UPDATE SET total = total + 1, name_a = excluded.name_a, name_b = excluded.name_b',
    );
    const insertInferredOverlap = this.statement(
      'INSERT INTO inferred_overlap VALUES (?, ?, ?, ?, 1) ON CONFLICT(a, b) DO UPDATE SET total = total + 1, name_a = excluded.name_a, name_b = excluded.name_b',
    );

    this.db.exec('BEGIN');
    try {
      if (sample) {
        const now = Date.now();
        const cutoff = now - SAMPLE_RETENTION_MS;
        this.statement('INSERT INTO overlap_samples VALUES (?)').run(sample);
        this.statement('INSERT OR IGNORE INTO overlap_sample_times VALUES (?, ?)').run(sample, now);
        this.statement(
          'DELETE FROM overlap_samples WHERE id IN (SELECT sample FROM overlap_sample_times WHERE at < ?)',
        ).run(cutoff);
        this.statement('DELETE FROM overlap_sample_times WHERE at < ?').run(cutoff);
      }

      for (const trackers of trackersByHash.values()) {
        const sorted = [...trackers.entries()].sort((left, right) => left[0] - right[0]);
        recordPairwiseOverlap(insertHashOverlap, sorted);
      }

      const releases: Result[] = rows
        .filter((row) => typeof row.title === 'string')
        .map((row, index) => ({
          ...row,
          guid: row.guid || String(index),
          title: row.title!,
          size: row.size || 0,
        }));

      for (const group of groupResults(releases)) {
        if (group.evidence !== 'release') continue;
        const sortedTrackers = [
          ...new Map(group.rows.map((row) => [row.indexerId, row.indexer])).entries(),
        ].sort((left, right) => left[0] - right[0]);
        recordPairwiseOverlap(insertInferredOverlap, sortedTrackers);
      }

      this.db.exec('COMMIT');
      this.overlapSummary = undefined;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  snapshot(customNames: Record<string, string> = {}): StatisticsSnapshot {
    const timings = (this.timingSummary ??= (
      this.statement('SELECT DISTINCT operation FROM timing_samples').all() as Array<{
        operation: string;
      }>
    ).map(({ operation }) => {
      const sortedValues = (
        this.statement('SELECT ms FROM timing_samples WHERE operation = ? ORDER BY ms').all(
          operation,
        ) as Array<{ ms: number }>
      ).map((row) => row.ms);
      return summarizeSortedTimings(operation, sortedValues);
    }));

    const counts = (this.countSummary ??= Object.fromEntries(
      (
        this.statement('SELECT name, total FROM operation_counts').all() as Array<{
          name: string;
          total: number;
        }>
      ).map((row) => [row.name, row.total]),
    ));

    const overlapRows = (this.overlapSummary ??= this.statement(
      `SELECT a AS aId, b AS bId, name_a AS a, name_b AS b, total, 'hash' AS evidence FROM tracker_overlap
       UNION ALL
       SELECT a AS aId, b AS bId, name_a AS a, name_b AS b, total, 'release' AS evidence FROM inferred_overlap
       ORDER BY total DESC`,
    ).all()) as Array<{
      aId: number;
      bId: number;
      a: string;
      b: string;
      total: number;
      evidence: 'hash' | 'release';
    }>;

    return {
      timings,
      counts,
      overlap: overlapRows.map((row) => ({
        aId: Number(row.aId),
        bId: Number(row.bId),
        a: customNames[String(row.aId)] || row.a,
        b: customNames[String(row.bId)] || row.b,
        total: row.total,
        evidence: row.evidence,
      })),
    };
  }

  close(): void {
    if (this.pending) clearImmediate(this.pending);
    this.pending = undefined;
    while (this.processNextJob()) {}
    this.statements.clear();
    this.db.close();
  }
}
