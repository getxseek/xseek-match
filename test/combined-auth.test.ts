import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createApp } from '../src/server/http';
import { Auth } from '../src/server/services/auth-service';
import { OidcStore } from '../src/server/storage/oidc-store';

it('keeps provider sessions and consumer keys separate while allowing owner key management', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'match-combined-auth-'));
  const env = {
    APP_ORIGIN: 'https://match.example.test',
    OIDC_ENABLED: 'true',
    OIDC_ISSUER: 'https://id.example.test',
    OIDC_CLIENT_ID: 'match',
    OIDC_CLIENT_SECRET: 'fixture-secret',
  };
  const auth = new Auth(env, dir);
  let app: ReturnType<typeof createApp> | undefined;
  try {
    await auth.createOwner({ username: 'owner', password: 'fixture-password' });
    const identities = new OidcStore(auth.db);
    identities.link(env.OIDC_ISSUER, 'fixture-subject');
    const session = auth.startOidcSession(Date.now() + 60_000);
    identities.markSession(
      createHash('sha256').update(session.token).digest('hex'),
      env.OIDC_ISSUER,
    );
    const cookie = `${auth.cookieName}=${session.token}`;
    app = createApp(env, dir, dir);
    await new Promise<void>((resolve) => app!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
    const headers = {
      Origin: env.APP_ORIGIN,
      Cookie: cookie,
      'X-CSRF-Token': session.csrf,
      'Content-Type': 'application/json',
    };
    const manage = (body: object) =>
      fetch(base + '/api/auth/keys', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    const status = await fetch(base + '/api/auth/status', { headers });
    expect(status.status).toBe(200);
    expect((await status.json()).oidc.linked).toBe(true);
    const created = await manage({
      action: 'create',
      name: 'consumer',
      scopes: ['titles:read'],
      password: 'fixture-password',
    });
    expect(created.status).toBe(201);
    const { token, key } = await created.json();
    const bearer = { Authorization: `Bearer ${token}` };
    expect((await fetch(base + '/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(401);
    expect((await fetch(base + '/api/v1/me', { headers: bearer })).status).toBe(200);
    expect(
      (
        await fetch(base + '/api/auth/oidc/link', {
          method: 'POST',
          headers: { ...headers, ...bearer },
          body: '{}',
        })
      ).status,
    ).toBe(401);
    expect(
      (await manage({ action: 'revoke', id: key.id, password: 'fixture-password' })).status,
    ).toBe(200);
    expect((await fetch(base + '/api/v1/me', { headers: bearer })).status).toBe(401);
  } finally {
    if (app) {
      await new Promise<void>((resolve) => app!.close(() => resolve()));
      await app.drain();
    }
    auth.close();
    await rm(dir, { recursive: true, force: true });
  }
});
