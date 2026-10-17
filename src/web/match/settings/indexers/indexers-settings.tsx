import {
  BookOpen,
  CircleHelp,
  CircleUserRound,
  Ellipsis,
  Film,
  Gamepad2,
  Monitor,
  Music,
  Pencil,
  RefreshCw,
  Star,
  Tv,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { SettingsSection } from '../../../components/ui/settings-section';
import { SwitchButton } from '../../../components/ui/switch-button';
import { IndexerIcon } from '../../results/result-presenters';

export type TrackerInfo = {
  id: number;
  name: string;
  available: boolean;
  icon?: string;
  categories?: string[];
};

export type TrackerAvailability = {
  message: string;
  trackers: TrackerInfo[];
};

const CATEGORY_ICONS: Record<string, typeof Film> = {
  Movies: Film,
  TV: Tv,
  Audio: Music,
  Books: BookOpen,
  Console: Gamepad2,
  PC: Monitor,
  Adult: CircleUserRound,
  Other: Ellipsis,
  Unknown: CircleHelp,
};

export function CategorySymbol({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category] ?? CircleHelp;
  if (category === 'Adult') {
    return (
      <span className="category-adult-symbol" aria-hidden="true">
        18+
      </span>
    );
  }
  return <Icon size={14} strokeWidth={2.5} aria-hidden="true" />;
}

export function cycleTriStateCategory(
  category: string,
  included: string[],
  excluded: string[],
  setIncluded: (updater: (prev: string[]) => string[]) => void,
  setExcluded: (updater: (prev: string[]) => string[]) => void,
): void {
  if (included.includes(category)) {
    setIncluded((prev) => prev.filter((item) => item !== category));
    setExcluded((prev) => [...prev, category]);
  } else if (excluded.includes(category)) {
    setExcluded((prev) => prev.filter((item) => item !== category));
  } else {
    setIncluded((prev) => [...prev, category]);
  }
}

function EditableTrackerName({
  name,
  value,
  onSave,
}: {
  name: string;
  value?: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelled = useRef(false);

  if (editing) {
    return (
      <input
        className="indexer-name-editor"
        aria-label={`Custom name for ${name}`}
        autoFocus
        value={draft}
        placeholder={name}
        maxLength={60}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!cancelled.current) {
            onSave(draft.trim() === name ? '' : draft.trim());
          }
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            cancelled.current = true;
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="indexer-name"
      title={`${name} · Click to rename`}
      onClick={() => {
        cancelled.current = false;
        setDraft(value || name);
        setEditing(true);
      }}
    >
      <span>{value || name}</span>
      {value && <Pencil size={11} aria-label="Custom name" />}
    </button>
  );
}

type IndexersPanelProps = {
  availability: TrackerAvailability;
  includedCount: number;
  excluded: number[];
  important: number[];
  customNames: Record<string, string>;
  saveError: string;
  onRefresh: () => void;
  onRenameTracker: (id: number, value: string) => void;
  onToggleImportant: (id: number) => void;
  onToggleTracker: (id: number) => void;
};

export function IndexersPanel({
  availability,
  includedCount,
  excluded,
  important,
  customNames,
  saveError,
  onRefresh,
  onRenameTracker,
  onToggleImportant,
  onToggleTracker,
}: IndexersPanelProps) {
  const [indexerFilter, setIndexerFilter] = useState('');
  const [includedCategories, setIncludedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);

  function matchesCategorySelection(categories?: string[]): boolean {
    const normalized = categories?.length ? categories : ['Unknown'];
    const hasExcluded = normalized.some((category) => excludedCategories.includes(category));
    const hasIncluded =
      !includedCategories.length ||
      normalized.some((category) => includedCategories.includes(category));
    return !hasExcluded && hasIncluded;
  }

  function matchesTextFilter(tracker: TrackerInfo): boolean {
    const searchable = `${tracker.name} ${customNames[tracker.id] ?? ''}`.toLowerCase();
    return searchable.includes(indexerFilter.toLowerCase());
  }

  const allCategoryNames = [
    ...new Set(
      availability.trackers.flatMap((tracker) =>
        tracker.categories?.length ? tracker.categories : ['Unknown'],
      ),
    ),
  ].sort();

  const filteredTrackers = [...availability.trackers]
    .filter((tracker) => matchesCategorySelection(tracker.categories))
    .filter(matchesTextFilter)
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <SettingsSection
      className="indexers-panel"
      headingId="indexers-title"
      title="Indexers"
      help="Switches control which trackers are searched. Stars prioritize trackers without hiding other results. Click a name to rename it; clear the name to restore it. Saved changes affect xseek-match only."
      subtitle={
        <p>
          {includedCount} enabled · {availability.trackers.length - includedCount} disabled
        </p>
      }
      actions={
        <button
          aria-label="Sync indexers from Prowlarr"
          title="Sync from Prowlarr"
          onClick={onRefresh}
        >
          <RefreshCw size={15} />
        </button>
      }
    >
      <div className="indexers-toolbar">
        <input
          className="indexer-filter"
          aria-label="Filter indexers"
          placeholder="Filter indexers"
          value={indexerFilter}
          onChange={(event) => setIndexerFilter(event.target.value)}
        />
      </div>

      {saveError && (
        <p role="alert" className="match-error">
          {saveError}
        </p>
      )}

      <div
        className="indexer-category-filters"
        role="group"
        aria-label="Filter indexers by category"
      >
        <button
          aria-pressed={includedCategories.length === 0 && excludedCategories.length === 0}
          onClick={() => {
            setIncludedCategories([]);
            setExcludedCategories([]);
          }}
        >
          All
        </button>
        {allCategoryNames.map((category) => {
          const isExcluded = excludedCategories.includes(category);
          const isIncluded = includedCategories.includes(category);
          const stateLabel = isExcluded ? 'excluded' : isIncluded ? 'included' : 'neutral';
          const nextActionLabel = isExcluded ? 'clear' : isIncluded ? 'exclude' : 'include';
          const count = availability.trackers.filter((tracker) =>
            (tracker.categories?.length ? tracker.categories : ['Unknown']).includes(category),
          ).length;

          return (
            <button
              key={category}
              aria-pressed={isIncluded || isExcluded}
              data-state={isExcluded ? 'exclude' : isIncluded ? 'include' : 'neutral'}
              aria-label={`${category}: ${stateLabel}. Click to ${nextActionLabel}.`}
              onClick={() =>
                cycleTriStateCategory(
                  category,
                  includedCategories,
                  excludedCategories,
                  setIncludedCategories,
                  setExcludedCategories,
                )
              }
            >
              <span className="category-filter-icon">
                <CategorySymbol category={category} />
              </span>
              <span className="category-filter-label">{category}</span>
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {availability.trackers.length === 0 ? (
        <p className="match-note">{availability.message}</p>
      ) : (
        <>
          <div className="indexer-columns">
            <div>
              <span>Indexer</span>
              <span>Enabled</span>
            </div>
            <div>
              <span>Indexer</span>
              <span>Enabled</span>
            </div>
          </div>

          <div className="tracker-settings">
            {filteredTrackers.map((tracker) => {
              const isDisabled = excluded.includes(tracker.id);
              const isImportant = important.includes(tracker.id);
              const categoryList = tracker.categories?.length ? tracker.categories : ['Unknown'];

              return (
                <div
                  key={tracker.id}
                  className={isDisabled ? 'indexer-row indexer-disabled' : 'indexer-row'}
                >
                  <span className="indexer-icon">
                    <IndexerIcon src={tracker.icon} />
                  </span>
                  <div className="indexer-identity">
                    <EditableTrackerName
                      name={tracker.name}
                      value={customNames[tracker.id]}
                      onSave={(value) => onRenameTracker(tracker.id, value)}
                    />
                    <div className="indexer-category-labels">{categoryList.join(' \u00b7 ')}</div>
                  </div>
                  <button
                    type="button"
                    className="indexer-star"
                    aria-label={`Important ${tracker.name}`}
                    aria-pressed={isImportant}
                    onClick={(event) => {
                      event.preventDefault();
                      onToggleImportant(tracker.id);
                    }}
                  >
                    <Star size={14} fill={isImportant ? 'currentColor' : 'none'} />
                  </button>
                  <SwitchButton
                    label={`Enable ${tracker.name}`}
                    checked={!isDisabled}
                    onToggle={() => onToggleTracker(tracker.id)}
                  />
                </div>
              );
            })}
          </div>

          {filteredTrackers.length === 0 && (
            <p className="match-note">No indexers match these filters.</p>
          )}
        </>
      )}
    </SettingsSection>
  );
}
