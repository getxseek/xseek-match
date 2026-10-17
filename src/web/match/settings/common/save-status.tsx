import { useEffect, useState } from 'react';
import { preferences } from './preferences';

export function SaveStatus() {
  const [status, setStatus] = useState(preferences.status),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = () => {
      const next = preferences.status();
      setStatus(next);
      if (!next.unsaved) setFailed(false);
    };
    const error = () => {
      setFailed(true);
      update();
    };
    window.addEventListener('preferences-changed', update);
    window.addEventListener('preferences-save-error', error);
    return () => {
      window.removeEventListener('preferences-changed', update);
      window.removeEventListener('preferences-save-error', error);
    };
  }, []);

  if (!status.unsaved || !failed) return null;

  return (
    <div className="settings-toast" role="alert">
      <span>
        {status.conflict
          ? 'Settings changed in another tab. Reload before editing.'
          : 'Changes are not saved. Keep this page open and retry.'}
      </span>
      {status.conflict ? (
        <button onClick={() => location.reload()}>Reload</button>
      ) : (
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void preferences.retry().finally(() => setBusy(false));
          }}
        >
          {busy ? 'Retrying…' : 'Retry save'}
        </button>
      )}
    </div>
  );
}
