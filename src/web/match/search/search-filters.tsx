import { Check, X } from 'lucide-react';
import type { RefObject } from 'react';
import { matchesResultCategories, type Result } from '../../../domain/matching/group';
import { isDatedTvSlice, isEpisodeSlice, isMovieSlice } from '../../../domain/matching/release-key';
import type { ParsedRelease } from '../../../parser/types.js';
import { Button } from '../../components/ui/button';
import { CategorySymbol, cycleTriStateCategory } from '../settings/indexers/indexers-settings';

export type SearchFilterState = {
  resolutions: string[];
  sources: string[];
  releaseTypes: string[];
  resultIncludes: string[];
  resultExcludes: string[];
};

const RESULT_CATEGORIES = [
  'Movies',
  'TV',
  'Audio',
  'Books',
  'Console',
  'PC',
  'Adult',
  'Other',
  'Unknown',
] as const;

const STANDARD_RESOLUTIONS = ['480p', '576p', '720p', '1080p', '1080i', '2160p', '4320p'];
const STANDARD_SOURCES = ['WEB-DL', 'WEBRIP', 'BLURAY', 'HDTV'];

function toggleFilterValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function matchesReleaseTypeFilter(parsed: ParsedRelease, releaseType: string): boolean {
  if (releaseType === 'pack') return parsed.isPack;
  if (releaseType === 'episode') return isEpisodeSlice(parsed) || isDatedTvSlice(parsed);
  return isMovieSlice(parsed);
}

export function matchesSearchResultFilters(
  row: Result,
  parsed: ParsedRelease,
  filters: SearchFilterState,
): boolean {
  if (!matchesResultCategories(row, filters.resultIncludes, filters.resultExcludes)) {
    return false;
  }
  if (filters.resolutions.length && !filters.resolutions.includes(parsed.resolution ?? '')) {
    return false;
  }
  if (filters.sources.length && !filters.sources.includes(parsed.source ?? '')) {
    return false;
  }
  if (
    filters.releaseTypes.length &&
    !filters.releaseTypes.some((type) => matchesReleaseTypeFilter(parsed, type))
  ) {
    return false;
  }
  return true;
}

type SearchFilterPopoverProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  excludedTrackerCount: number;
  parsedResolutions: string[];
  sourceOptions: string[];
  resolutions: string[];
  setResolutions: (updater: string[] | ((prev: string[]) => string[])) => void;
  sources: string[];
  setSources: (updater: string[] | ((prev: string[]) => string[])) => void;
  releaseTypes: string[];
  setReleaseTypes: (updater: string[] | ((prev: string[]) => string[])) => void;
  resultIncludes: string[];
  setResultIncludes: (updater: string[] | ((prev: string[]) => string[])) => void;
  resultExcludes: string[];
  setResultExcludes: (updater: string[] | ((prev: string[]) => string[])) => void;
  activeFilterCount: number;
  onClose: () => void;
  onReset: () => void;
};

export function SearchFilterPopover({
  panelRef,
  excludedTrackerCount,
  parsedResolutions,
  sourceOptions,
  resolutions,
  setResolutions,
  sources,
  setSources,
  releaseTypes,
  setReleaseTypes,
  resultIncludes,
  setResultIncludes,
  resultExcludes,
  setResultExcludes,
  activeFilterCount,
  onClose,
  onReset,
}: SearchFilterPopoverProps) {
  const filterSections = [
    {
      label: 'Resolution',
      values: [...new Set([...STANDARD_RESOLUTIONS, ...parsedResolutions])].map((value) => ({
        value,
        label: value,
      })),
      selected: resolutions,
      set: setResolutions,
    },
    {
      label: 'Source',
      values: [...new Set([...STANDARD_SOURCES, ...sourceOptions, ...sources])].map((value) => ({
        value,
        label: value === 'BLURAY' ? 'BluRay' : value === 'WEBRIP' ? 'WEBRip' : value,
      })),
      selected: sources,
      set: setSources,
    },
    {
      label: 'Release type',
      values: [
        { value: 'pack', label: 'Packs' },
        { value: 'episode', label: 'Episodes' },
        { value: 'movie', label: 'Movies' },
      ],
      selected: releaseTypes,
      set: setReleaseTypes,
    },
  ];

  return (
    <div
      ref={panelRef}
      id="search-filters"
      className="filter-popover"
      role="region"
      aria-label="Search filters"
    >
      <div className="filter-heading">
        <span>Filters</span>
        <button aria-label="Close filters" onClick={onClose}>
          <X size={15} />
        </button>
      </div>

      {excludedTrackerCount > 0 && (
        <p className="filter-excluded-count">
          {excludedTrackerCount} trackers excluded in Indexers
        </p>
      )}

      <fieldset>
        <legend>Category</legend>
        <div className="indexer-category-filters result-category-filters">
          {RESULT_CATEGORIES.map((category) => {
            const isExcluded = resultExcludes.includes(category);
            const isIncluded = resultIncludes.includes(category);
            const stateLabel = isExcluded ? 'excluded' : isIncluded ? 'included' : 'neutral';

            return (
              <button
                key={category}
                aria-pressed={isIncluded || isExcluded}
                data-state={isExcluded ? 'exclude' : isIncluded ? 'include' : 'neutral'}
                aria-label={`${category}: ${stateLabel}`}
                onClick={() =>
                  cycleTriStateCategory(
                    category,
                    resultIncludes,
                    resultExcludes,
                    setResultIncludes,
                    setResultExcludes,
                  )
                }
              >
                <span className="category-filter-icon">
                  <CategorySymbol category={category} />
                </span>
                <span className="category-filter-label">{category}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {filterSections.map((section) => (
        <fieldset key={section.label}>
          <legend>{section.label}</legend>
          <div className="filter-chips">
            {section.values.map((option) => {
              const isSelected = section.selected.includes(option.value);
              return (
                <button
                  key={option.value}
                  aria-pressed={isSelected}
                  onClick={() => section.set(toggleFilterValue(section.selected, option.value))}
                >
                  {isSelected && <Check size={12} />} {option.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="filter-footer">
        <button disabled={!activeFilterCount} onClick={onReset}>
          Reset
        </button>
        <Button size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function SearchLoadingSkeleton() {
  return (
    <section className="search-loading" role="status" aria-label="Searching indexers">
      <div className="search-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span className="loading-caption">
        Searching indexers<span className="loading-dots">…</span>
      </span>
      <div className="skeleton-results" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <div className="skeleton-card" key={index} style={{ animationDelay: `${index * 80}ms` }}>
            <div className="skeleton-line skeleton-title" />
            <div className="skeleton-meta">
              <div className="skeleton-line skeleton-badge" />
              <div className="skeleton-line skeleton-size" />
              <div className="skeleton-line skeleton-detail" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
