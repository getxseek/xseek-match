import { it, expect, vi, afterEach } from 'vitest';
import { XSEEK_USER_AGENT } from '../src/version';
import {
  readBounded,
  retryAfterAt,
  UpstreamPolicy,
  UpstreamPaused,
} from '../src/server/services/upstream-policy';
afterEach(() => vi.restoreAllMocks());
it('parses seconds and dates and supplies bounded fallback for invalid Retry-After', () => {
  const now = Date.UTC(2026, 9, 16);
  expect(retryAfterAt('120', now)).toBe(now + 120000);
  expect(retryAfterAt(new Date(now + 90000).toUTCString(), now)).toBe(now + 90000);
  expect(retryAfterAt('bad', now)).toBe(now + 60000);
  expect(retryAfterAt(null, now)).toBe(now + 60000);
});
it('shares a cooldown across endpoints, permits other origins, and resumes after expiry', async () => {
  let now = 100000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
    );
  const policy = new UpstreamPolicy();
  await policy.fetch('http://fixture.test/search');
  await expect(policy.fetch('http://fixture.test/indexers')).rejects.toBeInstanceOf(UpstreamPaused);
  expect(fetch).toHaveBeenCalledTimes(1);
  await policy.fetch('http://other.test/search');
  now += 61000;
  await policy.fetch('http://fixture.test/indexers');
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('identifies every request with the versioned xseek User-Agent', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(''));
  await new UpstreamPolicy().fetch('http://fixture.test/search', {
    headers: { 'X-Api-Key': 'fixture-key' },
  });
  const headers = new Headers(fetch.mock.calls[0]![1]!.headers);
  expect(headers.get('User-Agent')).toBe(XSEEK_USER_AGENT);
  expect(headers.get('X-Api-Key')).toBe('fixture-key');
});
it('stops consuming an oversized stream rather than buffering it', async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(20));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await expect(readBounded(response, 10)).rejects.toThrow('too large');
  expect(cancelled).toBe(true);
});
it('rejects excessive declared length and accepts bounded chunks', async () => {
  await expect(
    readBounded(new Response('small', { headers: { 'Content-Length': '10000' } }), 100),
  ).rejects.toThrow();
  expect(new TextDecoder().decode(await readBounded(new Response('fixture'), 20))).toBe('fixture');
});
