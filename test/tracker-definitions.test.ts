import { XSEEK_USER_AGENT } from '../src/version';
import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TrackerDefinitions,
  parseDefinitions,
  trackerSource,
} from '../src/server/services/tracker-definitions-service';
it('validates tracker definitions and preserves metadata', () => {
  expect(
    parseDefinitions({
      trackers: [{ Name: 'Tracker', Abbreviation: 'TR', Codebase: 'UNIT3D', bad: {} }],
    }),
  ).toEqual([{ Name: 'Tracker', Abbreviation: 'TR', Codebase: 'UNIT3D' }]);
  expect(() => parseDefinitions({ trackers: [] })).toThrow();
  expect(() => parseDefinitions({ trackers: [{ Abbreviation: 'TR' }] })).toThrow();
});
it('coalesces refreshes, persists definitions and keeps stale data on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'xm-definitions-'));
  let calls = 0;
  let fail = false;
  const fetcher = (async (url, options) => {
    calls++;
    expect(String(url)).toBe(trackerSource);
    expect((options?.headers as Record<string, string>)['User-Agent']).toBe(XSEEK_USER_AGENT);
    return fail
      ? new Response('', { status: 429, headers: { 'Retry-After': '7200' } })
      : Response.json({
          trackers: [{ Name: 'New tracker', Abbreviation: 'NEW', Type: 'General' }],
        });
  }) as typeof fetch;
  const store = new TrackerDefinitions(dir, fetcher);
  try {
    await store.ready;
    await Promise.all([store.refresh(), store.refresh()]);
    expect(calls).toBe(1);
    expect(store.snapshot().trackers[0]?.Abbreviation).toBe('NEW');
    const at = store.snapshot().at;
    expect(store.snapshot().nextAt).toBe(at + 86400000);
    fail = true;
    await store.refresh();
    expect(store.snapshot().at).toBe(at);
    expect(store.snapshot().error).toBeTruthy();
    expect(store.snapshot().nextAt).toBeGreaterThan(Date.now() + 7100000);
    const restored = new TrackerDefinitions(dir, fetcher);
    try {
      await restored.ready;
      expect(restored.snapshot().trackers).toEqual(store.snapshot().trackers);
      expect(calls).toBe(2);
    } finally {
      restored.close();
    }
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
