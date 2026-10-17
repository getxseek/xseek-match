import { XSEEK_USER_AGENT } from '../src/version';
import { it, expect } from 'vitest';
import { Xem, parseXem } from '../src/server/services/xem-service';
const payload = {
  result: 'success',
  data: [
    { tvdb: { season: 1, episode: 15 }, scene: { season: 2, episode: 1 } },
    { tvdb: { season: 1, episode: 27 }, scene: { season: 3, episode: 1 } },
  ],
};
it('validates both sides of scene mappings without inventing season boundaries', () => {
  expect(parseXem(payload)).toEqual([
    { tvdbSeason: 1, tvdbEpisode: 15, sceneSeason: 2, sceneEpisode: 1 },
    { tvdbSeason: 1, tvdbEpisode: 27, sceneSeason: 3, sceneEpisode: 1 },
  ]);
  expect(
    parseXem({
      result: 'success',
      data: [{ tvdb: { season: 1, episode: 1 }, scene: { season: -1, episode: 1 } }],
    }),
  ).toEqual([]);
  expect(parseXem({ result: 'failure', message: 'no show with the tvdb_id' })).toEqual([]);
  expect(() => parseXem({ result: 'failure', message: 'server problem' })).toThrow();
});
it('coalesces mappings and caches responses across repeated selections', async () => {
  let calls = 0;
  const xem = new Xem(':memory:', (async (url, options) => {
    calls++;
    expect(String(url)).toContain('id=366263');
    expect((options?.headers as Record<string, string>)['User-Agent']).toBe(XSEEK_USER_AGENT);
    return Response.json(payload);
  }) as typeof fetch);
  try {
    const [a, b] = await Promise.all([xem.get(366263), xem.get(366263)]);
    expect(a).toEqual(b);
    expect(a.mappings).toHaveLength(2);
    await xem.get(366263);
    expect(calls).toBe(1);
    await expect(xem.get(-1)).rejects.toThrow();
  } finally {
    await xem.close();
  }
});
it('backs off on rate limits and leaves unmapped search usable', async () => {
  let calls = 0;
  const xem = new Xem(':memory:', (async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'retry-after': '60' } });
  }) as typeof fetch);
  try {
    expect(await xem.get(1)).toEqual({ mappings: [], stale: true });
    expect(await xem.get(2)).toEqual({ mappings: [], stale: true });
    expect(calls).toBe(1);
  } finally {
    await xem.close();
  }
});
