import { ChevronDown, ExternalLink, Layers, Star } from 'lucide-react';
import {
  isFreeleech,
  sizeConsistency,
  type MatchingConfig,
  type Result,
  type ResultGroup,
} from '../../../domain/matching/group';
import { parseReleaseName } from '../../../parser/parse-release-name';
import type { SearchMode } from '../../../search-history';
import { QuiSearchStatus, QuiTorrentContext, type Presence, type PresenceState } from './qui';
import {
  IndexerIcon,
  LazyReleaseDetails,
  MatchEvidence,
  ReleaseGroupWatermark,
  SizeConsistency,
} from './result-presenters';

function formatGigabytes(bytes: number): string {
  return bytes > 0 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : 'Unknown size';
}

function formatSizeDeviationPercent(size: number, referenceSize: number): string {
  const percent = ((size - referenceSize) / referenceSize) * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

type TrackerSummary = {
  id: number;
  name: string;
  icon?: string;
};

type ReleaseRowItemProps = {
  row: Result;
  trackerIcon?: string;
  displayName: string;
  isOutlier: boolean;
  referenceSize: number | null;
  quiPresence: Record<string, Presence[]>;
};

function ReleaseRowItem({
  row,
  trackerIcon,
  displayName,
  isOutlier,
  referenceSize,
  quiPresence,
}: ReleaseRowItemProps) {
  const deviationPercent =
    isOutlier && referenceSize ? formatSizeDeviationPercent(row.size, referenceSize) : null;

  return (
    <div className="release-row">
      <span className="result-indexer-name">
        <IndexerIcon src={trackerIcon} />
        <span>{displayName}</span>
      </span>

      <span className="original-title">
        <span>{row.title}</span>
        <span className="release-indicators">
          <QuiTorrentContext rows={[row]} matches={quiPresence} trackerOnly />
          {isFreeleech(row) && (
            <span
              className="freeleech-star"
              role="img"
              aria-label="Freeleech"
              title="Freeleech · reported by Prowlarr"
            >
              <Star size={13} fill="currentColor" />
            </span>
          )}
        </span>
      </span>

      <span
        className={isOutlier ? 'size-outlier' : ''}
        title={
          deviationPercent
            ? `${deviationPercent.replace(/^\+/, '')} from majority median`
            : undefined
        }
      >
        {formatGigabytes(row.size)}
        {deviationPercent && <small>△ {deviationPercent}</small>}
      </span>

      <span>{row.seeders ?? '—'} seeds</span>

      <span className="result-actions">
        {row.infoUrl && /^https?:\/\//i.test(row.infoUrl) ? (
          <a
            href={row.infoUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${row.indexer} result`}
          >
            <ExternalLink size={15} />
          </a>
        ) : (
          <span>—</span>
        )}
      </span>
    </div>
  );
}

type DisplayGroup = {
  representative: ResultGroup['representative'] | null;
  rows: Result[];
  evidence: ResultGroup['evidence'];
};

type ReleaseGroupCardProps = {
  group: DisplayGroup;
  flat: boolean;
  trackers: TrackerSummary[];
  important: number[];
  excluded: number[];
  shortName: (id: number, name: string) => string;
  customNames: Record<number, string>;
  quiPresence: Record<string, Presence[]>;
  matching: MatchingConfig;
};

function ReleaseGroupCard({
  group,
  flat,
  trackers,
  important,
  excluded,
  shortName,
  customNames,
  quiPresence,
  matching,
}: ReleaseGroupCardProps) {
  const primaryRow = group.rows[0]!;
  const trackerCount = new Set(group.rows.map((row) => row.indexerId)).size;
  const consistency = sizeConsistency(group.rows, matching.allowedPercent / 100);
  const releaseGroup = (group.representative ?? parseReleaseName(primaryRow.title)).group;

  const importantTrackers = trackers
    .filter((tracker) => important.includes(tracker.id))
    .sort((left, right) => {
      const leftPresent = Number(group.rows.some((row) => row.indexerId === left.id));
      const rightPresent = Number(group.rows.some((row) => row.indexerId === right.id));
      return rightPresent - leftPresent || left.name.localeCompare(right.name);
    });

  const sortedRows = [...group.rows].sort(
    (left, right) =>
      Number(important.includes(right.indexerId)) - Number(important.includes(left.indexerId)) ||
      left.indexer.localeCompare(right.indexer),
  );

  return (
    <LazyReleaseDetails flat={flat} className="release-group">
      <summary>
        {releaseGroup && <ReleaseGroupWatermark name={releaseGroup} />}
        <div className="release-title">
          <div className="release-heading">
            <strong>{primaryRow.title}</strong>
          </div>
          <div>
            <span
              className={`tracker-coverage ${trackerCount > 1 ? 'shared' : ''}`}
              role="img"
              title={`${trackerCount} ${trackerCount === 1 ? 'tracker' : 'trackers'}`}
              aria-label={`${trackerCount} ${trackerCount === 1 ? 'tracker' : 'trackers'}`}
            >
              <Layers size={14} strokeWidth={1.6} />
              <span>{trackerCount}</span>
            </span>
            <span>{formatGigabytes(primaryRow.size)}</span>
            {importantTrackers.map((tracker) => {
              const isPresent = group.rows.some((row) => row.indexerId === tracker.id);
              const statusNote = isPresent
                ? 'found in this group'
                : excluded.includes(tracker.id)
                  ? 'disabled'
                  : 'not in returned results';

              return (
                <span
                  key={tracker.id}
                  className={`important-result ${isPresent ? 'present' : 'absent'}`}
                  title={`${tracker.name}: ${statusNote}`}
                >
                  <IndexerIcon src={tracker.icon} />
                  {shortName(tracker.id, tracker.name)}
                </span>
              );
            })}
            <QuiTorrentContext rows={group.rows} matches={quiPresence} />
            <MatchEvidence evidence={group.evidence} rows={group.rows} />
            <SizeConsistency rows={group.rows} allowed={matching.allowedPercent} />
          </div>
        </div>
        <ChevronDown size={17} />
      </summary>

      <div className="release-rows">
        {sortedRows.map((row) => (
          <ReleaseRowItem
            key={`${row.indexerId}:${row.guid}`}
            row={row}
            trackerIcon={trackers.find((tracker) => tracker.id === row.indexerId)?.icon}
            displayName={customNames[row.indexerId] || row.indexer}
            isOutlier={consistency.outliers.includes(row)}
            referenceSize={consistency.reference}
            quiPresence={quiPresence}
          />
        ))}
      </div>
    </LazyReleaseDetails>
  );
}

type ResultsViewProps = {
  results: Result[] | null;
  visibleResults: Result[];
  groups: ResultGroup[];
  mode: string;
  setMode: (value: string) => void;
  availability: { trackers: TrackerSummary[] };
  important: number[];
  excluded: number[];
  shortName: (id: number, name: string) => string;
  customNames: Record<number, string>;
  quiPresence: Record<string, Presence[]>;
  quiState: PresenceState;
  quiOnly: boolean;
  onToggleQui: () => void;
  allowedResults: Result[];
  matching: MatchingConfig;
  lastSearch: { mode: SearchMode } | null;
};

export function ResultsView({
  results,
  visibleResults,
  groups,
  mode,
  setMode,
  availability,
  important,
  excluded,
  shortName,
  customNames,
  quiPresence,
  quiState,
  quiOnly,
  onToggleQui,
  allowedResults,
  matching,
  lastSearch,
}: ResultsViewProps) {
  if (results === null) return null;

  const displayGroups: DisplayGroup[] =
    mode === 'groups'
      ? groups
      : visibleResults.map((row) => ({
          representative: null,
          rows: [row],
          evidence: 'single' as const,
        }));

  return (
    <section className="match-results results-arrive" aria-live="polite">
      <div className="results-heading">
        <div>
          <div className="match-eyebrow">
            {lastSearch?.mode === 'deep' ? 'DEEPER SEARCH RESULTS' : 'SEARCH RESULTS'}
          </div>
          <h2>
            {visibleResults.length} results. <span>{groups.length} release groups.</span>
          </h2>
        </div>
        <div className="results-actions">
          <QuiSearchStatus
            state={quiState}
            trackerOnly={mode === 'all'}
            only={quiOnly}
            onToggle={onToggleQui}
          />
          <div className="view-switch">
            <button aria-pressed={mode === 'groups'} onClick={() => setMode('groups')}>
              Grouped
            </button>
            <button aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
              All results
            </button>
          </div>
        </div>
      </div>

      {visibleResults.length === 0 && (
        <div className="match-empty">
          {allowedResults.length
            ? 'No results match these filters.'
            : 'No results returned. Try another title or season spelling.'}
        </div>
      )}

      <div key={mode} className="results-mode-transition">
        {displayGroups.map((group) => {
          const primaryRow = group.rows[0]!;
          return (
            <ReleaseGroupCard
              key={`${primaryRow.indexerId}:${primaryRow.guid}`}
              group={group}
              flat={mode !== 'groups'}
              trackers={availability.trackers}
              important={important}
              excluded={excluded}
              shortName={shortName}
              customNames={customNames}
              quiPresence={quiPresence}
              matching={matching}
            />
          );
        })}
      </div>
    </section>
  );
}
