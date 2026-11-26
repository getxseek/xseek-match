import { ApiKeys } from '../services/api-key-service.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonObjectBody, sendJson } from '../lib/http-utils.js';
import type { Auth, Session } from '../services/auth-service.js';
import { OIDC_STATE_PATTERN } from '../services/oidc-service.js';
import type { ProwlarrProbeResult } from '../services/prowlarr-service.js';

export interface AuthRouteOptions {
  /** Enables /api/auth/debug/reset-onboarding for local development. */
  development?: boolean;
  /** Dev server only: accept any loopback origin, since Vite may be opened on several ports. */
  allowLoopbackOrigins?: boolean;
  probeProwlarr: () => Promise<ProwlarrProbeResult>;
}

/** Returns true when the request was answered here (an auth endpoint or a rejection). */
export type AuthHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
) => Promise<boolean>;

type SignedInRoute = (
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
) => Promise<void> | void;

class OwnerAuthorizationChanged extends Error {}

const MAX_AUTH_BODY_BYTES = 8_192;
const ATTEMPT_COOLDOWN_SECONDS = '900';

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return readJsonObjectBody(req, MAX_AUTH_BODY_BYTES, {
    requireJsonContentType: true,
    invalidJsonMessage: 'Expected JSON',
    tooLargeMessage: 'Request too large',
  });
}

function isMutation(req: IncomingMessage): boolean {
  return !['GET', 'HEAD'].includes(req.method || '');
}

const LOOPBACK_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;

function isForeignOrigin(req: IncomingMessage, auth: Auth, allowLoopback: boolean): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return true;
  const origin = req.headers.origin;
  if (origin === auth.origin) return false;
  return !(allowLoopback && origin !== undefined && LOOPBACK_ORIGIN.test(origin));
}

function sessionToken(req: IncomingMessage, cookieName: string): string | undefined {
  const prefix = cookieName + '=';
  return req.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

function setSessionCookie(res: ServerResponse, auth: Auth, value: string, maxAge?: number): void {
  const attributes = [
    `${auth.cookieName}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    ...(auth.secure ? ['Secure'] : []),
    ...(maxAge !== undefined ? [`Max-Age=${maxAge}`] : []),
  ];
  res.appendHeader('Set-Cookie', attributes.join('; '));
}

function oidcCookie(res: ServerResponse, auth: Auth, state: string, value = '') {
  res.appendHeader(
    'Set-Cookie',
    `match_oidc_${state}=${value}; Path=/api/auth/oidc/callback; HttpOnly; SameSite=Lax; Max-Age=${value ? 300 : 0}${auth.secure ? '; Secure' : ''}`,
  );
}

function oidcFailure(res: ServerResponse) {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Sign-in failed</title><body><main><h1>Sign-in failed</h1><p>Verification failed or this identity is not linked to the owner. You can retry or sign in with your local password.</p><a href="/">Return to match</a></main></body></html>',
  );
}

function deviceCookie(res: ServerResponse, auth: Auth, value: string, maxAge: number): void {
  res.appendHeader(
    'Set-Cookie',
    `${auth.deviceCookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${auth.secure ? '; Secure' : ''}`,
  );
}

/** Gives a browser that just signed in a device cookie, unless it already holds a live one. */
function rememberDevice(req: IncomingMessage, res: ServerResponse, auth: Auth): void {
  if (auth.trustedDeviceKey(sessionToken(req, auth.deviceCookieName))) return;
  const device = auth.issueDevice();
  deviceCookie(res, auth, device.token, device.maxAgeSeconds);
}

function admitOidcStart(auth: Auth, req: IncomingMessage, res: ServerResponse): boolean {
  if (auth.beginOidcStart(auth.clientAddress(req))) return true;
  res.setHeader('Retry-After', ATTEMPT_COOLDOWN_SECONDS);
  sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
  return false;
}

/** Runs a credential check only if the sign-in throttle admits it; `fail` records a failure. */
async function throttled(
  auth: Auth,
  req: IncomingMessage,
  res: ServerResponse,
  run: (fail: () => void) => Promise<void>,
): Promise<void> {
  const identity = auth.attemptIdentity(req, sessionToken(req, auth.deviceCookieName));
  if (!auth.beginAttempt(identity.key, identity.trustedDevice)) {
    res.setHeader('Retry-After', ATTEMPT_COOLDOWN_SECONDS);
    sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    return;
  }
  try {
    await run(() => auth.recordFailedAttempt(identity.key, identity.trustedDevice));
  } finally {
    auth.finishAttempt();
  }
}

export function createAuthHandler(auth: Auth, options: AuthRouteOptions): AuthHandler {
  const keys = new ApiKeys(auth.db);
  const currentSession = (req: IncomingMessage) =>
    auth.findSession(sessionToken(req, auth.cookieName));

  const respondSignedIn = (
    req: IncomingMessage,
    res: ServerResponse,
    remember: boolean,
    verifiedPassword?: string,
  ) => {
    const started = auth.startSession(remember, currentSession(req), verifiedPassword);
    if (!started) {
      sendJson(res, 401, { error: 'Credentials changed. Sign in again.' });
      return;
    }
    auth.clearFailedAttempts(auth.clientAddress(req));
    const device = auth.trustedDeviceKey(sessionToken(req, auth.deviceCookieName));
    if (device) auth.clearFailedAttempts(device);
    setSessionCookie(res, auth, started.token, started.maxAgeSeconds);
    rememberDevice(req, res, auth);
    sendJson(res, 200, auth.status({ csrf: started.csrf }));
  };

  const setup = (req: IncomingMessage, res: ServerResponse) =>
    throttled(auth, req, res, async () => {
      const input = await readBody(req);
      if (auth.owner()) {
        sendJson(res, 409, { error: 'Owner setup is already complete.' });
        return;
      }
      await auth.createOwner(input);
      respondSignedIn(req, res, input.remember === true);
    });

  const login = (req: IncomingMessage, res: ServerResponse) =>
    throttled(auth, req, res, async (fail) => {
      const input = await readBody(req);
      const verifiedPassword = await auth.verifyLogin(input);
      if (!verifiedPassword) {
        fail();
        sendJson(res, 401, { error: 'Incorrect username or password.' });
        return;
      }
      respondSignedIn(req, res, input.remember === true, verifiedPassword);
    });

  /** Only credential-format errors are safe to show; anything else gets a generic message. */
  const withSafeErrors =
    (route: (req: IncomingMessage, res: ServerResponse) => Promise<void>) =>
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        await route(req, res);
      } catch (error) {
        const message =
          error instanceof Error && error.message.startsWith('Choose')
            ? error.message
            : 'Could not complete authentication. Please retry.';
        sendJson(res, 400, { error: message });
      }
    };

  const publicRoutes: Record<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>> =
    {
      'POST /api/auth/setup': withSafeErrors(setup),
      'POST /api/auth/login': withSafeErrors(login),
    };

  const signedInRoutes: Record<string, SignedInRoute> = {
    'GET /api/auth/sessions': (_req, res, session) => {
      sendJson(res, 200, { sessions: auth.sessions(session) });
    },
    'POST /api/auth/sessions/revoke': async (req, res) => {
      const input = await readBody(req);
      if (
        input.id !== undefined &&
        (typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id))
      ) {
        sendJson(res, 400, { error: 'Invalid session.' });
        return;
      }
      auth.revokeSessions(input.id as string | undefined);
      sendJson(res, 200, { ok: true });
    },
    'POST /api/auth/oidc/link': (req, res, session) =>
      throttled(auth, req, res, async (fail) => {
        const input = await readBody(req);
        const verified = await auth.verifyLogin({
          username: auth.owner()?.username,
          password: input.password,
        });
        if (!verified) {
          fail();
          sendJson(res, 401, { error: 'Current password is incorrect.' });
          return;
        }
        if (!admitOidcStart(auth, req, res)) return;
        try {
          const tx = await auth.oidc.begin('link', session, verified);
          oidcCookie(res, auth, tx.state, tx.binding);
          sendJson(res, 200, { url: tx.url });
        } catch {
          sendJson(res, 503, {
            error:
              'Could not begin linking. Check provider configuration or unlink the existing identity first.',
          });
        } finally {
          auth.finishOidcStart();
        }
      }),
    'POST /api/auth/oidc/unlink': (req, res, session) =>
      throttled(auth, req, res, async (fail) => {
        const input = await readBody(req);
        const verified = await auth.verifyLogin({
          username: auth.owner()?.username,
          password: input.password,
        });
        if (!verified) {
          fail();
          sendJson(res, 401, { error: 'Current password is incorrect.' });
          return;
        }
        if (!auth.oidc.unlink({ session, passwordHash: verified })) {
          sendJson(res, 401, { error: 'Credentials changed. Sign in again.' });
          return;
        }
        sendJson(res, 200, { ok: true });
      }),
    'POST /api/auth/oidc/diagnostics': async (_req, res) => {
      try {
        sendJson(res, 200, await auth.oidc.diagnose());
      } catch {
        sendJson(res, 503, {
          error:
            'OIDC connection check failed. Check the issuer, client authentication method, signing algorithm and provider connectivity.',
        });
      }
    },
    'GET /api/auth/keys': (_req, res) => sendJson(res, 200, { keys: keys.list() }),
    'POST /api/auth/keys': (req, res) =>
      throttled(auth, req, res, async (fail) => {
        const input = await readBody(req);
        const verified = await auth.verifyLogin({
          username: auth.owner()?.username,
          password: input.password,
        });
        if (!verified || verified !== auth.owner()?.password || !currentSession(req)) {
          fail();
          sendJson(res, 401, { error: 'Verify your current password to manage API keys.' });
          return;
        }
        const verifyCurrentOwner = () => {
          // Recheck after password verification inside the protected key-write transaction.
          if (verified !== auth.owner()?.password || !currentSession(req)) {
            throw new OwnerAuthorizationChanged('Credentials changed. Sign in again.');
          }
        };
        try {
          if (input.action === 'revoke') {
            keys.revoke(input.id, verifyCurrentOwner);
            sendJson(res, 200, { ok: true });
          } else if (input.action === 'revoke-all') {
            keys.revokeAll(verifyCurrentOwner);
            sendJson(res, 200, { ok: true });
          } else if (input.action === 'create')
            sendJson(res, 201, keys.create(input, verifyCurrentOwner));
          else sendJson(res, 400, { error: 'Choose a key action.' });
        } catch (error) {
          sendJson(res, error instanceof OwnerAuthorizationChanged ? 401 : 400, {
            error: error instanceof Error ? error.message : 'Could not manage API keys.',
          });
        }
      }),
    'POST /api/auth/logout': (_req, res, session) => {
      auth.endSession(session);
      setSessionCookie(res, auth, '', 0);
      sendJson(res, 200, { ok: true });
    },
    'POST /api/auth/password': (req, res) =>
      throttled(auth, req, res, async (fail) => {
        const input = await readBody(req);
        if (!(await auth.changePassword(input.currentPassword, input.password))) {
          fail();
          sendJson(res, 401, { error: 'Current password is incorrect.' });
          return;
        }
        sendJson(res, 200, { ok: true });
      }),
    'POST /api/auth/onboarding': async (req, res) => {
      const input = await readBody(req);
      auth.completeOnboardingStage(input.stage);
      sendJson(res, 200, { ok: true });
    },
    'POST /api/auth/connection': async (_req, res) => {
      sendJson(res, 200, await options.probeProwlarr());
    },
  };
  if (options.development) {
    signedInRoutes['POST /api/auth/debug/reset-onboarding'] = (_req, res) => {
      auth.resetOnboarding();
      sendJson(res, 200, { ok: true });
    };
  }

  return async (req, res, path) => {
    res.setHeader('Cache-Control', 'no-store');
    const routeKey = `${req.method} ${path}`;
    // Machine API performs its own bearer authentication, never a cookie fallback.
    if (path === '/api/v1' || path.startsWith('/api/v1/')) return false;
    if (path.startsWith('/api/') && req.headers.authorization !== undefined) {
      sendJson(res, 401, { error: 'Bearer credentials are restricted to API v1.' });
      return true;
    }

    if (isMutation(req) && isForeignOrigin(req, auth, options.allowLoopbackOrigins === true)) {
      sendJson(res, 403, { error: 'Request origin is not allowed.' });
      return true;
    }
    if (path === '/api/auth/oidc/callback' && req.method === 'GET') {
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      const url = new URL(req.url || '/', auth.origin);
      const state = url.searchParams.get('state') || '';
      if (!OIDC_STATE_PATTERN.test(state)) {
        oidcFailure(res);
        return true;
      }
      const binding = sessionToken(req, `match_oidc_${state}`) || '';
      oidcCookie(res, auth, state);
      try {
        // Reconstruct the origin from trusted configuration, never from Host or forwarded headers.
        const callback = new URL(auth.oidc.callback);
        callback.search = url.search;
        const started = await auth.oidc.finish(callback, binding);
        setSessionCookie(res, auth, started.token, started.maxAgeSeconds);
        rememberDevice(req, res, auth);
        res.writeHead(303, { Location: '/' });
        res.end();
      } catch {
        auth.oidc.audit('callback_rejected');
        oidcFailure(res);
      }
      return true;
    }
    if (path === '/api/auth/oidc/login' && req.method === 'POST') {
      if (!admitOidcStart(auth, req, res)) return true;
      try {
        const tx = await auth.oidc.begin('login', currentSession(req));
        oidcCookie(res, auth, tx.state, tx.binding);
        sendJson(res, 200, { url: tx.url });
      } catch {
        sendJson(res, 503, {
          error: 'Provider sign-in unavailable. Use local sign-in or retry later.',
        });
      } finally {
        auth.finishOidcStart();
      }
      return true;
    }
    if (routeKey === 'GET /api/auth/status') {
      sendJson(res, 200, auth.status(currentSession(req)));
      return true;
    }
    const publicRoute = publicRoutes[routeKey];
    if (publicRoute) {
      await publicRoute(req, res);
      return true;
    }
    if (!path.startsWith('/api/')) return false;

    const session = currentSession(req);
    if (!session) {
      sendJson(res, 401, { error: 'Please sign in.' });
      return true;
    }
    if (isMutation(req) && !auth.csrfMatches(session, req.headers['x-csrf-token'])) {
      sendJson(res, 403, { error: 'Invalid session verification token. Reload and retry.' });
      return true;
    }

    const signedInRoute = signedInRoutes[routeKey];
    if (signedInRoute) {
      await signedInRoute(req, res, session);
      return true;
    }
    if (path.startsWith('/api/auth/')) {
      sendJson(res, 404, { error: 'Not found' });
      return true;
    }
    return false;
  };
}
