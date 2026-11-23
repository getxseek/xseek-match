# OpenID Connect sign-in

Sign into match through your OpenID Connect provider. Pocket ID is the primary compatibility target. Local password sign-in stays available for setup and recovery.

## Configure the provider

Create a confidential client and register this exact callback:

```text
https://match.example.com/api/auth/oidc/callback
```

For Pocket ID, follow its [client setup guide](https://pocket-id.org/docs/setup/connect-an-app) and allow the intended user or group. Both the browser and match's server/container must reach the provider.

Set these variables and restart match:

```dotenv
APP_ORIGIN=https://match.example.com
OIDC_ENABLED=true
OIDC_ISSUER=https://id.example.com
OIDC_CLIENT_ID=your-client-id
OIDC_CLIENT_SECRET_FILE=/run/secrets/match_oidc_secret
OIDC_DISPLAY_NAME=Pocket ID
```

APP_ORIGIN must be an exact HTTPS origin without a trailing slash. Use the provider's exact issuer identifier, including any path or trailing slash. Private-network HTTPS providers work with normal DNS and trusted certificates; use Node's CA configuration for a private CA.

| Optional setting | Default | Use |
| --- | --- | --- |
| `OIDC_ENABLED` | `false` | Enable provider sign-in |
| `OIDC_CLIENT_SECRET` | unset | Alternative to the secret file; configure one source |
| `OIDC_DISPLAY_NAME` | `OpenID Connect` | Sign-in button label |
| `OIDC_TOKEN_AUTH_METHOD` | `client_secret_basic` | Match client registration; `client_secret_post` also supported |
| `OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG` | `RS256` | Match the client's registered asymmetric signing algorithm |

## Link the owner

1. Complete local owner setup and sign in with its password.
2. Open **Settings → Accounts → Security**. Use **Test OIDC connection** to check discovery, provider capabilities and signing keys. Client credentials and callback registration are verified during sign-in.
3. Enter the local password, choose **Link account**, and authenticate the intended provider account.
4. Test provider sign-in in a private browser. Also test local password sign-in before relying on the provider.

Only the linked issuer and subject can sign in. Another subject is denied even when its email/name matches. To replace the identity, unlink with the local password, then link again.

Provider outages leave local login available. Invalid configuration fails startup; correct it or set `OIDC_ENABLED=false`. Successful discovery checks connectivity, not the complete client registration.

## Session expiry and revocation

Provider sessions expire within **one hour**, or earlier when the ID token expires. Removing access at the provider can leave an existing match session usable until that deadline. Renewal requires another provider sign-in. Query text survives authentication in this tab's session storage.

- Changing or resetting the local password removes all match sessions immediately.
- **Unlink provider** removes the identity link, pending sign-ins and all provider sessions. Local sessions remain.
- Restarting with `OIDC_ENABLED=false` removes provider sessions and pending sign-ins, while retaining the link. Changing issuer removes sessions from the previous issuer; unlink/relink to use the replacement.
- Signing out of match leaves the provider session signed in. Provider-wide and back-channel logout are deferred.

## Local recovery

Reset the password from the server console, even when the provider is offline or OIDC configuration is invalid:

```bash
docker compose exec xseek-match node build/server/reset-password.js
# Native installation:
npm run reset-password
```

Follow the hidden password prompts. Reset revokes all match sessions and clears sign-in throttling. It retains the provider link; unlink a suspect identity after signing in locally.

If the separate API feature is installed, revoke compromised API keys separately. Password reset, unlink and session revocation leave API keys under their own lifecycle.

## Upgrade and rollback

Back up `match.sqlite` consistently before upgrading. OIDC adds four tables without changing existing owner/session records or the schema version. Repeated initialization preserves existing data.

**Before rollback, disable OIDC with the new binary or run its recovery CLI to revoke sessions.** An older binary cannot identify provider sessions and could treat them as ordinary password sessions. Restoring a pre-upgrade backup is another option, with loss of subsequent changes.

## Compatibility and validation

The maintained [openid-client](https://github.com/panva/openid-client) library implements discovery, authorization code flow with S256 PKCE, state/nonce checks and JWT/JWKS validation. Requests use `openid profile`. Match accepts asymmetric RS/PS/ES algorithms and EdDSA/Ed25519; the default is RS256. Linking requests fresh authentication with `max_age=0` and validates `auth_time`.

This release supports confidential clients and GET/query callbacks. It retains no provider tokens. Refresh tokens, userinfo/profile display, groups, multiple owners and optional hiding of password login are deferred.

Run `npm run check` for the signed mock-provider, browser and existing regression suites. Before release, test against deployed Pocket ID: record its version and proxy topology, link/login in a private browser, deny another subject, revoke/unlink sessions, test local login during a provider outage, and run CLI recovery on a disposable database copy.
