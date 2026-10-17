import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/button';
import { authFetch } from '../../auth/auth-client';
import { updateTrackerDefinitions } from './tracker-abbreviations';

export async function loadTrackerDefinitions(force = false) {
  const response = await authFetch('/api/match/tracker-definitions', {
    method: force ? 'POST' : 'GET',
  });
  if (!response.ok) throw Error('Could not load tracker definitions');
  const data = await response.json();
  updateTrackerDefinitions(data.trackers);
  return data;
}

export function TrackerDefinitionsTask() {
  const [state, setState] = useState<{
      at: number;
      nextAt: number;
      trackers: unknown[];
      error: string | null;
    } | null>(null),
    [running, setRunning] = useState(false),
    [error, setError] = useState('');

  async function load(force = false) {
    setRunning(true);
    try {
      setState(await loadTrackerDefinitions(force));
      setError('');
    } catch {
      setError('Could not load task status.');
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <article className="info-card task-card">
      <div className="task-heading">
        <h3>Refresh tracker definitions</h3>
        <Button size="sm" disabled={running} onClick={() => void load(true)}>
          {running ? 'Refreshing…' : 'Run now'}
        </Button>
      </div>
      <dl>
        <div>
          <dt>Refresh policy</dt>
          <dd>Every 24 hours while XM is running</dd>
        </div>
        <div>
          <dt>Last successful refresh</dt>
          <dd>{state?.at ? new Date(state.at).toLocaleString() : 'Awaiting first refresh'}</dd>
        </div>
        <div>
          <dt>Next attempt</dt>
          <dd>{state?.nextAt ? new Date(state.nextAt).toLocaleString() : 'Starting…'}</dd>
        </div>
        <div>
          <dt>Tracker definitions</dt>
          <dd>{state?.trackers.length ?? '—'}</dd>
        </div>
      </dl>
      <p className="match-note">Source: fHori / Private-Trackers-Spreadsheet</p>
      {(state?.error || error) && (
        <p role="status" className="match-note">
          {state?.error || error}
        </p>
      )}
    </article>
  );
}
