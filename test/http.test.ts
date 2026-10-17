import { createServer } from 'node:http';
import { it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server/http';
import { createAuthHandler } from '../src/server/routes/auth-routes';
import { Auth } from '../src/server/services/auth-service';
it('requires HTTPS for public origins but accepts plain HTTP on private networks', () => {
  expect(() => new Auth({ APP_ORIGIN: 'http://public.example' }, '/unused')).toThrow('HTTPS');
  expect(() => new Auth({ APP_ORIGIN: 'http://8.8.8.8:5178' }, '/unused')).toThrow('HTTPS');
  for (const origin of [
    'http://192.168.1.20:5178',
    'http://10.0.0.5:5178',
    'http://100.101.102.103:5178',
    'http://nas.local:5178',
    'http://mediabox:5178',
    'http://[fd12:3456::1]:5178',
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'match-origin-'));
    try {
      const auth = new Auth({ APP_ORIGIN: origin }, dir);
      expect(auth.secure).toBe(false);
      auth.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
it('protects setup, sessions, preferences, logout and administrative password reset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-http-'));
  mkdirSync(join(dir, 'static'));
  writeFileSync(join(dir, 'static/index.html'), '<h1>Match</h1>');
  const origin = 'http://localhost:5178';
  const server = createApp({ APP_ORIGIN: origin }, join(dir, 'data'), join(dir, 'static'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    expect((await fetch(base + '/healthz')).status).toBe(200);
    expect((await fetch(base + '/')).status).toBe(200);
    expect((await fetch(base + '/api/match/preferences')).status).toBe(401);
    expect((await post('/api/auth/setup', { username: 'owner', password: 'short' })).status).toBe(
      400,
    );
    const created = await post('/api/auth/setup', {
      username: 'owner',
      password: 'a sufficiently long password',
      remember: true,
    });
    expect(created.status).toBe(200);
    const cookie = created.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=');
    let sessionCookie = cookie.split(';')[0]!;
    let state = await created.json();
    const headers = () => ({ Cookie: sessionCookie, 'X-CSRF-Token': state.csrf });
    expect(
      (
        await post('/api/auth/setup', {
          username: 'other',
          password: 'another sufficiently long password',
        })
      ).status,
    ).toBe(409);
    expect((await post('/api/auth/onboarding', {}, { Cookie: sessionCookie })).status).toBe(403);
    expect(
      (await post('/api/auth/onboarding', {}, { ...headers(), Origin: 'https://evil.example' }))
        .status,
    ).toBe(403);
    expect((await post('/api/auth/onboarding', {}, headers())).status).toBe(200);
    expect((await post('/api/auth/debug/reset-onboarding', {}, headers())).status).toBe(404);
    const saved = await fetch(base + '/api/match/preferences', {
      method: 'PUT',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers() },
      body: JSON.stringify({ values: { 'xseek-match-important': '[3]' } }),
    });
    expect(saved.status).toBe(200);
    expect(
      (
        await (
          await fetch(base + '/api/match/preferences', { headers: { Cookie: sessionCookie } })
        ).json()
      ).values['xseek-match-important'],
    ).toBe('[3]');
    expect((await post('/api/auth/connection', {}, headers())).status).toBe(200);
    expect((await post('/api/auth/logout', {}, headers())).status).toBe(200);
    expect(
      (await fetch(base + '/api/match/preferences', { headers: { Cookie: sessionCookie } })).status,
    ).toBe(401);
    const login = await post('/api/auth/login', {
      username: 'owner',
      password: 'a sufficiently long password',
    });
    expect(login.status).toBe(200);
    sessionCookie = login.headers.get('set-cookie')!.split(';')[0]!;
    state = await login.json();
    const auth = new Auth({ APP_ORIGIN: origin }, join(dir, 'data'));
    expect(auth.owner()!.password).toMatch(/^\$argon2id\$/);
    await auth.resetPassword('new sufficiently long password');
    auth.close();
    expect(
      (await fetch(base + '/api/match/preferences', { headers: { Cookie: sessionCookie } })).status,
    ).toBe(401);
    expect(
      (
        await post('/api/auth/login', {
          username: 'owner',
          password: 'a sufficiently long password',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await post('/api/auth/login', {
          username: 'owner',
          password: 'new sufficiently long password',
        })
      ).status,
    ).toBe(200);
    expect((await post('/api/auth/recover', {})).status).toBe(401);
    expect((await fetch(base + '/.env')).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await server.drain();
    rmSync(dir, { recursive: true, force: true });
  }
});
it('sets Secure host-only cookies for HTTPS origins and persists login throttling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-secure-'));
  const origin = 'https://match.example.com';
  const server = createApp({ APP_ORIGIN: origin }, dir, dir);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(base + '/api/auth/setup', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password: 'a sufficiently long password' }),
    });
    expect(response.headers.get('set-cookie')).toContain('__Host-match_session=');
    expect(response.headers.get('set-cookie')).toContain('; Secure');
    // Only failures count: setup and successful sign-ins do not use up the limit.
    for (let i = 0; i < 10; i++)
      await fetch(base + '/api/auth/login', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'wrong', password: 'wrong' }),
      });
    expect(
      (
        await fetch(base + '/api/auth/login', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(429);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await server.drain();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('enforces the eight-character password boundary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-password-policy-'));
  const auth = new Auth({}, dir);
  try {
    expect(() => auth.credentials({ username: 'owner', password: '1234567' })).toThrow();
    expect(auth.credentials({ username: 'owner', password: '12345678' }).password).toBe('12345678');
  } finally {
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('resets the development owner and sessions for first-step onboarding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-debug-'));
  const origin = 'http://localhost:5178';
  const auth = new Auth({ APP_ORIGIN: origin }, dir);
  const handleAuth = createAuthHandler(auth, {
    development: true,
    probeProwlarr: async () => ({ ok: false, error: 'not used' }),
  });
  const server = createServer((req, res) => {
    void handleAuth(req, res, new URL(req.url || '/', 'http://localhost').pathname).then(
      (handled) => {
        if (!handled) {
          res.statusCode = 404;
          res.end();
        }
      },
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  try {
    expect((await post('/api/auth/debug/reset-onboarding', {})).status).toBe(401);
    const setup = await post('/api/auth/setup', { username: 'owner', password: 'test-password' });
    const session = await setup.json();
    const headers = {
      Cookie: setup.headers.get('set-cookie')!.split(';')[0]!,
      'X-CSRF-Token': session.csrf,
    };
    await post('/api/auth/onboarding', {}, headers);
    expect(auth.owner()!.onboarded).toBe(1);
    expect((await post('/api/auth/debug/reset-onboarding', {}, headers)).status).toBe(200);
    expect(auth.owner()).toBeUndefined();
    expect(auth.db.prepare('SELECT count(*) AS n FROM sessions').get()!.n).toBe(0);
    expect(auth.meta('onboarding-step')).toBe('connection');
    expect((await (await fetch(base + '/api/auth/status')).json()).setup).toBe(true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('accepts any loopback origin only when the dev option allows it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'match-loopback-'));
  const auth = new Auth({ APP_ORIGIN: 'http://127.0.0.1:5178' }, dir);
  const probeProwlarr = async () => ({ ok: false as const, error: 'not used' });
  const strict = createAuthHandler(auth, { probeProwlarr });
  const lenient = createAuthHandler(auth, { probeProwlarr, allowLoopbackOrigins: true });
  const statusFor = async (handler: typeof strict, origin: string) => {
    const server = createServer((req, res) => {
      void handler(req, res, new URL(req.url || '/', 'http://localhost').pathname);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/onboarding`,
        {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        },
      );
      return response.status;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
  try {
    expect(await statusFor(strict, 'http://127.0.0.1:5179')).toBe(403);
    expect(await statusFor(lenient, 'http://127.0.0.1:5179')).toBe(401);
    expect(await statusFor(lenient, 'http://localhost:5180')).toBe(401);
    expect(await statusFor(lenient, 'http://127.0.0.1.evil.example')).toBe(403);
    expect(await statusFor(lenient, 'http://192.168.1.5:5178')).toBe(403);
  } finally {
    auth.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
