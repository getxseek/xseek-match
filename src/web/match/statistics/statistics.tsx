import { useEffect, useState } from 'react';
import { SettingsHelp } from '../../components/ui/settings-help';
import { SettingsSection } from '../../components/ui/settings-section';
import { authFetch } from '../auth/auth-client';
import { trackerAbbreviation } from '../settings/indexers/tracker-abbreviations';
import './statistics.css';

type Snapshot = {
  counts: Record<string, number>;
  timings: Array<{
    operation: string;
    count: number;
    mean: number;
    median: number;
    p75: number;
    p90: number;
    p95: number;
    min: number;
    max: number;
  }>;
  overlap: Array<{
    aId: number;
    bId: number;
    a: string;
    b: string;
    total: number;
    evidence: string;
  }>;
};

const operationNames: Record<string, string> = {
  lookup_live: 'Title lookup',
  lookup_cached: 'Title lookup · cached',
  prowlarr_request: 'Prowlarr search',
  search_live: 'Search · live',
  search_cached: 'Cached search',
  qui_resolve: 'qui resolver',
  lookup_failed: 'Title lookup · failed',
  resolve_failed: 'Resolver · failed',
};

const duration = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;

function TimingPercentiles({ rows }: { rows: Snapshot['timings'] }) {
  const max = Math.max(1, ...rows.map((row) => row.max)) * 1.12;

  const position = (ms: number) =>
    Math.max(0, Math.min(100, (Math.log1p(Math.max(0, ms)) / Math.log1p(max)) * 100));

  const percent = (ms: number) => `${position(ms)}%`;

  const ticks = [
    0,
    ...Array.from({ length: Math.max(1, Math.ceil(Math.log10(max))) }, (_, i) => 10 ** i).filter(
      (value) => value <= max,
    ),
  ];

  const measures = [
    { key: 'median', label: 'p50' },
    { key: 'p95', label: 'p95' },
  ] as const;

  return (
    <div className="timing-percentiles">
      <div className="percentile-axis">
        <span>Time · log scale</span>
        <div>
          {ticks.map((value) => (
            <span key={value} style={{ left: percent(value) }}>
              {duration(value)}
            </span>
          ))}
        </div>
      </div>
      {rows.map((row) => (
        <article className="percentile-row" key={row.operation}>
          <div className="percentile-operation">
            <strong>{operationNames[row.operation] || row.operation}</strong>
            <span>
              <b>{duration(row.mean)}</b> avg · {row.count.toLocaleString()} samples
            </span>
          </div>
          <div className="percentile-distribution">
            <div
              className="percentile-rail"
              role="group"
              aria-label={`${operationNames[row.operation] || row.operation} percentiles`}
            >
              {ticks.map((value) => (
                <span
                  className="percentile-gridline"
                  key={value}
                  style={{ left: percent(value) }}
                />
              ))}
              <div
                className="percentile-whisker"
                style={{
                  left: percent(row.min),
                  width: `${position(row.max) - position(row.min)}%`,
                }}
                title={`Range: ${duration(row.min)}–${duration(row.max)}`}
              />
              <div
                className="percentile-band"
                style={{
                  left: percent(row.median),
                  width: `${position(row.p95) - position(row.median)}%`,
                }}
              />
              {measures.map((measure, i) => (
                <span
                  key={measure.key}
                  className={`percentile-point percentile-point-${i * 3}`}
                  tabIndex={0}
                  style={{ left: percent(row[measure.key]) }}
                  aria-label={`${measure.label}: ${duration(row[measure.key])}`}
                >
                  <span className="percentile-tooltip">
                    {measure.label} · {duration(row[measure.key])}
                  </span>
                </span>
              ))}
            </div>
            <div className="percentile-values">
              {measures.map((measure, i) => (
                <span key={measure.key}>
                  <i className={`percentile-key-${i * 3}`} />
                  {measure.label} <b>{duration(row[measure.key])}</b>
                </span>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function TrackerMapIdentity({
  x,
  y,
  abbreviation,
  icon,
}: {
  x: number;
  y: number;
  abbreviation: string | null;
  icon?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (icon && !failed)
    return (
      <image
        className="tracker-map-logo"
        href={icon}
        x={x - 11}
        y={y - 11}
        width="22"
        height="22"
        preserveAspectRatio="xMidYMid meet"
        onError={() => setFailed(true)}
      />
    );

  if (abbreviation && abbreviation !== '·')
    return (
      <text x={x} y={y + 4} textAnchor="middle" style={{ fill: 'var(--gray-ee)' }} fontSize="11">
        {abbreviation}
      </text>
    );

  return (
    <g
      transform={`translate(${x - 9} ${y - 9})`}
      fill="none"
      style={{ stroke: 'var(--gray-aa)' }}
      strokeWidth="1.5"
    >
      <rect x="1" y="1" width="16" height="16" rx="3" />
      <path d="M1 11h16M7 1v16" />
    </g>
  );
}

type Pair = Snapshot['overlap'][number];

function OverlapMatrix({
  rows,
  abbreviations,
  icons,
}: {
  rows: Pair[];
  abbreviations: Record<string, string>;
  icons: Record<string, string>;
}) {
  const [view, setView] = useState<'matrix' | 'map'>('matrix');

  const [evidence, setEvidence] = useState('hash');

  const [selected, setSelected] = useState<number | null>(null),
    [active, setActive] = useState<Pair | null>(null);

  const available = [...new Set(rows.map((row) => row.evidence))];

  const effective = available.includes(evidence) ? evidence : available[0];

  const filtered = rows.filter((row) => row.evidence === effective);

  const trackerMap = new Map<number, string>();
  for (const row of filtered) {
    trackerMap.set(row.aId, row.a);
    trackerMap.set(row.bId, row.b);
  }

  const trackers = [...trackerMap]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

  const counts = new Map(
    filtered.map((row) => [[row.aId, row.bId].sort((a, b) => a - b).join(':'), row]),
  );

  const max = Math.max(1, ...filtered.map((row) => row.total)),
    radius = Math.max(145, trackers.length * 14),
    center = radius + 95;

  const nodes = trackers.map((tracker, i) => ({
    ...tracker,
    x: center + radius * Math.cos((i / trackers.length) * Math.PI * 2 - Math.PI / 2),
    y: center + radius * Math.sin((i / trackers.length) * Math.PI * 2 - Math.PI / 2),
  }));

  const positions = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="overlap-visual">
      <div className="overlap-controls">
        <div role="group" aria-label="Overlap evidence">
          {available.map((value) => (
            <button
              key={value}
              aria-pressed={effective === value}
              onClick={() => {
                setEvidence(value);
                setActive(null);
                setSelected(null);
              }}
            >
              {value === 'hash' ? 'Exact hash' : 'Inferred release'}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Overlap visualization">
          {(['matrix', 'map'] as const).map((value) => (
            <button key={value} aria-pressed={view === value} onClick={() => setView(value)}>
              {value === 'matrix' ? 'Matrix' : 'Overlap map'}
            </button>
          ))}
        </div>
      </div>

      {trackers.length < 2 ? (
        <p className="match-note overlap-empty">No shared releases recorded for this evidence.</p>
      ) : view === 'matrix' ? (
        <div className="overlap-matrix-scroll">
          <table className="overlap-matrix">
            <caption className="sr-only">
              Shared release observations by tracker ID. Exact and inferred evidence are separate.
            </caption>
            <thead>
              <tr>
                <th />
                {trackers.slice(1).map((t) => (
                  <th key={t.id} scope="col">
                    {t.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trackers.slice(0, -1).map((a, i) => (
                <tr key={a.id}>
                  <th scope="row">{a.name}</th>
                  {trackers.slice(1).map((b, j) => {
                    const row = counts.get([a.id, b.id].sort((a, b) => a - b).join(':'));
                    const total = row?.total || 0;
                    return (
                      <td key={b.id}>
                        {j < i ? null : (
                          <button
                            style={{
                              background: total
                                ? `color-mix(in srgb, var(--chart-accent) ${(12 + 78 * Math.sqrt(total / max)).toFixed(1)}%, transparent)`
                                : undefined,
                            }}
                            aria-label={`${a.name} (#${a.id}) and ${b.name} (#${b.id}): ${total} shared observations`}
                            onFocus={() => setActive(row || null)}
                            onMouseEnter={() => setActive(row || null)}
                            onClick={() => {
                              setActive(row || null);
                              setView('map');
                            }}
                          >
                            {total || '-'}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tracker-map">
          <svg
            viewBox={`0 0 ${center * 2} ${center * 2}`}
            role="group"
            aria-label="Shared release connections"
          >
            {filtered.map((row) => {
              const a = positions.get(row.aId)!,
                b = positions.get(row.bId)!;
              return (
                <g
                  key={`${row.aId}:${row.bId}`}
                  className="tracker-map-edge"
                  role="button"
                  tabIndex={0}
                  aria-label={`${row.a} and ${row.b}: ${row.total} observations`}
                  onFocus={() => setActive(row)}
                  onMouseEnter={() => setActive(row)}
                  onClick={() => setActive(row)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setActive(row);
                    }
                  }}
                >
                  <path
                    d={`M ${a.x} ${a.y} Q ${center} ${center} ${b.x} ${b.y}`}
                    fill="none"
                    style={{ stroke: 'var(--primary-bright)' }}
                    strokeWidth={1 + 5 * Math.sqrt(row.total / max)}
                    opacity={
                      selected === null || selected === a.id || selected === b.id ? 0.65 : 0.05
                    }
                  />
                  <path
                    d={`M ${a.x} ${a.y} Q ${center} ${center} ${b.x} ${b.y}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={15}
                  />
                </g>
              );
            })}
            {nodes.map((node) => (
              <g
                key={node.id}
                className="tracker-map-node"
                role="button"
                tabIndex={0}
                aria-label={`Highlight ${node.name} (#${node.id})`}
                aria-pressed={selected === node.id}
                onClick={() => setSelected(selected === node.id ? null : node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected(selected === node.id ? null : node.id);
                  }
                  if (e.key === 'Escape') setSelected(null);
                }}
              >
                <rect
                  className="tracker-map-hit"
                  x={node.x - 22}
                  y={node.y - 22}
                  width={44}
                  height={44}
                  rx={7}
                  fill="transparent"
                />
                <TrackerMapIdentity
                  x={node.x}
                  y={node.y}
                  abbreviation={abbreviations[node.id] || trackerAbbreviation(node.name)}
                  icon={icons[node.id]}
                />
                <text
                  className="tracker-map-label"
                  x={node.x}
                  y={node.y + 34}
                  textAnchor="middle"
                  style={{ fill: 'var(--gray-aa)' }}
                  fontSize={9}
                >
                  {node.name}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      <div className="overlap-detail" aria-live="polite">
        {active ? (
          <>
            <strong>
              {active.a} - {active.b}
            </strong>
            <span>{active.total.toLocaleString()} shared observations</span>
          </>
        ) : (
          <span>Select a tracker pair to explore its overlap.</span>
        )}
      </div>
    </div>
  );
}

export function StatisticsPanel({
  abbreviations = {},
  icons = {},
}: {
  abbreviations?: Record<string, string>;
  icons?: Record<string, string>;
}) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void authFetch('/api/match/statistics', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error();
        setData(await r.json());
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, []);

  if (!data)
    return (
      <p className="match-note">{error ? 'Could not load statistics.' : 'Loading statistics…'}</p>
    );

  const c = data.counts;

  const usefulTimings = data.timings;

  return (
    <SettingsSection className="statistics-panel" title="Statistics">
      <div className="statistics-counters">
        <div title="Completed searches served from the search cache divided by all completed searches">
          <strong>
            {c.searches
              ? `${(Math.min(1, (c.cacheHits || 0) / c.searches) * 100).toFixed(1)}%`
              : '—'}
          </strong>
          <span>Cache hit ratio</span>
        </div>
        {[
          ['Searches completed', c.searches],
          ['Enriched searches', c.enriched],
          ['Prowlarr requests', c.prowlarrRequests],
          ['Cache hits', c.cacheHits],
          ['Failed searches', c.failed],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{Number(value || 0).toLocaleString()}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <h3>Tracker overlap</h3>
      <p className="match-note">
        Release matches use XM’s default release and size rules. Each cached response is sampled
        once. Fresh searches may observe the same torrent again.
      </p>
      {data.overlap.length ? (
        <OverlapMatrix rows={data.overlap} abbreviations={abbreviations} icons={icons} />
      ) : (
        <p className="match-note">Run a search to start finding shared torrents across trackers.</p>
      )}
      <h3 className="statistics-section-heading">
        Operation timings
        <SettingsHelp label="Operation timings">
          Half finish by p50; 95% finish by p95.
        </SettingsHelp>
      </h3>
      {usefulTimings.length ? (
        <TimingPercentiles rows={usefulTimings} />
      ) : (
        <p className="match-note">Timings will appear after your next lookup or search.</p>
      )}
    </SettingsSection>
  );
}
