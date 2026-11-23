import { createHash, createPublicKey, randomBytes, type webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as client from 'openid-client';
import type { Auth, Session } from './auth-service.js';
import { OidcStore } from '../storage/oidc-store.js';
import { withImmediateTransaction } from '../storage/migrations.js';
import { readJson, UpstreamPolicy } from './upstream-policy.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const MAX_TRANSACTION_MS = 5 * 60_000;
export const OIDC_STATE_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

function isCompatibleSigningKey(value: unknown, algorithm: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const key = value as webcrypto.JsonWebKey;
  if (key.d || (key.alg && key.alg !== algorithm) || (key.use && key.use !== 'sig')) return false;
  if (key.key_ops && (!Array.isArray(key.key_ops) || !key.key_ops.includes('verify'))) return false;
  try {
    const type = createPublicKey({ key, format: 'jwk' }).asymmetricKeyType;
    if (algorithm.startsWith('RS') || algorithm.startsWith('PS')) return type === 'rsa';
    if (algorithm.startsWith('ES')) return type === 'ec';
    return type === 'ed25519' || type === 'ed448';
  } catch {
    return false;
  }
}

export class OidcService {
  readonly enabled: boolean;
  readonly displayName: string;
  readonly callback: string;
  readonly issuer?: string;
  private readonly secret?: string;
  private readonly clientId?: string;
  private readonly authMethod: string;
  private readonly signingAlgorithm: string;
  private readonly store: OidcStore;
  private configuration?: Promise<client.Configuration>;
  private pruneTimer?: ReturnType<typeof setInterval>;
  private readonly http = new UpstreamPolicy();

  constructor(
    env: Record<string, string | undefined>,
    private readonly auth: Auth,
  ) {
    this.store = new OidcStore(auth.db);
    if (env.OIDC_ENABLED && !['true', 'false'].includes(env.OIDC_ENABLED)) {
      throw new Error('OIDC_ENABLED must be true or false');
    }
    this.enabled = env.OIDC_ENABLED === 'true';
    this.displayName = (env.OIDC_DISPLAY_NAME || 'OpenID Connect').slice(0, 80);
    this.callback = `${auth.origin}/api/auth/oidc/callback`;
    this.authMethod = env.OIDC_TOKEN_AUTH_METHOD || 'client_secret_basic';
    this.signingAlgorithm = env.OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG || 'RS256';
    if (!this.enabled) {
      this.store.disable();
      return;
    }
    if (!auth.secure)
      throw new Error('OIDC requires an HTTPS APP_ORIGIN for secure transaction cookies');
    if (env.OIDC_CLIENT_SECRET && env.OIDC_CLIENT_SECRET_FILE) {
      throw new Error('Configure only one OIDC client secret source');
    }
    this.secret = env.OIDC_CLIENT_SECRET_FILE
      ? readFileSync(env.OIDC_CLIENT_SECRET_FILE, 'utf8').trim()
      : env.OIDC_CLIENT_SECRET;
    this.clientId = env.OIDC_CLIENT_ID;
    if (!env.APP_ORIGIN || !env.OIDC_ISSUER || !this.clientId || !this.secret) {
      throw new Error('OIDC requires APP_ORIGIN, OIDC_ISSUER, OIDC_CLIENT_ID and a client secret');
    }
    const issuer = new URL(env.OIDC_ISSUER);
    if (
      issuer.protocol !== 'https:' ||
      issuer.username ||
      issuer.password ||
      issuer.hash ||
      issuer.search
    ) {
      throw new Error(
        'OIDC_ISSUER must be an HTTPS issuer URL without credentials, query or fragment',
      );
    }
    if (!['client_secret_basic', 'client_secret_post'].includes(this.authMethod)) {
      throw new Error('OIDC_TOKEN_AUTH_METHOD must be client_secret_basic or client_secret_post');
    }
    if (
      ![
        'RS256',
        'RS384',
        'RS512',
        'PS256',
        'PS384',
        'PS512',
        'ES256',
        'ES384',
        'ES512',
        'EdDSA',
        'Ed25519',
      ].includes(this.signingAlgorithm)
    ) {
      throw new Error(
        'OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG must be a supported asymmetric signing algorithm',
      );
    }
    // The issuer identifier is case-sensitive and exact, including a possible trailing slash.
    this.issuer = env.OIDC_ISSUER;
    this.store.removeOtherIssuerSessions(this.issuer);
    this.pruneTimer = setInterval(() => this.store.prune(), 60_000);
    this.pruneTimer.unref();
  }

  status() {
    const identity = this.store.identity();
    return {
      enabled: this.enabled,
      displayName: this.displayName,
      linked: !!identity,
      loginAvailable: this.enabled && identity?.issuer === this.issuer,
    };
  }

  private config(): Promise<client.Configuration> {
    if (!this.enabled) throw new Error('disabled');
    return (this.configuration ??= client
      .discovery(
        new URL(this.issuer!),
        this.clientId!,
        { client_secret: this.secret, id_token_signed_response_alg: this.signingAlgorithm },
        this.authMethod === 'client_secret_post'
          ? client.ClientSecretPost(this.secret)
          : client.ClientSecretBasic(this.secret),
        {
          timeout: 10,
          execute: [client.enableNonRepudiationChecks],
          [client.customFetch]: (url, options) => {
            const body =
              options.body instanceof Uint8Array ? new Uint8Array(options.body) : options.body;
            return this.http.fetch(url, { ...options, body });
          },
        },
      )
      .then((config) => {
        if (config.serverMetadata().issuer !== this.issuer) throw new Error('issuer_mismatch');
        for (const endpoint of [
          config.serverMetadata().authorization_endpoint,
          config.serverMetadata().token_endpoint,
          config.serverMetadata().jwks_uri,
        ]) {
          if (!endpoint) throw new Error('invalid_metadata');
          const url = new URL(endpoint);
          if (url.protocol !== 'https:' || url.username || url.password || url.hash)
            throw new Error('invalid_metadata');
        }
        return config;
      })
      .catch(() => {
        this.configuration = undefined;
        throw new Error('provider_unavailable');
      }));
  }

  async diagnose() {
    this.configuration = undefined;
    const metadata = (await this.config()).serverMetadata();
    if (
      !metadata.response_types_supported?.includes('code') ||
      !(metadata.token_endpoint_auth_methods_supported || ['client_secret_basic']).includes(
        this.authMethod,
      ) ||
      !metadata.id_token_signing_alg_values_supported?.includes(this.signingAlgorithm) ||
      (metadata.code_challenge_methods_supported &&
        !metadata.code_challenge_methods_supported.includes('S256'))
    )
      throw new Error('provider_capabilities_mismatch');
    const response = await this.http.fetch(metadata.jwks_uri!, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('signing_keys_unavailable');
    const document = await readJson(response, 262_144);
    if (
      !document ||
      typeof document !== 'object' ||
      !('keys' in document) ||
      !Array.isArray(document.keys) ||
      !document.keys.some((key) => isCompatibleSigningKey(key, this.signingAlgorithm))
    )
      throw new Error('invalid_signing_keys');
    return {
      ok: true,
      checks: ['discovery', 'code_flow', 'client_auth_method', 'signing_algorithm', 'signing_keys'],
      signInRequired: true,
    };
  }

  audit(
    event:
      | 'callback_rejected'
      | 'login_started'
      | 'link_started'
      | 'login_succeeded'
      | 'owner_linked'
      | 'owner_unlinked',
  ) {
    this.store.audit(event);
  }

  private ownerVersion() {
    return digest(this.auth.owner()?.password || '');
  }
  private identityVersion() {
    return digest(JSON.stringify(this.store.identity() || null));
  }

  async begin(intent: 'login' | 'link', session?: Session, verifiedPassword?: string) {
    if (!this.auth.owner()) throw new Error('owner_required');
    if (intent === 'login' && !this.status().loginAvailable) throw new Error('identity_required');
    const config = await this.config();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const verifier = client.randomPKCECodeVerifier();
    const binding = random();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: this.callback,
      scope: 'openid profile',
      response_type: 'code',
      response_mode: 'query',
      state,
      nonce,
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      ...(intent === 'link' ? { prompt: 'login', max_age: '0' } : {}),
    });
    withImmediateTransaction(this.auth.db, () => {
      if (
        intent === 'link' &&
        (!session ||
          !this.auth.sessionById(session.id) ||
          this.auth.owner()?.password !== verifiedPassword ||
          this.store.identity())
      ) {
        throw new Error('link_not_authorized');
      }
      this.store.save({
        state,
        nonce,
        verifier,
        binding: digest(binding),
        intent,
        session: session?.id || null,
        owner_version: this.ownerVersion(),
        identity_version: this.identityVersion(),
        expires: Date.now() + MAX_TRANSACTION_MS,
      });
    });
    this.audit(intent === 'link' ? 'link_started' : 'login_started');
    return { url: url.href, state, binding };
  }

  async finish(url: URL, binding: string) {
    const state = url.searchParams.get('state') || '';
    if (!OIDC_STATE_PATTERN.test(state) || binding.length > 100)
      throw new Error('invalid_transaction');
    const tx = this.store.consume(state, digest(binding));
    if (!tx) throw new Error('invalid_transaction');
    const tokens = await client.authorizationCodeGrant(await this.config(), url, {
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      pkceCodeVerifier: tx.verifier,
      idTokenExpected: true,
      ...(tx.intent === 'link' ? { maxAge: 0 } : {}),
    });
    const claims = tokens.claims();
    const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (
      !claims ||
      typeof claims.sub !== 'string' ||
      !claims.sub ||
      claims.sub.length > 512 ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= Date.now() ||
      audiences.some((audience) => audience !== this.clientId) ||
      (claims.azp !== undefined && claims.azp !== this.clientId)
    )
      throw new Error('invalid_identity');
    // Tokens are deliberately not persisted or returned to the browser.
    return withImmediateTransaction(this.auth.db, () => {
      if (
        tx.owner_version !== this.ownerVersion() ||
        tx.identity_version !== this.identityVersion()
      ) {
        throw new Error('authorization_changed');
      }
      const existing = this.store.identity();
      let replacing: Session | undefined;
      if (tx.intent === 'link') {
        replacing = tx.session ? this.auth.sessionById(tx.session) : undefined;
        if (!replacing || existing) throw new Error('link_not_authorized');
        this.store.link(claims.iss, claims.sub);
      } else if (!existing || existing.issuer !== claims.iss || existing.subject !== claims.sub) {
        throw new Error('access_denied');
      } else if (tx.session) replacing = this.auth.sessionById(tx.session);
      // Identity linking and session replacement must share this transaction.
      const started = this.auth.startOidcSession(
        Math.min(Date.now() + 3_600_000, claims.exp * 1000),
        replacing,
      );
      this.store.markSession(digest(started.token), claims.iss);
      this.audit(tx.intent === 'link' ? 'owner_linked' : 'login_succeeded');
      return started;
    });
  }

  isSessionAllowed(id: string) {
    const issuer = this.store.sessionIssuer(id);
    return !issuer || (this.enabled && issuer === this.issuer && this.status().linked);
  }

  sessionMethod(id: string): 'oidc' | 'password' {
    return this.store.sessionIssuer(id) ? 'oidc' : 'password';
  }

  /** HTTP callers supply authorization; local onboarding reset omits it. */
  unlink(authorization?: { session: Session; passwordHash: string }): boolean {
    return withImmediateTransaction(this.auth.db, () => {
      if (
        authorization &&
        (authorization.passwordHash !== this.auth.owner()?.password ||
          !this.auth.sessionById(authorization.session.id))
      )
        return false;
      this.store.unlink();
      this.audit('owner_unlinked');
      return true;
    });
  }

  close() {
    clearInterval(this.pruneTimer);
  }
}
