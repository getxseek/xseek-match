import { useEffect, useState } from 'react';
import { Activity, CircleCheck, CircleMinus, Unlink } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { PasswordInput } from '../../../components/ui/password-input';
import { SettingsSection } from '../../../components/ui/settings-section';
import { authFetch } from '../../auth/auth-client';
import './security-panel.css';

type Provider = { enabled: boolean; linked: boolean; displayName: string };

class SecurityRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request(path: string, body?: unknown) {
  const response = await authFetch(
    `/api/auth/${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new SecurityRequestError(data.error || 'Security request failed.', response.status);
  return data;
}

export function SecurityPanel() {
  const [provider, setProvider] = useState<Provider>();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [messageSucceeded, setMessageSucceeded] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    const status = await request('status');
    setProvider(status.oidc);
  }
  useEffect(() => {
    void refresh().catch(() => setMessage('Could not load security settings.'));
  }, []);

  async function action(path: string, body: unknown, success?: string) {
    setBusy(true);
    setMessage('');
    setMessageSucceeded(false);
    setPasswordError('');
    try {
      const result = await request(path, body);
      if (path !== 'oidc/diagnostics') setPassword('');
      if (result.url) {
        location.assign(result.url);
        return;
      }
      if (path === 'oidc/unlink') {
        location.reload();
        return;
      }
      setMessage(success || 'Done.');
      setMessageSucceeded(true);
      await refresh();
    } catch (error) {
      setMessageSucceeded(false);
      if (
        (path === 'oidc/link' || path === 'oidc/unlink') &&
        error instanceof SecurityRequestError &&
        error.status === 401
      ) {
        setPasswordError(error.message);
      } else setMessage(error instanceof Error ? error.message : 'Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsSection title="Security" subtitle={<p>Manage your sign-in provider.</p>}>
      <div className="security-panel">
        <div className="security-card">
          <div className="security-provider-heading">
            <h3>{provider?.displayName || 'OpenID Connect'}</h3>
            {provider?.enabled && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void action('oidc/diagnostics', {}, 'OIDC configuration check passed.')
                }
              >
                <Activity aria-hidden="true" />
                Test OIDC connection
              </Button>
            )}
          </div>
          <div className="security-status-line">
            <span className={`security-state${provider?.linked ? ' is-linked' : ''}`}>
              {provider?.linked ? (
                <CircleCheck aria-hidden="true" />
              ) : (
                <CircleMinus aria-hidden="true" />
              )}
              {!provider
                ? 'Loading'
                : provider.linked
                  ? 'Linked'
                  : provider.enabled
                    ? 'Not linked'
                    : 'Disabled'}
            </span>
            {provider?.linked && <span className="security-status-detail">Ready to sign in</span>}
          </div>
          {provider && !provider.linked && (
            <p className="match-note">
              {provider.enabled
                ? 'Confirm your local password, then sign in with your provider to link this account.'
                : 'Enable OpenID Connect in the server configuration to link an account.'}
            </p>
          )}
          {provider && ((provider.enabled && !provider.linked) || confirmUnlink) && (
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                void action(provider.linked ? 'oidc/unlink' : 'oidc/link', { password });
              }}
            >
              <label>
                Verify local password
                <PasswordInput
                  autoComplete="current-password"
                  value={password}
                  aria-invalid={passwordError ? true : undefined}
                  aria-describedby={passwordError ? 'provider-password-error' : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError('');
                  }}
                  required
                />
              </label>
              {passwordError && (
                <p id="provider-password-error" className="match-note" role="alert">
                  {passwordError}
                </p>
              )}
              <div className="account-actions">
                <Button variant="secondary" disabled={busy}>
                  {busy ? 'Please wait…' : provider.linked ? 'Confirm unlink' : 'Link account'}
                </Button>
                {confirmUnlink && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setConfirmUnlink(false);
                      setPassword('');
                      setPasswordError('');
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </form>
          )}
          {provider?.linked && !confirmUnlink && (
            <div className="security-connection-test security-toolbar">
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmUnlink(true)}>
                <Unlink aria-hidden="true" />
                Unlink provider
              </Button>
            </div>
          )}
          <div
            className={`security-feedback${messageSucceeded ? ' is-success' : ''}`}
            role="status"
          >
            {message && (
              <>
                {messageSucceeded && <CircleCheck aria-hidden="true" />}
                <span>{message}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
