import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { SettingsHelp } from '../../../components/ui/settings-help';
import { SettingsSection } from '../../../components/ui/settings-section';
import { authFetch } from '../../auth/auth-client';
import { TrackerDefinitionsTask } from '../indexers/tracker-definitions';

export function TasksPanel({ onSync }: { onSync: () => void }) {
  const [state, setState] = useState<{ cachedAt?: number; trackers?: unknown[] } | null>(null);
  const [running, setRunning] = useState(false),
    [error, setError] = useState('');

  async function load(force = false) {
    setRunning(true);
    setError('');
    try {
      const response = await authFetch(`/api/match/indexers${force ? '?refresh=1' : ''}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Sync failed');
      setState(data);
      if (force) onSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load task status');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <SettingsSection
      className="tasks-panel"
      title="Tasks"
      help="Run maintenance tasks and check their refresh status."
    >
      <article className="info-card task-card">
        <div className="task-heading">
          <h3>
            Sync indexers
            <SettingsHelp label="Indexer sync">
              Fetches enabled, searchable torrent indexers and their categories from Prowlarr. Keeps
              your local selections and custom names. Does not crawl releases or edit Prowlarr.
            </SettingsHelp>
          </h3>
          <Button size="sm" disabled={running} onClick={() => void load(true)}>
            {running ? (
              <LoaderCircle size={13} className="search-spinner" />
            ) : (
              <RefreshCw size={13} />
            )}{' '}
            {running ? 'Syncing…' : 'Run now'}
          </Button>
        </div>
        <dl>
          <div>
            <dt>Refresh policy</dt>
            <dd>On demand · 24-hour cache</dd>
          </div>
          <div>
            <dt>Last successful sync</dt>
            <dd>
              {state?.cachedAt
                ? new Date(state.cachedAt).toLocaleString()
                : 'No successful sync recorded'}
            </dd>
          </div>
          <div>
            <dt>Discovered indexers</dt>
            <dd>{state?.trackers?.length ?? '—'}</dd>
          </div>
        </dl>
      </article>
      <TrackerDefinitionsTask />
      {error && (
        <p role="alert" className="match-note">
          {error}
        </p>
      )}
    </SettingsSection>
  );
}
