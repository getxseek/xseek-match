import {
  SEARCH_TTL_MINUTES_DEFAULT,
  SEARCH_TTL_MINUTES_MAX,
  SEARCH_TTL_MINUTES_MIN,
} from '../../../contracts/preferences';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { SettingsHelp } from '../../components/ui/settings-help';
import { SettingsSection } from '../../components/ui/settings-section';
import { authFetch } from '../auth/auth-client';
type Cache = {
  entries: number;
  bytes: number;
  hits: number;
  lastUsed: number | null;
  newest: number | null;
  icons: number;
  ttlMinutes: number;
};
type Log = { at: number; level: string; message: string };
export function ActivityPanel({ kind }: { kind: 'cache' | 'logs' }) {
  const [cache, setCache] = useState<Cache | null>(null),
    [logs, setLogs] = useState<Log[]>([]),
    [ttl, setTtl] = useState(String(SEARCH_TTL_MINUTES_DEFAULT)),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [level, setLevel] = useState('');
  async function refresh(save = false) {
    try {
      const response = await authFetch(`/api/match/${kind}${save ? `?ttl=${ttl}` : ''}`, {
        method: save ? 'POST' : 'GET',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load data');
      if (kind === 'cache') {
        setCache(data);
        if (!save) setTtl(String(data.ttlMinutes));
      } else setLogs(data.logs);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    }
  }
  useEffect(() => {
    void refresh();
    if (kind === 'logs') {
      const timer = setInterval(() => void refresh(), 3000);
      return () => clearInterval(timer);
    }
  }, [kind]);
  // Open at the newest entry and keep following new ones, unless the reader has scrolled up.
  const logView = useRef<HTMLDivElement>(null);
  const followLogs = useRef(true);
  useLayoutEffect(() => {
    const view = logView.current;
    if (view && followLogs.current) view.scrollTop = view.scrollHeight;
  }, [logs, level, query]);
  const date = (n: number | null) => (n ? new Date(n).toLocaleString() : '—');
  const title = kind === 'cache' ? 'Search cache' : 'Logs';
  const helpText =
    kind === 'cache'
      ? 'Repeating the same query with the same excluded trackers reuses results until expiry. Expired search files are pruned after startup and live searches; the search cache has a 128 MiB budget. Cache hits reset when the service restarts.'
      : 'Shows the latest 500 events from this running service. Refreshes every 3 seconds and clears on restart. Query text, credentials and raw Prowlarr responses are not logged.';

  return (
    <SettingsSection
      title={title}
      help={helpText}
      actions={
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Refresh
        </Button>
      }
    >
      {error && <p role="alert">{error}</p>}
      {kind === 'cache' && cache && (
        <>
          <div className="cache-grid">
            {[
              ['Entries', cache.entries],
              ['Cache hits (this session)', cache.hits],
              ['Size', `${(cache.bytes / 1048576).toFixed(2)} MiB`],
              ['TTL', `${cache.ttlMinutes} minutes`],
              ['Newest entry', date(cache.newest)],
              ['Last used', date(cache.lastUsed)],
              ['Cached icons', cache.icons],
            ].map(([label, value]) => (
              <article className="cache-stat" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </div>
          <article className="info-card cache-config">
            <h3>
              Cache configuration
              <SettingsHelp label="Cache lifetime">
                {`How long saved search results may be reused, from ${SEARCH_TTL_MINUTES_MIN} minutes to one year (${SEARCH_TTL_MINUTES_MAX} minutes). Saving also changes when existing cached results expire; expired files are removed during cache maintenance.`}
              </SettingsHelp>
            </h3>
            <div className="cache-config-row">
              <label>
                TTL (minutes)
                <input
                  type="number"
                  min={SEARCH_TTL_MINUTES_MIN}
                  max={SEARCH_TTL_MINUTES_MAX}
                  value={ttl}
                  onChange={(e) => setTtl(e.target.value)}
                />
              </label>
              <Button size="sm" onClick={() => void refresh(true)}>
                Save
              </Button>
              <p className="match-note">Minimum {SEARCH_TTL_MINUTES_MIN} minutes.</p>
            </div>
          </article>
        </>
      )}
      {kind === 'logs' && (
        <>
          <div className="log-controls">
            <input
              aria-label="Search logs"
              placeholder="Search logs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="log-level-chips" role="group" aria-label="Log level">
              {[
                { value: '', label: 'All' },
                { value: 'info', label: 'Info' },
                { value: 'error', label: 'Error' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={level === option.value}
                  onClick={() => setLevel(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div
            className="log-view"
            ref={logView}
            onScroll={(event) => {
              const view = event.currentTarget;
              followLogs.current = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
            }}
          >
            {logs
              .filter(
                (l) =>
                  (!level || l.level === level) &&
                  l.message.toLowerCase().includes(query.toLowerCase()),
              )
              .map((l, i) => (
                <div key={`${l.at}-${i}`}>
                  <time>{new Date(l.at).toLocaleTimeString()}</time>
                  <span className={`log-${l.level}`}>{l.level.toUpperCase()}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            {!logs.length && <p>No activity yet.</p>}
          </div>
        </>
      )}
    </SettingsSection>
  );
}
