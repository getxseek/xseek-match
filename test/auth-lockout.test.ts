import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/http';
import { Auth } from '../src/server/services/auth-service';

const origin = 'http://localhost:5178';
const password = 'a sufficiently long password';
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-lockout-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const request = (remoteAddress: string, forwarded?: string) =>
  ({
    socket: { remoteAddress },
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  }) as unknown as IncomingMessage;

it('reads the client address from X-Forwarded-For only when TRUST_PROXY is set', () => {
  const plain = new Auth({ APP_ORIGIN: origin }, tempDir());
  const proxied = new Auth({ APP_ORIGIN: origin, TRUST_PROXY: 'true' }, tempDir());
  const twoHops = new Auth({ APP_ORIGIN: origin, TRUST_PROXY: '2' }, tempDir());
  try {
    expect(plain.clientAddress(request('10.0.0.2', '198.51.100.7'))).toBe('10.0.0.2');
    expect(proxied.clientAddress(request('10.0.0.2', '198.51.100.7'))).toBe('198.51.100.7');
    // A client can prepend entries, but the proxy appends the address it saw.
    expect(proxied.clientAddress(request('10.0.0.2', '203.0.113.1, 198.51.100.7'))).toBe(
      '198.51.100.7',
    );
    expect(twoHops.clientAddress(request('10.0.0.2', '203.0.113.1, 198.51.100.7, 10.0.0.3'))).toBe(
      '198.51.100.7',
    );
    expect(proxied.clientAddress(request('10.0.0.2'))).toBe('10.0.0.2');
    expect(proxied.clientAddress(request('10.0.0.2', 'not-an-address'))).toBe('10.0.0.2');
  } finally {
    plain.close();
    proxied.close();
    twoHops.close();
  }
  expect(() => new Auth({ APP_ORIGIN: origin, TRUST_PROXY: 'yes' }, tempDir())).toThrow(
    'TRUST_PROXY',
  );
});

it('extends the lockout window from the latest failure', () => {
  const auth = new Auth({ APP_ORIGIN: origin }, tempDir());
  try {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    for (let i = 0; i < 9; i++) auth.recordFailedAttempt('client');
    now.mockReturnValue(start + 14 * 60_000);
    auth.recordFailedAttempt('client');
    now.mockReturnValue(start + 16 * 60_000);
    expect(auth.beginAttempt('client')).toBe(false);
    now.mockReturnValue(start + 30 * 60_000);
    expect(auth.beginAttempt('client')).toBe(true);
    auth.finishAttempt();
  } finally {
    auth.close();
  }
});

it('lets a trusted device sign in while other clients have exhausted the shared limits', async () => {
  const dir = tempDir();
  const server = createApp({ APP_ORIGIN: origin, TRUST_PROXY: '1' }, dir, dir);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, from: string, cookie = '') =>
    fetch(base + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': from,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  const login = (from: string, cookie = '', pass = password) =>
    post('/api/auth/login', { username: 'owner', password: pass }, from, cookie);
  try {
    const setup = await post('/api/auth/setup', { username: 'owner', password }, '192.0.2.1');
    expect(setup.status).toBe(200);
    const cookies = setup.headers.getSetCookie();
    const device = cookies.find((cookie) => cookie.startsWith('match_device='))!;
    expect(device).toContain('HttpOnly');
    expect(device).toContain('SameSite=Strict');
    const deviceCookie = device.split(';')[0]!;

    // Six addresses each use up their own limit, and together the global one.
    for (let client = 0; client < 6; client++)
      for (let attempt = 0; attempt < 10; attempt++)
        expect((await login(`198.51.100.${client + 1}`, '', 'wrong password')).status).toBe(401);
    expect((await login('203.0.113.9')).status).toBe(429);

    const trusted = await login('203.0.113.9', deviceCookie);
    expect(trusted.status).toBe(200);
    // A live device cookie is kept, not replaced on every sign-in.
    expect(trusted.headers.getSetCookie().some((c) => c.startsWith('match_device='))).toBe(false);

    // The device has its own limit, and its failures do not reach the global budget.
    for (let attempt = 0; attempt < 10; attempt++)
      expect((await login('203.0.113.9', deviceCookie, 'wrong password')).status).toBe(401);
    expect((await login('203.0.113.9', deviceCookie)).status).toBe(429);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await server.drain();
  }
});

it('stops trusting devices after a password change or reset', async () => {
  const auth = new Auth({ APP_ORIGIN: origin }, tempDir());
  try {
    await auth.createOwner({ username: 'owner', password });
    const first = auth.issueDevice();
    expect(auth.trustedDeviceKey(first.token)).toMatch(/^device:/);
    expect(await auth.changePassword(password, 'another long password')).toBe(true);
    expect(auth.trustedDeviceKey(first.token)).toBeUndefined();
    const second = auth.issueDevice();
    await auth.resetPassword('a third long password');
    expect(auth.trustedDeviceKey(second.token)).toBeUndefined();
    expect(auth.trustedDeviceKey('forged')).toBeUndefined();
  } finally {
    auth.close();
  }
});
