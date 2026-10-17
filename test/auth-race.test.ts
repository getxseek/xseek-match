import { it, expect, vi } from 'vitest';
import * as argon from 'argon2';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuthHandler } from '../src/server/routes/auth-routes';
import { Auth } from '../src/server/services/auth-service';

vi.mock('argon2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('argon2')>();
  return { ...actual, verify: vi.fn(actual.verify) };
});

it('does not issue a session when an old-password login finishes after an administrative reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-auth-race-'));
  const origin = 'http://localhost:5178';
  const auth = new Auth({ APP_ORIGIN: origin }, dir);
  const password = await argon.hash('old-fixture-password');
  auth.db.prepare('INSERT INTO owner VALUES (1,?,?,1)').run('owner', password);
  let release!: () => void;
  let entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(argon.verify).mockImplementationOnce(async () => {
    entered = true;
    await gate;
    return true;
  });
  const handleAuth = createAuthHandler(auth, {
    probeProwlarr: async () => ({ ok: false, error: 'not used' }),
  });
  const server = createServer((req, res) => {
    void handleAuth(req, res, '/api/auth/login').catch(() => {
      res.statusCode = 500;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const login = fetch(
      `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/login`,
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'owner', password: 'old-fixture-password' }),
      },
    );
    await vi.waitFor(() => expect(entered).toBe(true));
    await auth.resetPassword('new-fixture-password');
    release();
    const response = await login;
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(auth.db.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(0);
  } finally {
    release();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    auth.close();
    vi.mocked(argon.verify).mockRestore();
    await rm(dir, { recursive: true });
  }
});

it('refuses to start a session against a password replaced after verification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-auth-stale-'));
  const auth = new Auth({ APP_ORIGIN: 'http://localhost:5178' }, dir);
  try {
    await auth.createOwner({ username: 'owner', password: 'old-fixture-password' });
    const verified = await auth.verifyLogin({
      username: 'owner',
      password: 'old-fixture-password',
    });
    expect(verified).toBeDefined();
    // Simulates the reset-password CLI committing from another process before the insert.
    await auth.resetPassword('new-fixture-password');
    expect(auth.startSession(false, undefined, verified)).toBeUndefined();
    expect(auth.db.prepare('SELECT count(*) AS n FROM sessions').get()?.n).toBe(0);
  } finally {
    auth.close();
    await rm(dir, { recursive: true });
  }
});

it('keeps sign-in throttling across an in-app password change but lifts it on reset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-auth-attempts-'));
  const auth = new Auth({ APP_ORIGIN: 'http://localhost:5178' }, dir);
  const attemptRows = () => auth.db.prepare('SELECT count(*) AS n FROM auth_attempts').get()?.n;
  try {
    await auth.createOwner({ username: 'owner', password: 'old-fixture-password' });
    auth.recordFailedAttempt('192.0.2.1');
    expect(attemptRows()).toBe(2);

    expect(await auth.changePassword('old-fixture-password', 'new-fixture-password')).toBe(true);
    expect(attemptRows()).toBe(2);

    await auth.resetPassword('reset-fixture-password');
    expect(attemptRows()).toBe(0);
  } finally {
    auth.close();
    await rm(dir, { recursive: true });
  }
});

it('counts only failed sign-ins and clears a client on success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-auth-failures-'));
  const origin = 'http://localhost:5178';
  const auth = new Auth({ APP_ORIGIN: origin }, dir);
  const handleAuth = createAuthHandler(auth, {
    probeProwlarr: async () => ({ ok: false, error: 'not used' }),
  });
  const server = createServer((req, res) => {
    void handleAuth(req, res, new URL(req.url || '/', 'http://localhost').pathname);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/auth/login`;
  const login = (password: string) =>
    fetch(url, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner', password }),
    }).then((response) => response.status);
  try {
    await auth.createOwner({ username: 'owner', password: 'fixture-password' });

    for (let attempt = 0; attempt < 12; attempt++) {
      expect(await login('fixture-password')).toBe(200);
    }

    for (let attempt = 0; attempt < 9; attempt++) expect(await login('wrong-password')).toBe(401);
    expect(await login('fixture-password')).toBe(200);
    expect(await login('wrong-password')).toBe(401);

    for (let attempt = 0; attempt < 9; attempt++) expect(await login('wrong-password')).toBe(401);
    expect(await login('fixture-password')).toBe(429);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    auth.close();
    await rm(dir, { recursive: true });
  }
}, 60_000);
