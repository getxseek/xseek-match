import { Ban, Check, Copy, EyeOff, KeyRound, PlugZap, Plus, ShieldX } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { API_SCOPES, type ApiScope, type PublicApiKey } from '../../../../contracts/api-v1';
import { Button } from '../../../components/ui/button';
import { PasswordInput } from '../../../components/ui/password-input';
import { SettingsSection } from '../../../components/ui/settings-section';
import { authFetch, responseJson } from '../../auth/auth-client';
import './api-access.css';

const SCOPE_LABELS: Record<ApiScope, string> = {
  'search:read': 'Search releases',
  'titles:read': 'Look up titles',
  'indexers:read': 'List indexers',
};
const KEY_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
type KeyAction = 'create' | 'revoke' | 'revoke-all';
type Notice = { kind: 'success' | 'error' | 'info'; message: string };

function keyDate(value: number | null, empty: string): string {
  return value === null ? empty : KEY_DATE_FORMAT.format(value);
}
function keyState(key: PublicApiKey): 'Active' | 'Expired' | 'Revoked' {
  if (key.revokedAt !== null) return 'Revoked';
  if (key.expiresAt !== null && key.expiresAt <= Date.now()) return 'Expired';
  return 'Active';
}

export function ApiAccessPanel() {
  const [keys, setKeys] = useState<PublicApiKey[]>([]);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['search:read', 'titles:read']);
  const [noExpiry, setNoExpiry] = useState(false);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const response = await authFetch('/api/auth/keys');
    const data = await responseJson(response);
    if (!response.ok) throw new Error('Could not load API keys.');
    setKeys(data.keys);
  }
  useEffect(() => {
    void load()
      .catch((error) => setNotice({ kind: 'error', message: error.message }))
      .finally(() => setLoading(false));
  }, []);

  async function manage(action: KeyAction, id?: string) {
    setBusy(true);
    setNotice(null);
    setPasswordError('');
    try {
      const response = await authFetch('/api/auth/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          id,
          name,
          scopes,
          password,
          ...(noExpiry ? { expiresAt: null } : {}),
        }),
      });
      const data = await responseJson(response);
      if (response.status === 401) {
        setPasswordError(data.error || 'Verify your current password.');
        return;
      }
      if (!response.ok) throw new Error(data.error);
      if (data.token) {
        setToken(data.token);
        setName('');
      }
      setPassword('');
      setNotice({
        kind: 'success',
        message: action === 'create' ? 'Key created.' : 'Key access revoked.',
      });
      try {
        await load();
      } catch {
        setNotice({ kind: 'error', message: 'Changes saved. Could not refresh the key list.' });
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not manage API keys.',
      });
    } finally {
      setBusy(false);
    }
  }
  async function copyKey() {
    try {
      await navigator.clipboard.writeText(token);
      setNotice({ kind: 'success', message: 'Key copied.' });
    } catch {
      setNotice({ kind: 'info', message: 'Select and copy the key manually.' });
    }
  }
  async function testKey() {
    setTesting(true);
    setNotice(null);
    try {
      const response = await fetch('/api/v1/me', { headers: { Authorization: `Bearer ${token}` } });
      setNotice(
        response.ok
          ? { kind: 'success', message: 'Connection works.' }
          : { kind: 'error', message: 'Key test failed. Check expiry and API availability.' },
      );
    } catch {
      setNotice({ kind: 'error', message: 'Could not connect to API v1.' });
    } finally {
      setTesting(false);
    }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    void manage('create');
  }

  return (
    <SettingsSection
      className="api-access-panel"
      headingId="api-access-heading"
      title="API access"
      help="Rotate by creating a replacement, then revoke the old key."
    >
      <p className="api-access-intro">Give each application its own scoped key.</p>
      {notice && (
        <p
          className={`api-access-notice api-access-notice-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.kind === 'success' && <Check size={17} aria-hidden="true" />}
          {notice.message}
        </p>
      )}
      {token ? (
        <div className="api-new-key">
          <h3>Save your key</h3>
          <p>Copy it before leaving this page.</p>
          <textarea
            aria-label="New API key (shown once)"
            readOnly
            value={token}
            rows={2}
            spellCheck={false}
          />
          <div className="api-access-toolbar" aria-label="New key actions">
            <Button type="button" variant="ghost" onClick={() => void copyKey()}>
              <Copy size={16} aria-hidden="true" />
              Copy key
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={testing}
              aria-busy={testing}
              onClick={() => void testKey()}
            >
              <PlugZap size={16} aria-hidden="true" />
              Test key
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={testing}
              onClick={() => {
                setToken('');
                setNotice(null);
              }}
            >
              <EyeOff size={16} aria-hidden="true" />
              Hide key
            </Button>
          </div>
          <details className="api-request-example">
            <summary>Example request</summary>
            <pre>{`curl -H "Authorization: Bearer $MATCH_API_KEY" "${location.origin}/api/v1/me"`}</pre>
          </details>
        </div>
      ) : (
        <form className="api-access-form" onSubmit={create}>
          <label className="api-access-field">
            Key name
            <input
              required
              maxLength={80}
              value={name}
              disabled={busy}
              placeholder="e.g. Media dashboard"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <fieldset className="api-access-scopes" disabled={busy}>
            <legend>Allowed operations</legend>
            <div>
              {API_SCOPES.map((scope) => (
                <label key={scope}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(event) =>
                      setScopes(
                        event.target.checked
                          ? [...scopes, scope]
                          : scopes.filter((item) => item !== scope),
                      )
                    }
                  />
                  <span>
                    {SCOPE_LABELS[scope]}
                    <code>{scope}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="api-access-check">
            <input
              type="checkbox"
              checked={noExpiry}
              disabled={busy}
              onChange={(event) => setNoExpiry(event.target.checked)}
            />
            <span>No expiry</span>
            <small>Default: 90 days</small>
          </label>
          <div className="api-access-field">
            <label htmlFor="api-key-password">Current password for key changes</label>
            <PasswordInput
              id="api-key-password"
              required
              autoComplete="current-password"
              value={password}
              disabled={busy}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? 'api-key-password-error' : undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError('');
              }}
              showLabel="Show key verification password"
              hideLabel="Hide key verification password"
            />
            {passwordError && (
              <p id="api-key-password-error" className="api-password-error" role="alert">
                {passwordError}
              </p>
            )}
          </div>
          <Button
            variant="secondary"
            className="api-create-key"
            disabled={busy || !scopes.length}
            aria-busy={busy}
          >
            <Plus size={16} aria-hidden="true" />
            {busy ? 'Saving…' : 'Create key'}
          </Button>
        </form>
      )}
      <div className="api-key-list-heading">
        <h3>
          <KeyRound size={17} aria-hidden="true" />
          Keys
        </h3>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !password || !keys.some((key) => key.revokedAt === null)}
          onClick={() => void manage('revoke-all')}
        >
          <ShieldX size={16} aria-hidden="true" />
          Revoke all keys
        </Button>
      </div>
      {loading && (
        <p className="api-access-muted" role="status">
          Loading keys…
        </p>
      )}
      {!loading && !keys.length && <p className="api-access-muted">No keys yet.</p>}
      <ul className="api-key-list">
        {keys.map((key) => {
          const state = keyState(key);
          return (
            <li key={key.id}>
              <div className="api-key-row-heading">
                <strong>{key.name}</strong>
                <span className="api-key-state" data-state={state}>
                  {state === 'Active' ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Ban size={15} aria-hidden="true" />
                  )}
                  {state}
                </span>
                {state !== 'Revoked' && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={`Revoke ${key.name}`}
                    disabled={busy || !password}
                    onClick={() => void manage('revoke', key.id)}
                  >
                    <Ban size={15} aria-hidden="true" />
                    Revoke
                  </Button>
                )}
              </div>
              <code className="api-key-prefix">{key.prefix}</code>
              <p className="api-key-scopes">{key.scopes.join(', ')}</p>
              <dl className="api-key-dates">
                <div>
                  <dt>Created</dt>
                  <dd>{keyDate(key.createdAt, '')}</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{keyDate(key.expiresAt, 'Never')}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{keyDate(key.lastUsedAt, 'Never')}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
    </SettingsSection>
  );
}
