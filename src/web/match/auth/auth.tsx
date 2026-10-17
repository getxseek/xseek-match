import { ArrowRight, Check, Copy, FlaskConical, Star } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { PasswordInput } from '../../components/ui/password-input';
import { SwitchButton } from '../../components/ui/switch-button';
import { ErrorBoundary } from '../error-boundary';
import App from '../main';
import { loadPreferences, preferences } from '../settings/common/preferences';
import { startTheme } from '../theme/bootstrap';
import { authFetch, setCsrf } from './auth-client';
import './auth.css';
import { warmIndexerIcons } from './warm-indexer-icons';
import { XmCollapseMark } from './xm-collapse-mark';
import { IndexerIcon } from '../results/result-presenters';

type AuthStatus = {
  setup: boolean;
  authenticated: boolean;
  username?: string;
  csrf?: string;
  onboarded: boolean;
  step?: string;
};

type ConnectionProbeResult = {
  ok: boolean;
  count?: number;
  error?: string;
  missing?: string[];
};

/** The step 2 handshake animation always gets at least this long. */
const MIN_CONNECTION_CHECK_MS = 3000;

const MOCK_CONNECTION_FAILURE: ConnectionProbeResult = {
  ok: false,
  error:
    'Could not reach Prowlarr. Check PROWLARR_BASE_URL and container network access, then retry.',
};

async function authRequest(path: string, body?: unknown) {
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
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function ResetCommand({ label, command }: { label: string; command: string }) {
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <div className="reset-command">
      <span>{label}</span>
      <div>
        <code>{command}</code>
        <button
          type="button"
          aria-label={`Copy ${label} command`}
          title={status || 'Copy command'}
          onClick={() => {
            void navigator.clipboard
              .writeText(command)
              .then(() => setStatus('Copied'))
              .catch(() => setStatus('Copy failed'));
          }}
        >
          {status === 'Copied' ? <Check size={15} /> : <Copy size={15} />}
        </button>
      </div>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}

function SetupSteps({ current }: { current: number }) {
  return (
    <ol className="setup-steps" aria-label={`Step ${current} of 3`}>
      {[1, 2, 3].map((step) => (
        <li
          key={step}
          aria-current={step === current ? 'step' : undefined}
          data-complete={step < current}
        >
          <span aria-hidden="true">
            <i />
          </span>
        </li>
      ))}
    </ol>
  );
}

function DebugCorner({
  authenticated,
  onPreview,
}: {
  authenticated: boolean;
  onPreview: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function restartOnboarding() {
    setBusy(true);
    setError('');
    try {
      await authRequest('debug/reset-onboarding', {});
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
      setBusy(false);
    }
  }

  return (
    <div className="onboarding-debug">
      <button
        className="debug-trigger"
        aria-label="Onboarding debug controls"
        title="Onboarding debug"
      >
        <FlaskConical size={16} />
      </button>
      <div className="debug-popover">
        <button disabled={!authenticated || busy} onClick={() => void restartOnboarding()}>
          {busy ? 'Restarting…' : 'Restart onboarding'}
        </button>
        <button disabled={!authenticated || busy} onClick={onPreview}>
          Preview connection failure
        </button>
        <small>
          {authenticated
            ? 'Deletes the test account and sessions. Keeps preferences.'
            : 'Sign in or create an account to replay setup.'}
        </small>
        {error && <small role="alert">{error}</small>}
      </div>
    </div>
  );
}

type AuthCredentialsStepProps = {
  setup?: boolean;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  remember: boolean;
  setRemember: (value: boolean) => void;
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent) => void;
};

function AuthCredentialsStep({
  setup,
  username,
  setUsername,
  password,
  setPassword,
  remember,
  setRemember,
  busy,
  error,
  onSubmit,
}: AuthCredentialsStepProps) {
  return (
    <>
      <form onSubmit={onSubmit}>
        <label>
          <span className="sr-only">Username</span>
          <input
            placeholder="Username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            maxLength={64}
            autoFocus
          />
        </label>
        <label>
          <span className="sr-only">Password</span>
          <PasswordInput
            wrapperClassName="auth-password"
            placeholder="Password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={setup ? 8 : undefined}
          />
        </label>
        <div className="auth-check">
          <span>Remember me on this device</span>
          <SwitchButton
            label="Remember me on this device"
            checked={remember}
            onToggle={() => setRemember(!remember)}
          />
        </div>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <button className="auth-primary" disabled={busy}>
          {busy ? 'Please wait…' : setup ? 'Create account' : 'Sign in'}
        </button>
      </form>

      {!setup && (
        <details>
          <summary>Forgot your password?</summary>
          <div className="reset-commands">
            <ResetCommand
              label="Docker"
              command="docker compose exec xseek-match node build/server/reset-password.js"
            />
            <ResetCommand label="Native installation" command="npm run reset-password" />
            <p>Follow the password prompts.</p>
          </div>
        </details>
      )}
    </>
  );
}

type OnboardingConnectionStepProps = {
  busy: boolean;
  error: string;
  connection: ConnectionProbeResult | null;
  /** Connected, and quietly syncing indexers (and their icons) before showing the result. */
  syncing: boolean;
  onReview: () => void;
  onRetry: () => void;
};

function OnboardingConnectionStep({
  busy,
  error,
  connection,
  syncing,
  onReview,
  onRetry,
}: OnboardingConnectionStepProps) {
  const isSyncing = syncing && Boolean(connection?.ok);
  const isChecking = isSyncing || busy || (!connection && !error);
  const connectionState = isChecking ? 'checking' : connection?.ok ? 'ready' : 'waiting';

  return (
    <>
      <p>We’re connecting to your environment-defined Prowlarr.</p>
      <div
        className={`auth-connection connection-${connectionState}`}
        role="status"
        aria-live="polite"
      >
        {isChecking ? (
          <>
            <div className="connection-handshake" aria-hidden="true">
              <span className="handshake-xm">
                x<b>m</b>
              </span>
              <i />
              <i />
              <i />
              <span className="handshake-prowlarr">
                <img src="/icons/prowlarr.svg" alt="" />
              </span>
            </div>
            {isSyncing ? (
              <>
                <strong>Connected to your Prowlarr</strong>
                <span className="connection-discovered">
                  Syncing your indexers<span className="connection-dots">…</span>
                </span>
              </>
            ) : (
              <strong>
                Connecting to Prowlarr<span className="connection-dots">…</span>
              </strong>
            )}
          </>
        ) : connection?.ok ? (
          <>
            <div className="connection-success" aria-hidden="true">
              <Check size={34} strokeWidth={3.5} />
            </div>
            <strong>Connected</strong>
            <span className="connection-discovered">Discovered {connection.count} indexers</span>
          </>
        ) : (
          <>
            <strong>{connection?.error || 'Connection check failed'}</strong>
            {connection?.missing && <p>Missing: {connection.missing.join(', ')}</p>}
          </>
        )}
      </div>

      {isChecking ? null : connection?.ok ? (
        <button className="auth-primary" disabled={busy} onClick={onReview}>
          Review trackers
        </button>
      ) : (
        <button className="auth-primary" disabled={busy} onClick={onRetry}>
          Retry connection
        </button>
      )}
    </>
  );
}

type DiscoveredTracker = { id: number; name: string; icon?: string };

type OnboardingTrackersStepProps = {
  busy: boolean;
  error: string;
  trackers: DiscoveredTracker[];
  excluded: number[];
  setExcluded: (updater: (prev: number[]) => number[]) => void;
  important: number[];
  setImportant: (updater: (prev: number[]) => number[]) => void;
  onFinish: () => void;
};

function OnboardingTrackersStep({
  busy,
  error,
  trackers,
  excluded,
  setExcluded,
  important,
  setImportant,
  onFinish,
}: OnboardingTrackersStepProps) {
  const enabledCount = trackers.filter((tracker) => !excluded.includes(tracker.id)).length;

  return (
    <>
      <div className="onboarding-tracker-count">
        {busy ? 'Discovering indexers…' : `${trackers.length} discovered`} <span>·</span>{' '}
        {enabledCount} enabled
      </div>

      <div className="onboarding-trackers">
        {busy && trackers.length === 0
          ? Array.from({ length: 8 }, (_, index) => (
              <div className="onboarding-tracker-skeleton" key={index} aria-hidden="true">
                <span />
              </div>
            ))
          : trackers.map((tracker) => {
              const isDisabled = excluded.includes(tracker.id);
              const isImportant = important.includes(tracker.id);

              return (
                <div key={tracker.id} className={isDisabled ? 'onboarding-tracker-disabled' : ''}>
                  <IndexerIcon src={tracker.icon} />
                  <span>{tracker.name}</span>
                  <button
                    type="button"
                    aria-label={`Favorite ${tracker.name}`}
                    aria-pressed={isImportant}
                    onClick={() =>
                      setImportant((prev) => {
                        const next = prev.includes(tracker.id)
                          ? prev.filter((id) => id !== tracker.id)
                          : [...prev, tracker.id];
                        preferences.setItem('xseek-match-important', JSON.stringify(next));
                        return next;
                      })
                    }
                  >
                    <Star size={16} fill={isImportant ? 'currentColor' : 'none'} />
                  </button>
                  <SwitchButton
                    label={`Enable ${tracker.name}`}
                    checked={!isDisabled}
                    onToggle={() =>
                      setExcluded((prev) => {
                        const next = prev.includes(tracker.id)
                          ? prev.filter((id) => id !== tracker.id)
                          : [...prev, tracker.id];
                        preferences.setItem('xseek-match-excluded-trackers', JSON.stringify(next));
                        return next;
                      })
                    }
                  />
                </div>
              );
            })}
      </div>

      {!busy && trackers.length === 0 && !error && (
        <p>
          No searchable torrent indexers yet. Add them in Prowlarr; you can sync them later in
          Settings.
        </p>
      )}

      <div className="auth-actions">
        <button className="onboarding-search-cta" disabled={busy} onClick={onFinish}>
          <span>{busy ? 'Saving…' : 'Let’s start searching'}</span>
          <ArrowRight size={22} />
        </button>
      </div>
    </>
  );
}

function Gate() {
  const [introStarted, setIntroStarted] = useState(false);
  const [connectionPreview, setConnectionPreview] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [enterDashboard, setEnterDashboard] = useState(false);

  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);

  const [step, setStep] = useState<'connection' | 'trackers'>('connection');
  const [syncing, setSyncing] = useState(false);
  const [connection, setConnection] = useState<ConnectionProbeResult | null>(null);
  const [trackers, setTrackers] = useState<DiscoveredTracker[]>([]);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [important, setImportant] = useState<number[]>([]);

  function previewFailure() {
    setConnectionPreview(true);
    setStep('connection');
    setConnection(MOCK_CONNECTION_FAILURE);
    setBusy(false);
    setError('');
  }

  useEffect(() => {
    if (!enterDashboard) return;
    const timer = setTimeout(() => setEnterDashboard(false), 500);
    return () => clearTimeout(timer);
  }, [enterDashboard]);

  async function refreshStatus() {
    try {
      const next = await authRequest('status');
      setCsrf(next.csrf || '');
      setStatus(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect');
    }
  }

  useEffect(() => {
    void refreshStatus();
    const onSessionExpired = () => {
      setCsrf('');
      setReady(false);
      setStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
      setPassword('');
    };
    window.addEventListener('auth-required', onSessionExpired);
    return () => window.removeEventListener('auth-required', onSessionExpired);
  }, []);

  useEffect(() => {
    if (!status?.authenticated) return;
    let active = true;
    loadPreferences()
      .then(() => {
        if (active) {
          setReady(true);
          setExcluded(JSON.parse(preferences.getItem('xseek-match-excluded-trackers') || '[]'));
          setImportant(JSON.parse(preferences.getItem('xseek-match-important') || '[]'));
        }
      })
      .catch(() => setError('Could not load preferences. Reload to retry.'));
    return () => {
      active = false;
    };
  }, [status?.authenticated]);

  /** Discovers indexers and warms their icons so step 3 opens complete; failures are retried there. */
  async function syncIndexers(): Promise<DiscoveredTracker[]> {
    const response = await authFetch('/api/match/indexers');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const discovered: DiscoveredTracker[] = data.trackers;
    setTrackers(discovered);
    await warmIndexerIcons(discovered.flatMap((tracker) => (tracker.icon ? [tracker.icon] : [])));
    return discovered;
  }

  async function checkConnection() {
    if (import.meta.env.DEV && connectionPreview) {
      setBusy(true);
      setConnection(null);
      await new Promise((resolve) => setTimeout(resolve, MIN_CONNECTION_CHECK_MS));
      setConnection(MOCK_CONNECTION_FAILURE);
      setBusy(false);
      return;
    }

    setBusy(true);
    setSyncing(false);
    setConnection(null);
    setError('');
    // The handshake always plays for a moment, even when Prowlarr answers instantly.
    const minimumWait = new Promise((resolve) => setTimeout(resolve, MIN_CONNECTION_CHECK_MS));
    try {
      const result: ConnectionProbeResult = await authRequest('connection', {});
      if (result.ok) {
        setConnection(result);
        setSyncing(true);
        await syncIndexers().catch(() => {});
      }
      await minimumWait;
      if (!result.ok) setConnection(result);
    } catch (err) {
      await minimumWait;
      setError(err instanceof Error ? err.message : 'Connection check failed');
    } finally {
      setSyncing(false);
      setBusy(false);
    }
  }

  async function reviewTrackers() {
    setStep('trackers');
    setBusy(true);
    setError('');
    try {
      await authRequest('onboarding', { stage: 'trackers' });
      if (!trackers.length) await syncIndexers();
    } catch {
      setError('Could not discover trackers. Retry the connection check.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (ready && status?.authenticated && !status.onboarded) {
      if (status.step === 'trackers') void reviewTrackers();
      else void checkConnection();
    }
  }, [ready, status?.authenticated, status?.onboarded]);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const next = await authRequest(status?.setup ? 'setup' : 'login', {
        username,
        password,
        remember,
      });
      setCsrf(next.csrf);
      setStatus(next);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  async function finishOnboarding() {
    setBusy(true);
    setError('');
    try {
      void preferences.setItem('xseek-match-excluded-trackers', JSON.stringify(excluded));
      void preferences.setItem('xseek-match-important', JSON.stringify(important));
      void preferences.setItem('xseek-match-page', 'search');
      if (!(await preferences.flush())) throw new Error('Preference flush failed');
      await authRequest('onboarding', {});
      await loadPreferences();
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setLeaving(true);
        await new Promise((resolve) => setTimeout(resolve, 200));
        setEnterDashboard(true);
      }
      setStatus((prev) => (prev ? { ...prev, onboarded: true } : prev));
    } catch {
      setLeaving(false);
      setError('Could not save setup. Your account is safe; please retry.');
    } finally {
      setBusy(false);
    }
  }

  if (status?.authenticated && status.onboarded && ready && !connectionPreview) {
    return (
      <>
        <div className={enterDashboard ? 'onboarding-arrival' : undefined}>
          <App />
        </div>
        {import.meta.env.DEV && <DebugCorner authenticated onPreview={previewFailure} />}
      </>
    );
  }

  const setup = status?.setup;
  const stepKey = status?.setup
    ? introStarted
      ? 'account'
      : 'intro'
    : status?.authenticated
      ? step
      : 'login';

  return (
    <main
      className={`auth-shell ${status?.authenticated && step === 'trackers' ? 'auth-shell-wide' : ''} ${leaving ? 'auth-leaving' : ''}`}
    >
      <div className="auth-abstract" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <a className="auth-brand auth-xm" href="/" aria-label="xseek match">
        x<span>m</span>
      </a>
      {import.meta.env.DEV && (
        <DebugCorner authenticated={Boolean(status?.authenticated)} onPreview={previewFailure} />
      )}

      <section className="auth-card">
        {import.meta.env.DEV && connectionPreview && (
          <div className="connection-preview-note">
            <span>Development preview · Connection failure</span>
            <button
              onClick={() => {
                setConnectionPreview(false);
                void refreshStatus();
              }}
            >
              Exit preview
            </button>
          </div>
        )}

        {status && !status.authenticated && !setup && <XmCollapseMark className="signin-xm" />}
        {status && !(setup && !introStarted) && (
          <div className="auth-card-heading">
            <h1>
              {status.authenticated
                ? step === 'connection'
                  ? 'Connect to Prowlarr'
                  : 'Configure your indexers'
                : setup
                  ? 'Create your account'
                  : 'Sign in'}
            </h1>
            {(setup || status.authenticated) && (
              <SetupSteps current={status.authenticated ? (step === 'connection' ? 2 : 3) : 1} />
            )}
          </div>
        )}

        <div key={stepKey} className="auth-step-enter">
          {!status ? (
            <>
              <h1>Connecting…</h1>
              {error && (
                <>
                  <p role="alert">{error}</p>
                  <button onClick={() => void refreshStatus()}>Retry</button>
                </>
              )}
            </>
          ) : status.setup && !introStarted ? (
            <div className="onboarding-intro">
              <XmCollapseMark className="intro-xm" />
              <h1>xseek match</h1>
              <p>Optimize your grabs across all your indexers</p>
              <button className="onboarding-search-cta" onClick={() => setIntroStarted(true)}>
                <span>Let’s get started</span>
                <ArrowRight size={21} />
              </button>
            </div>
          ) : !status.authenticated ? (
            <AuthCredentialsStep
              setup={setup}
              username={username}
              setUsername={setUsername}
              password={password}
              setPassword={setPassword}
              remember={remember}
              setRemember={setRemember}
              busy={busy}
              error={error}
              onSubmit={(event) => void submitCredentials(event)}
            />
          ) : !ready ? (
            <p>{error || 'Loading your preferences…'}</p>
          ) : (
            <>
              {step === 'connection' ? (
                <OnboardingConnectionStep
                  busy={busy}
                  error={error}
                  connection={connection}
                  syncing={syncing}
                  onReview={() => void reviewTrackers()}
                  onRetry={() => void checkConnection()}
                />
              ) : (
                <OnboardingTrackersStep
                  busy={busy}
                  error={error}
                  trackers={trackers}
                  excluded={excluded}
                  setExcluded={setExcluded}
                  important={important}
                  setImportant={setImportant}
                  onFinish={() => void finishOnboarding()}
                />
              )}
              {error && (
                <p role="alert" className="auth-error">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

startTheme();
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <Gate />
  </ErrorBoundary>,
);
