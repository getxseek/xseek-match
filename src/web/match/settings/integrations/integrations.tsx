import { Check, LoaderCircle, Pencil, Plug, Plus, Trash2, X, Zap } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../components/ui/button';
import { PasswordInput } from '../../../components/ui/password-input';
import { SettingsSection } from '../../../components/ui/settings-section';
import { SwitchButton } from '../../../components/ui/switch-button';
import { authFetch } from '../../auth/auth-client';
import './integrations.css';

type Kind = 'sonarr' | 'radarr' | 'qui';

type Connection = {
  id: string;
  kind: Kind;
  name: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  checkedAt: number | null;
  status: 'connected' | 'failed' | 'unchecked';
  detail: string;
};

const SERVICE_KINDS = [
  { value: 'sonarr' as const, label: 'Sonarr' },
  { value: 'radarr' as const, label: 'Radarr' },
  { value: 'qui' as const, label: 'qui' },
];

async function requestIntegrationsApi(body?: unknown) {
  const response = await authFetch(
    '/api/match/integrations',
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load integrations.');
  return data;
}

function defaultPlaceholderUrl(kind: Kind): string {
  if (kind === 'sonarr') return 'http://sonarr:8989';
  if (kind === 'radarr') return 'http://radarr:7878';
  return 'http://qui:7476';
}

function Editor({
  connection,
  onCancel,
  onSaved,
}: {
  connection?: Connection;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(connection?.kind || 'sonarr');
  const [name, setName] = useState(connection?.name || 'Sonarr');
  const [baseUrl, setUrl] = useState(connection?.baseUrl || '');
  const [apiKey, setKey] = useState('');
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const idPrefix = useId();
  const draft = { id: connection?.id, kind, name, baseUrl, apiKey, enabled };

  async function runConnectionAction(save: boolean) {
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await requestIntegrationsApi({ action: save ? 'save' : 'test', ...draft });
      if (save) await onSaved();
      else setMessage('Connected');
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof Error ? err.message : 'Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void runConnectionAction(true);
  }

  return (
    <form className="integration-editor" onSubmit={handleSubmit}>
      <div className="integration-editor-heading">
        <strong>{connection ? 'Edit connection' : 'Add integration'}</strong>
        <button
          type="button"
          className="integration-icon-button"
          aria-label="Cancel editing"
          disabled={busy}
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>

      {!connection && (
        <div className="integration-kind-chips" role="group" aria-label="Service type">
          {SERVICE_KINDS.map((item) => (
            <button
              type="button"
              key={item.value}
              aria-pressed={kind === item.value}
              disabled={busy}
              onClick={() => {
                setKind(item.value);
                if (SERVICE_KINDS.some((service) => service.label === name)) {
                  setName(item.label);
                }
                setMessage('');
              }}
            >
              <img src={`/icons/${item.value}.svg`} width={15} height={15} alt="" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="integration-fields">
        <label htmlFor={`${idPrefix}-name`}>
          Name
          <input
            id={`${idPrefix}-name`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMessage('');
            }}
            required
            maxLength={80}
            disabled={busy}
            autoFocus
            placeholder="Sonarr 4K"
          />
        </label>

        <label htmlFor={`${idPrefix}-url`}>
          Base URL
          <input
            id={`${idPrefix}-url`}
            type="url"
            value={baseUrl}
            onChange={(event) => {
              setUrl(event.target.value);
              setMessage('');
            }}
            required
            disabled={busy}
            placeholder={defaultPlaceholderUrl(kind)}
            spellCheck={false}
          />
        </label>

        <label htmlFor={`${idPrefix}-key`}>
          API key
          <PasswordInput
            id={`${idPrefix}-key`}
            wrapperClassName="integration-key"
            buttonClassName="integration-icon-button"
            showLabel="Show API key"
            hideLabel="Hide API key"
            iconSize={17}
            value={apiKey}
            onChange={(event) => {
              setKey(event.target.value);
              setMessage('');
            }}
            required={!connection}
            disabled={busy}
            autoComplete="new-password"
            placeholder={connection ? 'Leave blank to keep saved key' : 'API key'}
            spellCheck={false}
          />
        </label>
      </div>

      <div className="integration-editor-footer">
        <div className="integration-enable">
          <span>Enabled</span>
          <SwitchButton
            label="Enable connection"
            checked={enabled}
            disabled={busy}
            onToggle={() => setEnabled((value) => !value)}
          />
        </div>

        <div className="integration-editor-actions">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            disabled={busy || !name.trim() || !baseUrl.trim() || (!connection && !apiKey.trim())}
            onClick={() => void runConnectionAction(false)}
          >
            Test connection
          </Button>
          <Button variant="outline" size="sm" type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy}>
            {busy ? <LoaderCircle size={14} className="search-spinner" /> : <Plug size={14} />}{' '}
            {busy ? 'Checking…' : 'Test & save'}
          </Button>
        </div>
      </div>

      {message && (
        <p
          className={`integration-message ${failed ? 'is-error' : ''}`}
          role={failed ? 'alert' : 'status'}
        >
          {message}
        </p>
      )}
    </form>
  );
}

function ConnectionStatus({
  status,
  detail,
  enabled = true,
}: {
  status: Connection['status'];
  detail?: string;
  enabled?: boolean;
}) {
  const label = !enabled
    ? 'Disabled'
    : status === 'connected'
      ? 'Connected'
      : status === 'failed'
        ? 'Connection failed'
        : 'Not checked';

  return (
    <span
      role="status"
      aria-label={label}
      title={detail ? `${label} · ${detail}` : label}
      className={`integration-status-icon is-${enabled ? status : 'disabled'}`}
    >
      <span className="integration-status-dot" aria-hidden="true" />
    </span>
  );
}

function isPointerOutsideDialog(event: {
  target: EventTarget | null;
  currentTarget: HTMLDialogElement;
  clientX: number;
  clientY: number;
}): boolean {
  const rect = event.currentTarget.getBoundingClientRect();
  return (
    event.target === event.currentTarget &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  );
}

function RemoveConfirmation({
  connection,
  busy,
  onCancel,
  onRemove,
}: {
  connection: Connection;
  busy: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="integration-remove-dialog"
      aria-labelledby={titleId}
      onPointerDown={(event) => {
        pressedOutside.current = isPointerOutsideDialog(event);
      }}
      onClick={(event) => {
        if (!busy && pressedOutside.current && isPointerOutsideDialog(event)) {
          onCancel();
        }
        pressedOutside.current = false;
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>Remove {connection.name}?</h2>
      <div className="integration-remove-dialog-actions">
        <button type="button" autoFocus disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="integration-confirm-delete"
          disabled={busy}
          onClick={onRemove}
        >
          {busy ? 'Removing…' : 'Remove integration'}
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

const MIN_TEST_SPIN_MS = 500;
const TEST_RESULT_MS = 2000;

/**
 * Icon button that visibly spins while a connection test runs, then shows a check or a cross
 * for a moment, so a quick or unchanged result still reads as "tested".
 */
function TestConnectionButton({
  label,
  disabled,
  onTest,
}: {
  label: string;
  disabled?: boolean;
  onTest: () => Promise<boolean>;
}) {
  const [state, setState] = useState<'idle' | 'testing' | 'ok' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function run() {
    if (state === 'testing') return;
    clearTimeout(resetTimer.current);
    setState('testing');
    const [ok] = await Promise.all([
      onTest().catch(() => false),
      new Promise((resolve) => setTimeout(resolve, MIN_TEST_SPIN_MS)),
    ]);
    setState(ok ? 'ok' : 'failed');
    resetTimer.current = setTimeout(() => setState('idle'), TEST_RESULT_MS);
  }

  return (
    <button
      type="button"
      className="integration-icon-button integration-test-button"
      data-result={state}
      aria-label={label}
      title="Test connection"
      aria-busy={state === 'testing'}
      disabled={disabled}
      onClick={() => void run()}
    >
      {state === 'testing' ? (
        <LoaderCircle size={16} className="search-spinner" />
      ) : state === 'ok' ? (
        <Check size={16} />
      ) : state === 'failed' ? (
        <X size={16} />
      ) : (
        <Zap size={16} />
      )}
      <span className="sr-only" aria-live="polite">
        {state === 'ok' ? 'Connection works' : state === 'failed' ? 'Connection failed' : ''}
      </span>
    </button>
  );
}

export function IntegrationsPanel() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const [prowlarr, setProwlarr] = useState<{
    prowlarrConfigured: boolean;
    prowlarrHost: string | null;
  } | null>(null);
  const [prowlarrResult, setProwlarrResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingProwlarr, setTestingProwlarr] = useState(false);

  async function reloadConnections() {
    const data = await requestIntegrationsApi();
    setConnections(data.connections);
    window.dispatchEvent(new Event('integrations-changed'));
  }

  async function testProwlarr(signal?: AbortSignal): Promise<boolean> {
    if (testingProwlarr && !signal) return false;
    setTestingProwlarr(true);
    try {
      const response = await authFetch('/api/auth/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal,
      });
      const data = await response.json();
      if (signal?.aborted) return false;
      if (!response.ok) throw new Error(data.error);

      setProwlarrResult({
        ok: data.ok,
        text: data.ok
          ? 'Connected'
          : data.missing?.length
            ? `Set ${data.missing.join(', ')} in Compose.`
            : data.error,
      });
      return data.ok === true;
    } catch (err) {
      if (signal?.aborted) return false;
      setProwlarrResult({
        ok: false,
        text: err instanceof Error ? err.message : 'Connection failed.',
      });
      return false;
    } finally {
      if (!signal?.aborted) setTestingProwlarr(false);
    }
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void testProwlarr(controller.signal);

    void requestIntegrationsApi()
      .then((data) => {
        if (active) setConnections(data.connections);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void authFetch('/api/match/info')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active) setProwlarr(data);
      })
      .catch(() => {});

    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  async function testConnection(connection: Connection): Promise<boolean> {
    setPending(connection.id);
    setError('');
    try {
      await requestIntegrationsApi({ action: 'test', id: connection.id });
      await reloadConnections();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not test connection.');
      await reloadConnections().catch(() => {});
      return false;
    } finally {
      setPending(null);
    }
  }

  async function performAction(connection: Connection, action: 'enabled' | 'delete') {
    setPending(connection.id);
    setError('');
    try {
      await requestIntegrationsApi({
        action,
        id: connection.id,
        ...(action === 'enabled' ? { enabled: !connection.enabled } : {}),
      });
      setRemoving(null);
      await reloadConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update connection.');
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsSection
      className={`integrations-panel ${pending !== null ? 'integration-operation-pending' : ''}`}
      title="Integrations"
      help="Add named Sonarr, Radarr or qui instances. Test & save checks read-only API access before saving. Keys stay in server-side SQLite and are never returned after saving. Back up the database as sensitive data."
      actions={
        <Button
          size="sm"
          variant="ghost"
          disabled={editor !== null || pending !== null}
          onClick={() => {
            setEditor('new');
            setRemoving(null);
          }}
        >
          <Plus size={15} /> Add integration
        </Button>
      }
    >
      {error && (
        <p className="integration-message is-error" role="alert">
          {error}
        </p>
      )}

      <div className="integration-group">
        <h3>Prowlarr</h3>
        <div className="integration-row">
          <img src="/icons/prowlarr.svg" className="integration-logo" alt="" />
          <div className="integration-identity">
            <strong>
              Prowlarr{' '}
              <ConnectionStatus
                status={prowlarrResult ? (prowlarrResult.ok ? 'connected' : 'failed') : 'unchecked'}
                detail={prowlarrResult && !prowlarrResult.ok ? prowlarrResult.text : undefined}
              />
              <span className="integration-managed">Environment</span>
            </strong>
            <span>{prowlarr?.prowlarrHost || 'Not configured'}</span>
          </div>
          <TestConnectionButton label="Test Prowlarr connection" onTest={() => testProwlarr()} />
        </div>
      </div>

      {editor === 'new' && (
        <Editor
          key="new"
          onCancel={() => setEditor(null)}
          onSaved={async () => {
            await reloadConnections();
            setEditor(null);
          }}
        />
      )}

      {loading && (
        <p className="match-note" role="status">
          Loading connections…
        </p>
      )}

      {SERVICE_KINDS.map((service) => {
        const rows = connections.filter((connection) => connection.kind === service.value);
        if (!rows.length) return null;

        return (
          <div className="integration-group" key={service.value}>
            <h3>
              {service.label}
              <span>{rows.length}</span>
            </h3>
            {rows.map((connection) => (
              <div key={connection.id}>
                <div
                  className={`integration-row ${!connection.enabled ? 'integration-disabled' : ''}`}
                >
                  <img src={`/icons/${service.value}.svg`} className="integration-logo" alt="" />
                  <div className="integration-identity">
                    <strong>
                      {connection.name}
                      <ConnectionStatus
                        enabled={connection.enabled}
                        status={connection.status}
                        detail={
                          connection.checkedAt
                            ? `Last checked: ${new Date(connection.checkedAt).toLocaleString()}`
                            : undefined
                        }
                      />
                    </strong>
                    <span>{connection.baseUrl}</span>
                  </div>

                  <div className="integration-row-actions">
                    <SwitchButton
                      label={`Enable ${connection.name}`}
                      checked={connection.enabled}
                      disabled={pending !== null}
                      onToggle={() => void performAction(connection, 'enabled')}
                    />
                    <TestConnectionButton
                      label={`Test ${connection.name}`}
                      disabled={pending !== null && pending !== connection.id}
                      onTest={() => testConnection(connection)}
                    />
                    <button
                      className="integration-icon-button"
                      aria-label={`Edit ${connection.name}`}
                      title="Edit"
                      disabled={editor !== null || pending !== null}
                      onClick={() => {
                        setEditor(connection.id);
                        setRemoving(null);
                      }}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="integration-icon-button"
                      aria-label={`Remove ${connection.name}`}
                      title="Remove"
                      disabled={pending !== null || editor === connection.id}
                      onClick={() => setRemoving(connection.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {removing === connection.id && (
                  <RemoveConfirmation
                    connection={connection}
                    busy={pending !== null}
                    onCancel={() => setRemoving(null)}
                    onRemove={() => void performAction(connection, 'delete')}
                  />
                )}

                {editor === connection.id && (
                  <Editor
                    connection={connection}
                    onCancel={() => setEditor(null)}
                    onSaved={async () => {
                      await reloadConnections();
                      setEditor(null);
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        );
      })}

      {!loading && connections.length === 0 && editor === null && (
        <div className="integrations-empty">
          <Plug size={24} />
          <p>No optional integrations yet.</p>
          <Button size="sm" variant="ghost" onClick={() => setEditor('new')}>
            Add Sonarr, Radarr or qui <Plus size={14} />
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}
