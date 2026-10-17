import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { argon2id, hash, verify } from 'argon2';
import { isPrivateNetworkHost } from '../lib/network-scope.js';
import {
  AuthStore,
  type OwnerRecord as Owner,
  type SessionRecord as Session,
} from '../storage/auth-store.js';

export type { Session };

const SESSION_IDLE_TIMEOUT_MS = 12 * 3_600_000;
const REMEMBERED_SESSION_DAYS = 30;
const MAX_SESSION_TOKEN_LENGTH = 100;
const MAX_PASSWORD_BYTES = 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
const MAX_CONCURRENT_ATTEMPTS = 2;
const MAX_ATTEMPTS_PER_CLIENT = 10;
const MAX_ATTEMPTS_GLOBAL = 60;
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateRandomToken(): string {
  return randomBytes(32).toString('base64url');
}

function timingSafeStringEqual(left: string, right: string): boolean {
  return timingSafeEqual(Buffer.from(sha256Hex(left)), Buffer.from(sha256Hex(right)));
}

function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

function isPasswordWithinLimit(password: unknown): password is string {
  return typeof password === 'string' && Buffer.byteLength(password) <= MAX_PASSWORD_BYTES;
}

function parseAppOrigin(configured: string | undefined): URL {
  const origin = configured || 'http://localhost:5178';
  const url = new URL(origin);
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('APP_ORIGIN must be an exact HTTP(S) origin without a trailing slash');
  }
  // Plain HTTP is accepted on private networks, the usual home-server setup; public names need HTTPS.
  if (url.protocol !== 'https:' && !isPrivateNetworkHost(url.hostname)) {
    throw new Error('APP_ORIGIN must use HTTPS for public hostnames');
  }
  return url;
}

export type StartedSession = { token: string; csrf: string; maxAgeSeconds?: number };

/** The single owner account: credentials, browser sessions, sign-in throttling and onboarding. */
export class Auth {
  private store: AuthStore;
  private activeAttempts = 0;
  readonly origin: string;
  readonly secure: boolean;
  readonly cookieName: string;

  constructor(env: Record<string, string | undefined>, dataDir: string) {
    const appOrigin = parseAppOrigin(env.APP_ORIGIN);
    this.origin = appOrigin.origin;
    this.secure = appOrigin.protocol === 'https:';
    this.cookieName = this.secure ? '__Host-match_session' : 'match_session';
    this.store = new AuthStore(join(dataDir, 'match.sqlite'));
  }

  get db(): DatabaseSync {
    return this.store.db;
  }

  owner(): Owner | undefined {
    return this.store.owner();
  }

  meta(key: string, value?: string): string | undefined {
    return this.store.meta(key, value);
  }

  status(session?: Pick<Session, 'csrf'>) {
    const owner = this.owner();
    return {
      setup: !owner,
      authenticated: !!session,
      username: session ? owner?.username : undefined,
      csrf: session?.csrf,
      onboarded: !!owner?.onboarded,
      step: this.meta('onboarding-step') || 'connection',
    };
  }

  credentials(input: Record<string, unknown>): { username: string; password: string } {
    const { username, password } = input;
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      username.trim().length > 64 ||
      !isPasswordWithinLimit(password) ||
      [...password].length < 8
    ) {
      throw new Error(
        'Choose a username and a password of at least 8 characters (maximum 1024 bytes).',
      );
    }
    return { username: username.trim(), password };
  }

  /** Returns the live session for a cookie token; expired or idle sessions are removed. */
  findSession(token: string | undefined): Session | undefined {
    if (!token || token.length > MAX_SESSION_TOKEN_LENGTH) return undefined;
    const session = this.store.session(sha256Hex(token));
    if (!session) return undefined;

    const now = Date.now();
    if (session.expires <= now || session.seen < now - SESSION_IDLE_TIMEOUT_MS) {
      this.store.deleteSession(session.id);
      return undefined;
    }
    this.store.updateSessionSeen(session.id, now);
    return session;
  }

  /**
   * Starts a session, replacing the caller's previous one. With `expectedPassword` (the hash a
   * login was verified against), nothing is created if the password has changed since; the
   * check and insert share one transaction so a reset in another process cannot slip between.
   */
  startSession(
    remember: boolean,
    replacing?: Session,
    expectedPassword?: string,
  ): StartedSession | undefined {
    const token = generateRandomToken();
    const csrf = generateRandomToken();
    const now = Date.now();
    const ttlMs = (remember ? REMEMBERED_SESSION_DAYS : 1) * 86_400_000;
    const started = this.store.inTransaction(() => {
      if (expectedPassword !== undefined && this.owner()?.password !== expectedPassword) {
        return false;
      }
      if (replacing) this.store.deleteSession(replacing.id);
      this.store.saveSession(sha256Hex(token), csrf, now, now + ttlMs, SESSION_IDLE_TIMEOUT_MS);
      return true;
    });
    return started
      ? { token, csrf, maxAgeSeconds: remember ? ttlMs / 1000 : undefined }
      : undefined;
  }

  endSession(session: Session): void {
    this.store.deleteSession(session.id);
  }

  csrfMatches(session: Session, presented: unknown): boolean {
    return typeof presented === 'string' && timingSafeStringEqual(presented, session.csrf);
  }

  /**
   * Admits one credential attempt unless this client's or all clients' recent failures, or
   * concurrent hashing, are over the limit. Every admitted attempt must be paired with
   * finishAttempt(); only failures are counted (see recordFailedAttempt).
   */
  beginAttempt(clientKey: string): boolean {
    this.store.purgeExpiredAttempts(Date.now());
    const { clientCount, globalCount } = this.store.attempts(clientKey);
    if (
      this.activeAttempts >= MAX_CONCURRENT_ATTEMPTS ||
      globalCount >= MAX_ATTEMPTS_GLOBAL ||
      clientCount >= MAX_ATTEMPTS_PER_CLIENT
    ) {
      return false;
    }
    this.activeAttempts++;
    return true;
  }

  finishAttempt(): void {
    this.activeAttempts--;
  }

  recordFailedAttempt(clientKey: string): void {
    this.store.recordAttempt(clientKey, Date.now() + RATE_LIMIT_WINDOW_MS);
  }

  /** A successful sign-in clears this client's failures; the global count still expires normally. */
  clearFailedAttempts(clientKey: string): void {
    this.store.clearClientAttempts(clientKey);
  }

  async createOwner(input: Record<string, unknown>): Promise<void> {
    const { username, password } = this.credentials(input);
    this.store.createOwner(username, await hashPassword(password));
  }

  /**
   * Returns the password hash the credentials were verified against, or undefined. Pass it to
   * startSession so a reset that lands during the slow hash cannot yield a session.
   */
  async verifyLogin(input: Record<string, unknown>): Promise<string | undefined> {
    const owner = this.owner();
    if (!owner || typeof input.username !== 'string' || !isPasswordWithinLimit(input.password)) {
      return undefined;
    }
    const isPasswordValid = await verify(owner.password, input.password);
    const isOwner = isPasswordValid && timingSafeStringEqual(input.username, owner.username);
    return isOwner ? owner.password : undefined;
  }

  /** Returns false when `currentPassword` is wrong; throws when the new password is invalid. */
  async changePassword(currentPassword: unknown, newPassword: unknown): Promise<boolean> {
    const owner = this.owner()!;
    if (
      !isPasswordWithinLimit(currentPassword) ||
      !(await verify(owner.password, currentPassword))
    ) {
      return false;
    }
    const { password } = this.credentials({ username: owner.username, password: newPassword });
    const passwordHash = await hashPassword(password);
    this.store.inTransaction(() => {
      if (this.owner()?.password !== owner.password) {
        throw new Error('Credentials changed. Retry.');
      }
      this.store.setPassword(passwordHash);
      this.store.deleteAllSessions();
    });
    return true;
  }

  async resetPassword(password: string): Promise<void> {
    const owner = this.owner();
    if (!owner) throw new Error('No owner exists. Complete first-run setup instead.');
    this.credentials({ username: owner.username, password });
    const passwordHash = await hashPassword(password);
    // An administrative reset also lifts any sign-in lockout; an in-app change does not.
    this.store.inTransaction(() => {
      this.store.setPassword(passwordHash);
      this.store.deleteAllSessions();
      this.store.clearAttempts();
    });
  }

  completeOnboardingStage(stage: unknown): void {
    if (stage === 'trackers') this.store.meta('onboarding-step', 'trackers');
    else this.store.setOnboarded();
  }

  resetOnboarding(): void {
    this.store.resetOnboarding();
  }

  close(): void {
    this.store.close();
  }
}
