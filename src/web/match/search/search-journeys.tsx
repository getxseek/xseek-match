import { useMemo, useState } from 'react';
import { ChevronDown, History, X } from 'lucide-react';
import {
  searchJourneys,
  historyKey,
  splitTvSearch,
  type SearchHistoryEntry,
} from '../../../search-history';
import './search-journeys.css';
function searchVariants(entries: SearchHistoryEntry[]) {
  const groups = new Map<string, Map<string, SearchHistoryEntry>>();
  for (const entry of entries) {
    const label =
      (splitTvSearch(entry.query).suffix ||
        (entry.selection?.kind === 'radarr' ? 'Movie' : 'Full title')) +
      (entry.selection?.numbering === 'release' ? ' · Release' : '');
    if (!groups.has(label)) groups.set(label, new Map());
    const modes = groups.get(label)!;
    if (!modes.has(entry.mode || 'text')) modes.set(entry.mode || 'text', entry);
  }
  return [...groups].map(([label, modes]) => ({ label, entries: [...modes.values()] }));
}
const modeLabel = (entry: SearchHistoryEntry) =>
  entry.mode === 'deep' ? 'Dig Deeper' : entry.mode === 'enriched' ? 'Enriched' : 'Text';
function JourneyPicker({
  entries,
  onRun,
}: {
  entries: SearchHistoryEntry[];
  onRun: (entry: SearchHistoryEntry) => void;
}) {
  const [mode, setMode] = useState(entries[0]?.mode || 'text');
  const modes = (['enriched', 'text', 'deep'] as const).filter((value) =>
    entries.some((entry) => (entry.mode || 'text') === value),
  );
  const active = modes.includes(mode) ? mode : modes[0]!;
  const variants = searchVariants(entries)
    .map((group) => ({
      label: group.label,
      entry: group.entries.find((entry) => (entry.mode || 'text') === active),
    }))
    .filter((group) => group.entry)
    .sort((a, b) =>
      a.label === 'Full title' || a.label === 'Movie'
        ? -1
        : b.label === 'Full title' || b.label === 'Movie'
          ? 1
          : a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  return (
    <div className="journey-picker">
      <div className="journey-mode-picker" role="group" aria-label="Search mode">
        {modes.map((value) => (
          <button key={value} aria-pressed={active === value} onClick={() => setMode(value)}>
            {modeLabel({ mode: value, query: '', at: 0 })}
          </button>
        ))}
      </div>
      <div className="journey-scope-picker" role="group" aria-label="Replay a saved search">
        {variants.map(({ label, entry }) => (
          <button key={label} onClick={() => onRun(entry!)} title={`Search ${entry!.query}`}>
            {label === 'Full title'
              ? entries.some((entry) => entry.selection?.kind === 'sonarr')
                ? 'All seasons'
                : 'Full title'
              : label}
          </button>
        ))}
      </div>
    </div>
  );
}
export function SearchJourneys({
  history,
  onRun,
  onRemove,
  onClear,
  detailed = false,
  onHistory,
}: {
  detailed?: boolean;
  onHistory?: () => void;
  history: SearchHistoryEntry[];
  onRun: (entry: SearchHistoryEntry) => void;
  onRemove: (keys: Set<string>) => void;
  onClear: () => void;
}) {
  const journeys = useMemo(
    () => searchJourneys(history).slice(0, detailed ? 30 : 5),
    [history, detailed],
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <section
      className={`search-history search-journeys ${detailed ? 'journeys-detailed' : 'recent-searches'}`}
      aria-label="Recent search journeys"
    >
      <div className="history-heading">
        <span>
          <History size={13} /> {detailed ? 'Saved searches' : 'Recent searches'}
        </span>
        <div>
          {!detailed && onHistory && <button onClick={onHistory}>History</button>}
          {detailed && <button onClick={onClear}>Clear</button>}
        </div>
      </div>
      <ul>
        {journeys.map((journey) => {
          const latest = journey.entries[0]!,
            open = expanded === journey.key;
          const suffix = splitTvSearch(latest.query).suffix;
          const variants = searchVariants(journey.entries);
          const variantCount = variants.reduce((count, group) => count + group.entries.length, 0);
          return (
            <li className="search-journey" key={journey.key}>
              <div className="search-journey-row">
                <button
                  className="journey-resume"
                  onClick={() => onRun(latest)}
                  title={`Resume ${latest.query} · ${modeLabel(latest)}`}
                >
                  <span className="journey-title">{journey.title}</span>
                  <span className="journey-latest">
                    {suffix && <span>{suffix}</span>}
                    <span>{modeLabel(latest)}</span>
                  </span>
                </button>
                {detailed && variantCount > 1 && (
                  <button
                    className="journey-expand"
                    aria-label={`${open ? 'Collapse' : 'Show'} searches for ${journey.title}`}
                    aria-expanded={open}
                    onClick={() => setExpanded(open ? null : journey.key)}
                  >
                    <ChevronDown size={13} />
                  </button>
                )}
                <button
                  className="journey-remove"
                  aria-label={`Remove journey for ${journey.title}`}
                  onClick={() => onRemove(new Set(journey.entries.map(historyKey)))}
                >
                  <X size={13} />
                </button>
              </div>
              {detailed && open && <JourneyPicker entries={journey.entries} onRun={onRun} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
