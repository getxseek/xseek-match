import type { IncomingMessage, ServerResponse } from 'node:http';
import { readJsonObjectBody, sendJson } from '../lib/http-utils.js';
import type { Auth, Session } from '../services/auth-service.js';
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
  res.setHeader('Set-Cookie', attributes.join('; '));
}

function clientKey(req: IncomingMessage): string {
  return req.socket.remoteAddress || 'unknown';
}

/** Runs a credential check only if the sign-in throttle admits it. */
async function throttled(
  auth: Auth,
  req: IncomingMessage,
  res: ServerResponse,
  run: () => Promise<void>,
): Promise<void> {
  if (!auth.beginAttempt(clientKey(req))) {
    res.setHeader('Retry-After', ATTEMPT_COOLDOWN_SECONDS);
    sendJson(res, 429, { error: 'Too many attempts. Please try again later.' });
    return;
  }
  try {
    await run();
  } finally {
    auth.finishAttempt();
  }
}

export function createAuthHandler(auth: Auth, options: AuthRouteOptions): AuthHandler {
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
    auth.clearFailedAttempts(clientKey(req));
    setSessionCookie(res, auth, started.token, started.maxAgeSeconds);
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
    throttled(auth, req, res, async () => {
      const input = await readBody(req);
      const verifiedPassword = await auth.verifyLogin(input);
      if (!verifiedPassword) {
        auth.recordFailedAttempt(clientKey(req));
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
    'POST /api/auth/logout': (_req, res, session) => {
      auth.endSession(session);
      setSessionCookie(res, auth, '', 0);
      sendJson(res, 200, { ok: true });
    },
    'POST /api/auth/password': (req, res) =>
      throttled(auth, req, res, async () => {
        const input = await readBody(req);
        if (!(await auth.changePassword(input.currentPassword, input.password))) {
          auth.recordFailedAttempt(clientKey(req));
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

    if (isMutation(req) && isForeignOrigin(req, auth, options.allowLoopbackOrigins === true)) {
      sendJson(res, 403, { error: 'Request origin is not allowed.' });
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
