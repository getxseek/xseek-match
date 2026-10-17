import { useEffect, useState, type ReactNode } from 'react';
import { XSEEK_SOURCE_URL } from '../../../../version';
import { SettingsSection } from '../../../components/ui/settings-section';
import { authFetch } from '../../auth/auth-client';

type AppInfo = {
  version: string;
  commit: string;
  modified: boolean;
  mode: string;
  startedAt: number;
  uptimeSeconds: number;
  runtime: string;
  platform: string;
  prowlarrConfigured: boolean;
  prowlarrHost: string | null;
  indexerCacheHours: number;
  indexerCachedAt: number | null;
  indexerCount: number | null;
  preferences: string;
  cacheLocation: string;
  authentication: string;
};

type InfoCard = { title: string; rows: Array<[label: string, value: ReactNode]> };

export function InfoPanel() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await authFetch('/api/match/info');
      if (!response.ok) throw new Error();
      setInfo(await response.json());
      setError('');
    } catch {
      setError('Could not load application info.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 10000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const date = (value: number) => new Date(value).toLocaleString();

  return (
    <SettingsSection
      className="info-panel"
      title="Info"
      helpLabel="Application info"
      help="Build, runtime and connection details refresh every 10 seconds while this panel is visible. Configured means credentials are present; it does not confirm Prowlarr is reachable."
    >
      {error && <p role="alert">{error}</p>}
      {!info && loading && <p className="match-note">Loading…</p>}
      {info &&
        (
          [
            {
              title: 'Build',
              rows: [
                ['Author', 'Hori'],
                ['Copyright', `© ${new Date().getFullYear()} hori`],
                ['Version', info.version],
                ['Commit', `${info.commit}${info.modified ? ' · local changes' : ''}`],
                ['Mode', info.mode],
                ['License', 'AGPL-3.0-or-later'],
                [
                  'Source',
                  <a href={XSEEK_SOURCE_URL} target="_blank" rel="noreferrer">
                    {XSEEK_SOURCE_URL.replace('https://', '')}
                  </a>,
                ],
              ],
            },
            {
              title: 'Runtime',
              rows: [
                [
                  'Uptime',
                  `${Math.floor(info.uptimeSeconds / 3600)}h ${Math.floor((info.uptimeSeconds % 3600) / 60)}m ${info.uptimeSeconds % 60}s`,
                ],
                ['Started', date(info.startedAt)],
                ['Node.js', info.runtime],
                ['Platform', info.platform],
              ],
            },
            {
              title: 'Connection',
              rows: [
                ['Prowlarr', info.prowlarrConfigured ? 'Configured' : 'Not configured'],
                ['Host', info.prowlarrHost ?? '—'],
                ['Authentication', info.authentication],
              ],
            },
            {
              title: 'Storage & cache',
              rows: [
                ['Preferences', info.preferences],
                ['Cache location', info.cacheLocation],
                ['Indexer & icon cache', `${info.indexerCacheHours} hours`],
                [
                  'Indexers cached',
                  info.indexerCount === null ? 'Not loaded' : String(info.indexerCount),
                ],
                ['Last sync', info.indexerCachedAt ? date(info.indexerCachedAt) : 'Not loaded'],
              ],
            },
          ] satisfies InfoCard[]
        ).map((card) => (
          <article className="info-card" key={card.title}>
            <h3>{card.title}</h3>
            <dl>
              {card.rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
    </SettingsSection>
  );
}
