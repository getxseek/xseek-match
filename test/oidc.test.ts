import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Auth } from '../src/server/services/auth-service';
import { createAuthHandler } from '../src/server/routes/auth-routes';
import { XSEEK_USER_AGENT } from '../src/version';

let issuer = 'https://id.example.test/realm';
const originalFetch = globalThis.fetch;
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'one', alg: 'RS256', use: 'sig' };
const config = {
  APP_ORIGIN: 'https://match.example.test',
  OIDC_ENABLED: 'true',
  OIDC_ISSUER: issuer,
  OIDC_CLIENT_ID: 'match',
  OIDC_CLIENT_SECRET: 'fixture-server-secret',
};
let auth: Auth;
let dir: string;
let authorization: URL;
let changes: Record<string, unknown>;
let badSignature: boolean;
let rotated: boolean;
let headerAlgorithm: string;
let tokenAuthMethod: string;
let providerDown: boolean;
let discoveryChanges: Record<string, unknown>;
let signingKeys: unknown[] | undefined;
let requests: string[];
let limitedEndpoint: string | undefined;
let retryAfter: string;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  issuer = config.OIDC_ISSUER;
  changes = {};
  badSignature = false;
  rotated = false;
  headerAlgorithm = 'RS256';
  tokenAuthMethod = 'client_secret_basic';
  providerDown = false;
  discoveryChanges = {};
  signingKeys = undefined;
  requests = [];
  limitedEndpoint = undefined;
  retryAfter = '30';
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith('https://id.example.test/')) return originalFetch(input, init);
    expect(new Headers(init?.headers).get('User-Agent')).toBe(XSEEK_USER_AGENT);
    requests.push(url);
    expect(init?.redirect).toBe('error');
    if (limitedEndpoint && url.endsWith(limitedEndpoint)) {
      return new Response(JSON.stringify({ error: 'slow_down' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': retryAfter },
      });
    }
    if (providerDown) throw new Error('fixture outage with sensitive text');
    if (url.includes('.well-known/openid-configuration'))
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        ...discoveryChanges,
      });
    if (url.endsWith('/jwks'))
      return json({
        keys: signingKeys ?? [
          rotated
            ? {
                ...otherKeys.publicKey.export({ format: 'jwk' }),
                kid: 'two',
                alg: 'RS256',
                use: 'sig',
              }
            : jwk,
        ],
      });
    if (url.endsWith('/token')) {
      const params = new URLSearchParams(init?.body as URLSearchParams);
      expect(params.get('redirect_uri')).toBe(`${config.APP_ORIGIN}/api/auth/oidc/callback`);
      const actualChallenge = createHash('sha256')
        .update(params.get('code_verifier') || '')
        .digest('base64url');
      if (actualChallenge !== authorization.searchParams.get('code_challenge'))
        return json({ error: 'invalid_grant' }, 400);
      if (tokenAuthMethod === 'client_secret_basic') {
        const basic = new Headers(init?.headers).get('authorization')!;
        expect(decodeURIComponent(Buffer.from(basic.slice(6), 'base64').toString())).toBe(
          'match:fixture-server-secret',
        );
      } else {
        expect(params.get('client_id')).toBe('match');
        expect(params.get('client_secret')).toBe('fixture-server-secret');
      }
      const now = Math.floor(Date.now() / 1000);
      const claims = {
        iss: issuer,
        sub: 'owner-subject',
        aud: 'match',
        iat: now,
        auth_time: now,
        exp: now + 7200,
        nonce: authorization.searchParams.get('nonce'),
        ...changes,
      };
      const signingInput = [
        JSON.stringify({ alg: headerAlgorithm, kid: rotated ? 'two' : 'one' }),
        JSON.stringify(claims),
      ]
        .map((value) => Buffer.from(value).toString('base64url'))
        .join('.');
      const signature = sign(
        'sha256',
        Buffer.from(signingInput),
        badSignature || rotated ? otherKeys.privateKey : keys.privateKey,
      ).toString('base64url');
      return json({
        access_token: 'discard-access-token',
        token_type: 'Bearer',
        refresh_token: 'discard-refresh-token',
        id_token: `${signingInput}.${signature}`,
      });
    }
    throw new Error('Unexpected provider URL');
  });
  dir = await mkdtemp(join(tmpdir(), 'match-oidc-'));
  auth = new Auth(config, dir);
  await auth.createOwner({ username: 'owner', password: 'fixture-password' });
});

afterEach(async () => {
  auth.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true });
});

async function begin(intent: 'link' | 'login' = 'link') {
  const started = auth.startSession(false)!;
  const session = auth.findSession(started.token)!;
  const tx = await auth.oidc.begin(intent, session, auth.owner()!.password);
  authorization = new URL(tx.url);
  return { tx, session };
}
function callback(state: string) {
  return new URL(`${auth.oidc.callback}?code=fixture-code&state=${state}`);
}
async function link() {
  const { tx } = await begin();
  return auth.oidc.finish(callback(tx.state), tx.binding);
}

describe('OpenID Connect with the real maintained client and a signed mock provider', () => {
  it.each(
    ['seconds', 'date'].flatMap((header) =>
      ['discovery', 'token', 'jwks', 'diagnostics'].map((endpoint) => ({ header, endpoint })),
    ),
  )(
    'honors $header Retry-After from $endpoint across provider requests',
    async ({ header, endpoint }) => {
      const now = Math.floor(Date.now() / 1000) * 1000;
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      retryAfter = header === 'seconds' ? '30' : new Date(now + 30_000).toUTCString();
      if (endpoint === 'discovery') {
        limitedEndpoint = '/.well-known/openid-configuration';
        await expect(begin()).rejects.toThrow();
      } else if (endpoint === 'diagnostics') {
        limitedEndpoint = '/jwks';
        await expect(auth.oidc.diagnose()).rejects.toThrow();
      } else {
        const { tx } = await begin();
        limitedEndpoint = `/${endpoint}`;
        await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
      }
      const requestCount = requests.length;
      limitedEndpoint = undefined;
      if (endpoint !== 'discovery') {
        const { tx } = await begin();
        await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
      } else {
        await expect(begin()).rejects.toThrow();
      }
      await expect(auth.oidc.diagnose()).rejects.toThrow();
      clock.mockReturnValue(now + 29_999);
      await expect(auth.oidc.diagnose()).rejects.toThrow();
      expect(requests).toHaveLength(requestCount);
      expect(
        await auth.verifyLogin({ username: 'owner', password: 'fixture-password' }),
      ).toBeTruthy();
      clock.mockReturnValue(now + 30_001);
      await expect(auth.oidc.diagnose()).resolves.toMatchObject({ ok: true });
      await expect(link()).resolves.toHaveProperty('token');
      expect(requests.length).toBeGreaterThan(requestCount);
    },
  );

  it.each([{ keys: [] }, { keys: [{}] }, { keys: [{ ...jwk, alg: 'HS256' }] }])(
    'rejects unusable signing keys in diagnostics: %j',
    async (value) => {
      signingKeys = value.keys;
      await expect(auth.oidc.diagnose()).rejects.toThrow();
    },
  );
  it('checks provider configuration and signing keys without claiming to verify client credentials', async () => {
    const result = await auth.oidc.diagnose();
    expect(result).toMatchObject({ ok: true, signInRequired: true });
    expect(result.checks).toContain('signing_keys');
    providerDown = true;
    await expect(auth.oidc.diagnose()).rejects.toThrow();
  });

  it.each([
    { response_types_supported: ['token'] },
    { token_endpoint_auth_methods_supported: ['none'] },
    { id_token_signing_alg_values_supported: ['HS256'] },
    { code_challenge_methods_supported: ['plain'] },
  ])('rejects incompatible provider settings in diagnostics: %j', async (metadata) => {
    discoveryChanges = metadata;
    await expect(auth.oidc.diagnose()).rejects.toThrow();
  });

  it('supports confidential client_secret_post registration', async () => {
    auth.close();
    tokenAuthMethod = 'client_secret_post';
    auth = new Auth({ ...config, OIDC_TOKEN_AUTH_METHOD: tokenAuthMethod }, dir);
    expect((await link()).token).toBeTruthy();
  });

  it('refreshes JWKS for provider signing-key rotation', async () => {
    await link();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
    rotated = true;
    const { tx } = await begin('login');
    const session = await auth.oidc.finish(callback(tx.state), tx.binding);
    expect(auth.findSession(session.token)).toBeDefined();
    expect(requests.filter((url) => url.endsWith('/jwks'))).toHaveLength(2);
    clock.mockRestore();
  });

  it('requires the configured asymmetric signing algorithm', async () => {
    const { tx } = await begin();
    headerAlgorithm = 'none';
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    expect(auth.oidc.status().linked).toBe(false);
  });

  it('enforces the absolute session deadline and preserves local sessions', async () => {
    const local = auth.startSession(true)!;
    const provider = await link();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3_601_000);
    expect(auth.findSession(provider.token)).toBeUndefined();
    expect(auth.findSession(local.token)).toBeDefined();
  });

  it('validates configuration without leaking secrets or breaking repeated additive schema initialization', () => {
    const invalid = [
      { OIDC_CLIENT_SECRET_FILE: 'nonexistent', OIDC_CLIENT_SECRET: 'sensitive' },
      { OIDC_ISSUER: 'http://id.example.test' },
      { OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG: 'HS256' },
      { OIDC_TOKEN_AUTH_METHOD: 'none' },
      { APP_ORIGIN: 'http://localhost:5178' },
    ];
    for (const [index, env] of invalid.entries()) {
      expect(() => new Auth({ ...config, ...env }, join(dir, String(index)))).toThrow();
    }
    const second = new Auth(config, dir);
    expect(second.owner()?.username).toBe('owner');
    expect(second.startSession(false)?.token).toBeTruthy();
    second.close();
  });

  it('supports an exact root issuer identifier without adding a trailing slash', async () => {
    auth.close();
    issuer = 'https://id.example.test';
    auth = new Auth({ ...config, OIDC_ISSUER: issuer }, dir);
    const session = await link();
    expect(auth.oidc.status().loginAvailable).toBe(true);
    expect(auth.findSession(session.token)).toBeDefined();
    const { tx } = await begin('login');
    expect((await auth.oidc.finish(callback(tx.state), tx.binding)).token).toBeTruthy();
  });

  it('uses discovery, S256, nonce and code flow; links only with password authority and rotates the initiating session', async () => {
    const { tx, session } = await begin();
    expect(authorization.searchParams.get('response_type')).toBe('code');
    expect(authorization.searchParams.get('scope')).toBe('openid profile');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.href).not.toContain(config.OIDC_CLIENT_SECRET);
    const started = await auth.oidc.finish(callback(tx.state), tx.binding);
    expect(auth.sessionById(session.id)).toBeUndefined();
    expect(auth.findSession(started.token)).toBeDefined();
    expect(started.maxAgeSeconds).toBeLessThanOrEqual(3600);
    expect(requests.some((url) => url.endsWith('/jwks'))).toBe(true);
    expect(JSON.stringify(auth.db.prepare('SELECT * FROM oidc_transactions').all())).not.toContain(
      'discard',
    );
    expect(auth.oidc.status().linked).toBe(true);
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
  });

  it.each([
    ['wrong issuer', { iss: 'https://other.example.test' }],
    ['wrong audience', { aud: 'other-client' }],
    [
      'additional audience with matching authorized party',
      { aud: ['match', 'other'], azp: 'match' },
    ],
    ['wrong authorized party', { aud: ['match', 'other'], azp: 'other' }],
    ['wrong authorized party with one audience', { azp: 'other' }],
    ['missing authorized party', { aud: ['match', 'other'] }],
    ['wrong nonce', { nonce: 'other-nonce' }],
    ['missing nonce', { nonce: undefined }],
    ['expired token', { exp: 1 }],
    ['future token', { nbf: 9_999_999_999 }],
    ['missing subject', { sub: undefined }],
    ['empty subject', { sub: '' }],
    ['missing auth time for fresh linking', { auth_time: undefined }],
    ['stale provider authentication for linking', { auth_time: 1 }],
  ])('rejects %s without linking', async (_name, claims) => {
    changes = claims;
    const { tx } = await begin();
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    expect(auth.oidc.status().linked).toBe(false);
  });

  it('rejects invalid signatures even though the token endpoint itself was trusted', async () => {
    badSignature = true;
    const { tx } = await begin();
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    expect(auth.oidc.status().linked).toBe(false);
  });

  it.each([{ aud: 'match' }, { aud: ['match'] }])(
    'accepts its sole registered audience: %j',
    async (claims) => {
      changes = claims;
      const { tx } = await begin();
      const started = await auth.oidc.finish(callback(tx.state), tx.binding);
      expect(auth.findSession(started.token)).toBeDefined();
    },
  );

  it('rejects missing/wrong cookie, state, expiry, PKCE failure and provider denial', async () => {
    const { tx } = await begin();
    await expect(auth.oidc.finish(callback(tx.state), '')).rejects.toThrow();
    await expect(
      auth.oidc.finish(callback('missing-state-value-long-enough'), tx.binding),
    ).rejects.toThrow();
    auth.db.prepare('UPDATE oidc_transactions SET verifier = ?').run('wrong-verifier');
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    const second = await begin();
    auth.db.prepare('UPDATE oidc_transactions SET expires = 1').run();
    await expect(auth.oidc.finish(callback(second.tx.state), second.tx.binding)).rejects.toThrow();
    const third = await begin();
    await expect(
      auth.oidc.finish(
        new URL(`${auth.oidc.callback}?error=access_denied&state=${third.tx.state}`),
        third.tx.binding,
      ),
    ).rejects.toThrow();
  });

  it('checks initiating sessions after the provider roundtrip and never creates owners', async () => {
    const { tx, session } = await begin();
    auth.endSession(session);
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    const second = await begin();
    await auth.resetPassword('new-fixture-password');
    await expect(auth.oidc.finish(callback(second.tx.state), second.tx.binding)).rejects.toThrow();
    auth.db.exec('DELETE FROM owner');
    await expect(auth.oidc.begin('login')).rejects.toThrow();
  });

  it('rejects another subject even with matching email/name, while profile changes do not affect authority', async () => {
    await link();
    const { tx } = await begin('login');
    changes = { sub: 'attacker', email: 'owner@example.test', name: 'Owner' };
    await expect(auth.oidc.finish(callback(tx.state), tx.binding)).rejects.toThrow();
    const next = await begin('login');
    changes = { email: 'changed@example.test', name: 'Changed' };
    const session = await auth.oidc.finish(callback(next.tx.state), next.tx.binding);
    expect(auth.findSession(session.token)).toBeDefined();
  });

  it('handles concurrent linking tabs atomically and rejects a callback after unlinking', async () => {
    const first = await begin();
    const second = await begin();
    authorization = new URL(first.tx.url);
    await auth.oidc.finish(callback(first.tx.state), first.tx.binding);
    authorization = new URL(second.tx.url);
    await expect(auth.oidc.finish(callback(second.tx.state), second.tx.binding)).rejects.toThrow();
    const login = await begin('login');
    auth.oidc.unlink();
    await expect(auth.oidc.finish(callback(login.tx.state), login.tx.binding)).rejects.toThrow();
  });

  it('rechecks unlink authorization inside its write transaction', async () => {
    await link();
    const local = auth.startSession(false)!;
    const session = auth.findSession(local.token)!;
    const passwordHash = auth.owner()!.password;
    auth.endSession(session);
    expect(auth.oidc.unlink({ session, passwordHash })).toBe(false);
    expect(auth.oidc.status().linked).toBe(true);

    const second = auth.findSession(auth.startSession(false)!.token)!;
    await auth.resetPassword('recovered-password');
    expect(auth.oidc.unlink({ session: second, passwordHash })).toBe(false);
    expect(auth.oidc.status().linked).toBe(true);

    const current = auth.findSession(auth.startSession(false)!.token)!;
    expect(auth.oidc.unlink({ session: current, passwordHash: auth.owner()!.password })).toBe(true);
    expect(auth.oidc.status().linked).toBe(false);
  });

  it('caps sessions at token expiry; unlink and disabled configuration invalidate them, while local recovery works offline', async () => {
    changes = { exp: Math.floor(Date.now() / 1000) + 60 };
    const session = await link();
    expect(session.maxAgeSeconds).toBeLessThanOrEqual(60);
    const local = auth.startSession(false)!;
    auth.oidc.unlink();
    expect(auth.findSession(session.token)).toBeUndefined();
    expect(auth.findSession(local.token)).toBeDefined();
    const other = await link();
    auth.close();
    auth = new Auth({ ...config, OIDC_ENABLED: 'false' }, dir);
    expect(auth.findSession(other.token)).toBeUndefined();
    providerDown = true;
    expect(
      await auth.verifyLogin({ username: 'owner', password: 'fixture-password' }),
    ).toBeTruthy();
    await auth.resetPassword('recovered-password');
    expect(auth.findSession(local.token)).toBeUndefined();
  });

  it('keeps local authentication usable after discovery failure and retries discovery', async () => {
    providerDown = true;
    await expect(begin()).rejects.toThrow('provider_unavailable');
    expect(
      await auth.verifyLogin({ username: 'owner', password: 'fixture-password' }),
    ).toBeTruthy();
    providerDown = false;
    expect((await begin()).tx.url).toContain('/authorize');
  });

  it.each([false, true])(
    'keeps local sign-in available after OIDC starts (provider down: %s)',
    async (down) => {
      await link();
      if (down) {
        auth.close();
        auth = new Auth(config, dir);
      }
      providerDown = down;
      const handler = createAuthHandler(auth, {
        probeProwlarr: async () => ({ ok: false, error: 'not used' }),
      });
      const server = createServer((req, res) => {
        void handler(req, res, new URL(req.url!, config.APP_ORIGIN).pathname);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const headers = { Origin: config.APP_ORIGIN, 'Content-Type': 'application/json' };
      try {
        for (let index = 0; index < 10; index++) {
          const start = await fetch(`${base}/api/auth/oidc/login`, { method: 'POST', headers });
          expect(start.status).toBe(down ? 503 : 200);
          if (!down) {
            authorization = new URL((await start.json()).url);
            const response = await fetch(
              `${base}/api/auth/oidc/callback?code=fixture-code&state=${authorization.searchParams.get('state')}`,
              {
                headers: { Cookie: start.headers.get('set-cookie')!.split(';')[0]! },
                redirect: 'manual',
              },
            );
            expect(response.status).toBe(303);
          }
        }
        const limited = await fetch(`${base}/api/auth/oidc/login`, { method: 'POST', headers });
        expect(limited.status).toBe(429);
        expect(limited.headers.get('retry-after')).toBe('900');
        const local = await fetch(`${base}/api/auth/login`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ username: 'owner', password: 'fixture-password' }),
        });
        expect(local.status).toBe(200);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );

  it('persists a separate OIDC budget and expires it without resetting password failures', () => {
    for (let index = 0; index < 10; index++) {
      auth.recordFailedAttempt('client');
      expect(auth.beginOidcStart('client')).toBe(true);
      auth.finishOidcStart();
    }
    auth.close();
    auth = new Auth(config, dir);
    expect(auth.beginOidcStart('client')).toBe(false);
    expect(auth.beginAttempt('client')).toBe(false);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 15 * 60_000 + 1);
    expect(auth.beginOidcStart('client')).toBe(true);
    auth.finishOidcStart();
    expect(auth.beginAttempt('client')).toBe(true);
    auth.finishAttempt();
  });

  it('caps OIDC starts across clients without spending the global password budget', () => {
    for (let client = 0; client < 6; client++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(auth.beginOidcStart(`client-${client}`)).toBe(true);
        auth.finishOidcStart();
      }
    }
    expect(auth.beginOidcStart('new-client')).toBe(false);
    expect(auth.beginAttempt('new-client')).toBe(true);
    auth.finishAttempt();
  });

  it('bounds concurrent OIDC starts separately from password checks', () => {
    expect(auth.beginOidcStart('one')).toBe(true);
    expect(auth.beginOidcStart('two')).toBe(true);
    expect(auth.beginOidcStart('three')).toBe(false);
    expect(auth.beginAttempt('one')).toBe(true);
    auth.finishAttempt();
    auth.finishOidcStart();
    expect(auth.beginOidcStart('three')).toBe(true);
    auth.finishOidcStart();
    auth.finishOidcStart();
  });

  it('serves narrow Lax transaction cookies, Strict sessions and safe callback errors; protects linking with CSRF and origin', async () => {
    const handler = createAuthHandler(auth, {
      probeProwlarr: async () => ({ ok: false, error: 'not used' }),
    });
    const server = createServer((req, res) => {
      void handler(req, res, new URL(req.url!, config.APP_ORIGIN).pathname);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      const local = auth.startSession(false)!;
      const headers = {
        Origin: config.APP_ORIGIN,
        'Content-Type': 'application/json',
        Cookie: `${auth.cookieName}=${local.token}`,
        'X-CSRF-Token': local.csrf,
      };
      expect(
        (
          await fetch(`${base}/api/auth/oidc/link`, {
            method: 'POST',
            headers: { ...headers, Origin: 'https://attacker.test' },
            body: '{}',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${base}/api/auth/oidc/link`, {
            method: 'POST',
            headers: { ...headers, 'X-CSRF-Token': 'wrong' },
            body: '{}',
          })
        ).status,
      ).toBe(403);
      const start = await fetch(`${base}/api/auth/oidc/link`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ password: 'fixture-password' }),
      });
      expect(start.status).toBe(200);
      authorization = new URL((await start.json()).url);
      const cookie = start.headers.get('set-cookie')!;
      expect(cookie).toContain('HttpOnly; SameSite=Lax; Max-Age=300; Secure');
      expect(cookie).toContain('Path=/api/auth/oidc/callback');
      const response = await fetch(
        `${base}/api/auth/oidc/callback?code=fixture-code&state=${authorization.searchParams.get('state')}`,
        { headers: { Cookie: cookie.split(';')[0]! }, redirect: 'manual' },
      );
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe('/');
      expect(response.headers.get('set-cookie')).toContain('SameSite=Strict; Secure');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const rejected = await fetch(`${base}/api/auth/oidc/callback?code=secret-code&state=invalid`);
      expect(rejected.status).toBe(400);
      expect(await rejected.text()).not.toContain('secret-code');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
