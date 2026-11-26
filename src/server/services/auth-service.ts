import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { argon2id, hash, verify } from 'argon2';
import { isPrivateNetworkHost } from '../lib/network-scope.js';
import { OidcService } from './oidc-service.js';
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
const TRUSTED_DEVICE_DAYS = 180;
const MAX_PROXY_HOPS = 10;
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

/** TRUST_PROXY: unset or `false` trusts no proxy, `true` one, or a number of proxy hops. */
function parseTrustProxy(value: string | undefined): number {
  if (!value || value === 'false') return 0;
  if (value === 'true') return 1;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0 || hops > MAX_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY must be true, false or a number of proxy hops up to ${MAX_PROXY_HOPS}`,
    );
  }
  return hops;
}

export type StartedSession = { token: string; csrf: string; maxAgeSeconds?: number };

/** Who a sign-in attempt is counted against: a trusted device, or else the client address. */
export type AttemptIdentity = { key: string; trustedDevice: boolean };

/** The single owner account: credentials, browser sessions, sign-in throttling and onboarding. */
export class Auth {
  private store: AuthStore;
  private activeAttempts = 0;
  private activeOidcStarts = 0;
  readonly origin: string;
  readonly secure: boolean;
  readonly cookieName: string;
  readonly deviceCookieName: string;
  readonly proxyHops: number;
  readonly oidc: OidcService;

  constructor(env: Record<string, string | undefined>, dataDir: string) {
    const appOrigin = parseAppOrigin(env.APP_ORIGIN);
    this.origin = appOrigin.origin;
    this.secure = appOrigin.protocol === 'https:';
    this.cookieName = this.secure ? '__Host-match_session' : 'match_session';
    this.deviceCookieName = this.secure ? '__Host-match_device' : 'match_device';
    this.proxyHops = parseTrustProxy(env.TRUST_PROXY);
    this.store = new AuthStore(join(dataDir, 'match.sqlite'));
    try {
      this.oidc = new OidcService(env, this);
    } catch (error) {
      this.store.close();
      throw error;
    }
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
      oidc: this.oidc.status(),
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
    const session = this.sessionById(sha256Hex(token));
    if (!session) return undefined;

    this.store.updateSessionSeen(session.id, Date.now());
    return session;
  }

  sessionById(id: string): Session | undefined {
    const session = this.store.session(id);
    if (!session) return undefined;

    const now = Date.now();
    if (
      session.expires <= now ||
      session.seen < now - SESSION_IDLE_TIMEOUT_MS ||
      !this.oidc.isSessionAllowed(id)
    ) {
      this.store.deleteSession(session.id);
      return undefined;
    }
    return session;
  }

  /** Called inside the OIDC identity/session transaction. */
  startOidcSession(expires: number, replacing?: Session): StartedSession {
    const token = generateRandomToken();
    const csrf = generateRandomToken();
    if (replacing) this.store.deleteSession(replacing.id);
    this.store.saveSession(sha256Hex(token), csrf, Date.now(), expires, SESSION_IDLE_TIMEOUT_MS);
    return { token, csrf, maxAgeSeconds: Math.max(0, Math.floor((expires - Date.now()) / 1000)) };
  }

  sessions(current: Session) {
    return this.store.activeSessions(Date.now(), SESSION_IDLE_TIMEOUT_MS).map((session) => ({
      ...session,
      method: this.oidc.sessionMethod(session.id),
      current: session.id === current.id,
    }));
  }

  revokeSessions(id?: string) {
    if (id) this.store.deleteSession(id);
    else this.store.deleteAllSessions();
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
   * The client's address. With TRUST_PROXY, the address each trusted proxy reported in
   * X-Forwarded-For, counted from the right so a client cannot spoof it by adding entries.
   */
  clientAddress(req: IncomingMessage): string {
    const socket = req.socket.remoteAddress || 'unknown';
    if (!this.proxyHops) return socket;
    const header = req.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(header) ? header.join(',') : header || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const chain = [...forwarded, socket];
    const client = chain[Math.max(0, chain.length - 1 - this.proxyHops)]!;
    return isIP(client) ? client : socket;
  }

  /** Sign-in attempts from a trusted device are counted per device; others per address. */
  attemptIdentity(req: IncomingMessage, deviceToken: string | undefined): AttemptIdentity {
    const device = this.trustedDeviceKey(deviceToken);
    return device
      ? { key: device, trustedDevice: true }
      : { key: this.clientAddress(req), trustedDevice: false };
  }

  /** `device:<hash>` for a live device token, else undefined. */
  trustedDeviceKey(token: string | undefined): string | undefined {
    if (!token || token.length > MAX_SESSION_TOKEN_LENGTH) return undefined;
    const hash = sha256Hex(token);
    return this.store.hasDevice(hash, Date.now()) ? `device:${hash}` : undefined;
  }

  /**
   * Marks the browser that just signed in as trusted. Its later attempts skip the shared
   * per-address and global limits, so someone else's failures cannot lock the owner out.
   */
  issueDevice(): { token: string; maxAgeSeconds: number } {
    const token = generateRandomToken();
    const now = Date.now();
    const ttlMs = TRUSTED_DEVICE_DAYS * 86_400_000;
    this.store.saveDevice(sha256Hex(token), now, now + ttlMs);
    return { token, maxAgeSeconds: ttlMs / 1000 };
  }

  /**
   * Admits one credential attempt unless this client's or all clients' recent failures, or
   * concurrent hashing, are over the limit. A trusted device is held only to its own limit.
   * Every admitted attempt must be paired with finishAttempt(); only failures are counted
   * (see recordFailedAttempt).
   */
  beginAttempt(clientKey: string, trustedDevice = false): boolean {
    this.store.purgeExpiredAttempts(Date.now());
    const { clientCount, globalCount } = this.store.attempts(clientKey);
    if (
      this.activeAttempts >= MAX_CONCURRENT_ATTEMPTS ||
      (!trustedDevice && globalCount >= MAX_ATTEMPTS_GLOBAL) ||
      clientCount >= MAX_ATTEMPTS_PER_CLIENT
    ) {
      return false;
    }
    this.activeAttempts++;
    return true;
  }

  beginOidcStart(clientKey: string): boolean {
    if (this.activeOidcStarts >= MAX_CONCURRENT_ATTEMPTS) return false;
    return this.store.inTransaction(() => {
      this.store.purgeExpiredAttempts(Date.now());
      const key = `oidc:${clientKey}`;
      const { clientCount, globalCount } = this.store.attempts(key, 'oidc:global');
      if (globalCount >= MAX_ATTEMPTS_GLOBAL || clientCount >= MAX_ATTEMPTS_PER_CLIENT)
        return false;
      this.store.recordAttempt(key, Date.now() + RATE_LIMIT_WINDOW_MS, 'oidc:global');
      this.activeOidcStarts++;
      return true;
    });
  }

  finishOidcStart(): void {
    this.activeOidcStarts--;
  }

  finishAttempt(): void {
    this.activeAttempts--;
  }

  /** A trusted device's failures count only against that device, not the global budget. */
  recordFailedAttempt(clientKey: string, trustedDevice = false): void {
    this.store.recordAttempt(
      clientKey,
      Date.now() + RATE_LIMIT_WINDOW_MS,
      trustedDevice ? null : 'global',
    );
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
      this.store.deleteAllDevices();
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
      this.store.deleteAllDevices();
      this.store.clearAttempts();
    });
  }

  completeOnboardingStage(stage: unknown): void {
    if (stage === 'trackers') this.store.meta('onboarding-step', 'trackers');
    else this.store.setOnboarded();
  }

  resetOnboarding(): void {
    this.oidc.unlink();
    this.store.resetOnboarding();
  }

  close(): void {
    this.oidc.close();
    this.store.close();
  }
}
