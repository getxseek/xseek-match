import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  const lookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
    if (hostname === 'metadata-alias.test') {
      callback(null, [{ address: '169.254.169.254', family: 4 }]);
      return;
    }
    (actual.lookup as (...args: unknown[]) => void)(hostname, options, callback);
  }) as typeof actual.lookup;
  return { ...actual, lookup, default: { ...actual, lookup } };
});

const { pinnedRequest } = await import('../src/server/services/pinned-http');

let server: Server;
let base: string;
let lastUserAgent: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    lastUserAgent = req.headers['user-agent'];
    if (req.url === '/large') {
      res.end(Buffer.alloc(2048));
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.end(Buffer.from('fixture-icon'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

it('fetches from loopback and LAN destinations with the xseek User-Agent', async () => {
  const response = await pinnedRequest(new URL('/favicon.ico', base), {
    maxBytes: 1024,
    timeoutMs: 5000,
  });
  expect(response.statusCode).toBe(200);
  expect(response.body.toString()).toBe('fixture-icon');
  expect(lastUserAgent).toMatch(/^xseek\//);
});

it('refuses IP-literal metadata and link-local destinations without connecting', async () => {
  for (const url of [
    'http://169.254.169.254/latest',
    'http://[fd00:ec2::254]/',
    'http://0.0.0.0/',
  ]) {
    await expect(pinnedRequest(new URL(url), { maxBytes: 1024, timeoutMs: 1000 })).rejects.toThrow(
      'Could not connect',
    );
  }
});

it('refuses hostnames whose DNS answer is a blocked address', async () => {
  await expect(
    pinnedRequest(new URL('http://metadata-alias.test/favicon.ico'), {
      maxBytes: 1024,
      timeoutMs: 1000,
    }),
  ).rejects.toThrow('Could not connect');
});

it('aborts responses larger than the byte limit', async () => {
  await expect(
    pinnedRequest(new URL('/large', base), { maxBytes: 1024, timeoutMs: 5000 }),
  ).rejects.toThrow();
});
