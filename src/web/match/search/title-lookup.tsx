import { ArrowRight, Film, LoaderCircle, Search, Tv, X } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { Numbering } from '../../../contracts/search';
import type { IntegrationCapability } from '../../../integration-capabilities';
import { splitSeasonInput } from '../../../search-input';
import { authFetch } from '../auth/auth-client';
import { posterSources } from './poster-sources';
import { TitleLookupCache } from './title-lookup-cache';
import { preferences } from '../settings/common/preferences';
import './title-lookup.css';

export type TitleMatch = {
  resolvedBy?: 'qui';
  numbering?: Numbering;
  key: string;
  title: string;
  originalTitle?: string;
  aliases?: string[];
  matchedAlias?: string;
  year: number | null;
  kind: string;
  id: number;
  directMatch?: boolean;
  imdb?: string;
  poster?: string;
  seasons: number[];
};

const ROW_HEIGHT_PX = 72;

export function lookupTerm(query: string): string {
  return query.replace(/\s+S\d{1,3}(?:E\d{1,3})?\s*$/i, '').trim();
}

function formatSelectedSeasonQuery(title: string, season: string): string {
  return `${title}${season ? ` S${season.padStart(2, '0')}` : ''}`;
}

function composeSelectedInputQuery(title: string, season: string, rawSuffix: string): string {
  if (season) {
    const suffixSeparator = rawSuffix ? (/^E/i.test(rawSuffix) ? '' : ' ') : '';
    return `${title} S${season}${suffixSeparator}${rawSuffix}`;
  }
  return rawSuffix ? `${title} ${rawSuffix}` : title;
}

const posterImageProps = {
  alt: '',
  referrerPolicy: 'no-referrer',
  loading: 'lazy',
  decoding: 'async',
} as const;

/** Placeholder shimmer, then a blurred tiny preview when one exists, then the sharp poster. */
function Poster({ match }: { match: TitleMatch }) {
  const sources = useMemo(
    () => (match.poster ? posterSources(match.poster) : null),
    [match.poster],
  );
  const [fullSrc, setFullSrc] = useState(sources?.full);
  const [previewShown, setPreviewShown] = useState(false);
  const [fullShown, setFullShown] = useState(false);
  const [failed, setFailed] = useState(false);

  if (sources && fullSrc && !(failed && !previewShown)) {
    return (
      <span
        className="search-title-poster poster-frame"
        data-preview={previewShown}
        data-full={fullShown}
      >
        {sources.preview && !fullShown && (
          <img
            {...posterImageProps}
            className="poster-preview"
            src={sources.preview}
            onLoad={() => setPreviewShown(true)}
          />
        )}
        {!failed && (
          <img
            {...posterImageProps}
            className="poster-full"
            src={fullSrc}
            onLoad={() => setFullShown(true)}
            onError={() =>
              sources.fallback && fullSrc !== sources.fallback
                ? setFullSrc(sources.fallback)
                : setFailed(true)
            }
          />
        )}
      </span>
    );
  }

  return (
    <span className="search-title-poster search-title-poster-fallback">
      {match.kind === 'sonarr' ? <Tv size={17} /> : <Film size={17} />}
    </span>
  );
}

const SuggestionRow = memo(function SuggestionRow({
  row,
  index,
  active,
  id,
  divider,
  total,
  onChoose,
  onActive,
}: {
  row: TitleMatch;
  index: number;
  active: boolean;
  id: string;
  divider: boolean;
  total: number;
  onChoose: (row: TitleMatch) => void;
  onActive: (index: number) => void;
}) {
  const secondaryTitle = row.originalTitle || row.matchedAlias || row.aliases?.[0];

  return (
    <div
      className={divider ? 'search-title-option has-divider' : 'search-title-option'}
      role="option"
      id={id}
      aria-selected={active}
      aria-setsize={total}
      aria-posinset={index + 1}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => onChoose(row)}
      onPointerEnter={() => onActive(index)}
    >
      <Poster match={row} />
      <span className="search-title-label">
        <span title={row.title}>{row.title}</span>
        {secondaryTitle && (
          <small
            className="search-title-original"
            title={row.originalTitle ? 'Original title' : 'Alternate title from Sonarr'}
          >
            {secondaryTitle}
          </small>
        )}
      </span>
      <small className="search-title-meta">
        {row.kind === 'sonarr' ? 'TV' : 'Movie'}
        {row.year ? ` · ${row.year}` : ''}
      </small>
      <ArrowRight className="search-title-pick" size={14} aria-hidden="true" />
    </div>
  );
});

function SuggestionList({
  matches,
  active,
  listId,
  onChoose,
  onActive,
}: {
  matches: TitleMatch[];
  active: number;
  listId: string;
  onChoose: (row: TitleMatch) => void;
  onActive: (index: number) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const node = viewport.current;
    if (!node || active < 0) return;
    const itemTop = active * ROW_HEIGHT_PX;
    const itemBottom = itemTop + ROW_HEIGHT_PX;

    if (itemTop < node.scrollTop) {
      node.scrollTop = itemTop;
    } else if (itemBottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = itemBottom - node.clientHeight;
    }
    setScrollTop(node.scrollTop);
  }, [active]);

  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    setScrollTop(0);
  }, [matches]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - 3);
  const endIndex = Math.min(matches.length, Math.ceil((scrollTop + 320) / ROW_HEIGHT_PX) + 3);
  const isActiveOutsideWindow = active >= 0 && (active < startIndex || active >= endIndex);

  return (
    <div
      ref={viewport}
      className="search-title-list"
      id={listId}
      role="listbox"
      aria-label="Matching titles"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div
        role="presentation"
        style={{ height: matches.length * ROW_HEIGHT_PX, position: 'relative' }}
      >
        <div
          role="presentation"
          style={{ position: 'absolute', left: 0, right: 0, top: startIndex * ROW_HEIGHT_PX }}
        >
          {isActiveOutsideWindow && matches[active] && (
            <div
              style={{
                position: 'absolute',
                top: (active - startIndex) * ROW_HEIGHT_PX,
                left: 0,
                right: 0,
              }}
            >
              <SuggestionRow
                row={matches[active]!}
                index={active}
                active
                id={`${listId}-${active}`}
                divider={false}
                total={matches.length}
                onChoose={onChoose}
                onActive={onActive}
              />
            </div>
          )}

          {matches.slice(startIndex, endIndex).map((row, offset) => {
            const index = startIndex + offset;
            const hasDivider =
              row.directMatch === false && index > 0 && matches[index - 1]?.directMatch !== false;

            return (
              <SuggestionRow
                key={row.key}
                row={row}
                index={index}
                active={index === active}
                id={`${listId}-${index}`}
                divider={hasDivider}
                total={matches.length}
                onChoose={onChoose}
                onActive={onActive}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

type SelectedTitleTokenProps = {
  selected: TitleMatch;
  season: string;
  searchMode?: 'text' | 'enriched' | 'deep';
  seasonSegmentRef: RefObject<HTMLButtonElement | null>;
  onClearTitle: () => void;
  onRemoveSeason: () => void;
};

function SelectedTitleToken({
  selected,
  season,
  searchMode,
  seasonSegmentRef,
  onClearTitle,
  onRemoveSeason,
}: SelectedTitleTokenProps) {
  return (
    <div
      className={`search-title-token ${season ? 'has-season' : ''} ${searchMode === 'deep' ? 'is-text-search' : ''}`}
    >
      <button
        type="button"
        className="search-title-chip"
        title={selected.title}
        aria-label={`Clear selected title ${selected.title}`}
        onClick={onClearTitle}
      >
        {searchMode === 'deep' ? (
          <Search size={14} />
        ) : selected.kind === 'sonarr' ? (
          <Tv size={14} />
        ) : (
          <Film size={14} />
        )}
        <span>{selected.title}</span>
        {searchMode === 'deep' ? (
          <small className="search-chip-mode">Text</small>
        ) : (
          // Sonarr already disambiguates remakes as "Title (2023)"; do not repeat the year.
          selected.year &&
          !selected.title.includes(`(${selected.year})`) && <small>{selected.year}</small>
        )}
        <X size={13} />
      </button>

      {season && (
        <button
          ref={seasonSegmentRef}
          type="button"
          className="search-title-season"
          aria-label={`Remove season ${Number(season)}`}
          title="Remove season"
          onClick={onRemoveSeason}
        >
          {selected.numbering === 'release' && (
            <small className="search-numbering-label">Release</small>
          )}
          S{season.padStart(2, '0')}
          <X size={12} />
        </button>
      )}
    </div>
  );
}

type SearchSeasonChipsProps = {
  selected: TitleMatch;
  season: string;
  shownSeasons: number[];
  hasXemDifference: boolean;
  onChangeNumbering: (numbering: Numbering) => void;
  onSelectAllSeasons: () => void;
  onSelectSeason: (seasonNumber: number, rect: DOMRect) => void;
};

function SearchSeasonChips({
  selected,
  season,
  shownSeasons,
  hasXemDifference,
  onChangeNumbering,
  onSelectAllSeasons,
  onSelectSeason,
}: SearchSeasonChipsProps) {
  return (
    <div className="search-season-chips" role="group" aria-label="Season">
      {hasXemDifference && (
        <div className="search-numbering" role="group" aria-label="Season numbering">
          {(['tvdb', 'release'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={(selected.numbering || 'tvdb') === value}
              title={
                value === 'tvdb'
                  ? 'Sonarr / TVDB season numbering'
                  : 'Release numbering from TheXEM'
              }
              onClick={() => onChangeNumbering(value)}
            >
              {value === 'tvdb' ? 'TVDB' : 'Release'}
            </button>
          ))}
        </div>
      )}

      <button type="button" aria-pressed={!season} onClick={onSelectAllSeasons}>
        All seasons
      </button>

      {shownSeasons.map((seasonNum) => (
        <button
          key={seasonNum}
          type="button"
          aria-pressed={Number(season) === seasonNum}
          onClick={(event) =>
            onSelectSeason(seasonNum, event.currentTarget.getBoundingClientRect())
          }
        >
          S{String(seasonNum).padStart(2, '0')}
        </button>
      ))}
    </div>
  );
}

type SearchBarProps = {
  status?: ReactNode;
  searchMode?: 'text' | 'enriched' | 'deep';
  actions?: (selection: TitleMatch | null) => ReactNode;
  restoredSelection?: TitleMatch;
  query: string;
  onQuery: (query: string) => void;
  busy: boolean;
  hasResults: boolean;
  onSearch: (
    event?: FormEvent,
    selection?: TitleMatch | null,
    term?: string,
    refresh?: boolean,
  ) => void;
  onClear: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function SearchBar({
  query,
  onQuery,
  busy,
  hasResults,
  onSearch,
  onClear,
  inputRef,
  restoredSelection,
  actions,
  searchMode,
  status,
}: SearchBarProps) {
  const [selected, setSelected] = useState<TitleMatch | null>(null);
  const [allMatches, setAllMatches] = useState<TitleMatch[]>([]);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [capabilities, setCapabilities] = useState<IntegrationCapability[]>([]);

  const canTV = capabilities.includes('tv-title-lookup');
  const canMovie = capabilities.includes('movie-title-lookup');
  const canLookup = canTV || canMovie;

  useEffect(() => {
    let isMounted = true;
    async function refreshCapabilities() {
      try {
        const response = await authFetch('/api/match/integrations');
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted) setCapabilities(data.capabilities || []);
      } catch {}
    }
    void refreshCapabilities();
    window.addEventListener('focus', refreshCapabilities);
    return () => {
      isMounted = false;
      window.removeEventListener('focus', refreshCapabilities);
    };
  }, []);

  const [editingSuffix, setEditingSuffix] = useState(false);
  const [xem, setXem] = useState<{ id: number; seasons: number[]; differs: boolean } | null>(null);

  useEffect(() => {
    setXem(null);
    if (selected?.kind !== 'sonarr') return;

    const id = selected.id;
    const controller = new AbortController();

    void authFetch(`/api/match/xem?id=${id}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const data = await response.json();
        if (controller.signal.aborted) return;

        const mappings = data.mappings as Array<{
          tvdbSeason: number;
          tvdbEpisode: number;
          sceneSeason: number;
          sceneEpisode: number;
        }>;
        setXem({
          id,
          seasons: [
            ...new Set(mappings.map((row) => row.sceneSeason).filter((num) => num > 0)),
          ].sort((left, right) => left - right),
          differs: mappings.some(
            (row) => row.sceneSeason !== row.tvdbSeason || row.sceneEpisode !== row.tvdbEpisode,
          ),
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, [selected?.id, selected?.kind]);

  const releaseSeasons = xem?.id === selected?.id ? xem?.seasons : undefined;
  const shownSeasons =
    selected?.numbering === 'release' ? releaseSeasons || [] : selected?.seasons || [];

  const [contentType, setContentType] = useState<'all' | 'tv' | 'movie'>('all');
  const strictArr = preferences.getItem('xseek-match-strict-arr') !== 'false';

  const matches = useMemo(
    () =>
      allMatches.filter(
        (row) =>
          (!strictArr || row.directMatch !== false) &&
          (contentType === 'all' || row.kind === (contentType === 'tv' ? 'sonarr' : 'radarr')),
      ),
    [allMatches, contentType, strictArr],
  );

  const seasonSegment = useRef<HTMLButtonElement>(null);
  const seasonFrom = useRef<DOMRect | null>(null);
  const seasonAnimation = useRef<Animation | null>(null);
  useEffect(() => () => seasonAnimation.current?.cancel(), []);

  const lookupQueue = useRef<Promise<void>>(Promise.resolve());
  const lookupCache = useRef(new TitleLookupCache<TitleMatch>());
  const [lookupError, setLookupError] = useState(false);
  const [lookupRevision, setLookupRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  const holdFired = useRef(false);
  const [holdingSearch, setHoldingSearch] = useState(false);
  const [holdShape, setHoldShape] = useState({ width: 46, height: 46, radius: 14 });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearHold = () => {
    clearTimeout(holdTimer.current);
    setHoldingSearch(false);
  };
  useEffect(() => () => clearTimeout(holdTimer.current), []);

  const forceRefresh = useRef(false);
  const listId = useId();
  const term = lookupTerm(query);

  useEffect(() => {
    setSelected(restoredSelection ?? null);
  }, [restoredSelection]);

  useLayoutEffect(() => {
    const form = inputRef.current?.closest('form');
    if (!form) return;
    const updateFormHeight = () =>
      root.current?.style.setProperty(
        '--search-form-height',
        `${form.getBoundingClientRect().height}px`,
      );
    updateFormHeight();
    const observer = new ResizeObserver(updateFormHeight);
    observer.observe(form);
    return () => observer.disconnect();
  }, [inputRef]);

  // History, demo and navigation can replace the controlled query from outside.
  const selectionValid =
    selected &&
    (selected.kind === 'sonarr' ? canTV : canMovie) &&
    (query === selected.title || query.startsWith(`${selected.title} `));

  useEffect(() => {
    if (selected && !selectionValid) setSelected(null);
  }, [selected, selectionValid]);

  useEffect(() => {
    if (!canLookup || busy || selectionValid || term.length < 2 || dismissed) {
      setAllMatches([]);
      setLoading(false);
      return;
    }
    if (!focused) {
      setLoading(false);
      return;
    }

    const lookupScope = JSON.stringify([canTV, canMovie]);
    const saved = lookupCache.current.get(term, lookupScope);
    if (saved) {
      setAllMatches(saved);
      setLoading(false);
      setLookupError(false);
      return;
    }

    let live = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Show the earlier result narrowed to the new text while the fresh lookup runs.
    setAllMatches(lookupCache.current.preview(term, lookupScope) ?? []);
    setActive(-1);
    setLoading(true);
    setLookupError(false);

    // Finish one read before sending the latest queued query. Superseded queued reads never run.
    const debounceTimer = setTimeout(() => {
      lookupQueue.current = lookupQueue.current
        .catch(() => {})
        .then(async () => {
          if (!live) return;
          try {
            const response = await authFetch('/api/match/integrations', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'lookup',
                title: term,
                contentType: !canTV ? 'movie' : !canMovie ? 'tv' : 'all',
              }),
              signal: AbortSignal.timeout(20_000),
            });
            if (!response.ok) throw new Error('Title lookup failed');
            const data = await response.json();

            if (data.failed === 0 && !data.enrichmentPending) {
              lookupCache.current.set(term, lookupScope, data.matches);
            }

            if (live) {
              if (data.enrichmentPending) {
                retryTimer = setTimeout(() => setLookupRevision((rev) => rev + 1), 1000);
              }
              setAllMatches(data.matches);
              setLookupError(data.failed > 0 && data.matches.length === 0);
            }
          } catch {
            if (live) setLookupError(true);
          } finally {
            if (live) setLoading(false);
          }
        });
    }, 250);

    return () => {
      live = false;
      clearTimeout(debounceTimer);
      clearTimeout(retryTimer);
    };
  }, [term, focused, busy, selectionValid, dismissed, canTV, canMovie, canLookup, lookupRevision]);

  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setFocused(false);
        setActive(-1);
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, []);

  const choose = useCallback(
    (row: TitleMatch) => {
      const suffix = query.match(/\s+(S\d{1,3}(?:E\d{1,3})?)\s*$/i)?.[1];
      const nextQuery =
        row.title + (row.kind === 'sonarr' && suffix ? ` ${suffix.toUpperCase()}` : '');
      setEditingSuffix(false);
      setSelected(row);
      onQuery(nextQuery);
      setAllMatches([]);
      setActive(-1);
      setDismissed(true);
      inputRef.current?.focus();

      if (row.kind === 'radarr') {
        setFocused(false);
        onSearch(undefined, row, nextQuery);
      }
    },
    [query, onQuery, inputRef, onSearch],
  );

  const showSuggestions =
    canLookup &&
    focused &&
    !dismissed &&
    !selectionValid &&
    (term.length >= 2 || loading || matches.length > 0 || lookupError) &&
    !busy;

  const rawSuffix = selectionValid ? query.slice(selected.title.length).trimStart() : query;
  const parsedSuffix =
    selectionValid && selected.kind === 'sonarr'
      ? splitSeasonInput(rawSuffix, editingSuffix && focused)
      : { season: '', input: rawSuffix };
  const season = parsedSuffix.season;
  const inputSuffix = parsedSuffix.input;

  useLayoutEffect(() => {
    const target = seasonSegment.current;
    const from = seasonFrom.current;
    seasonFrom.current = null;
    if (!target || !from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    seasonAnimation.current?.cancel();
    const to = target.getBoundingClientRect();
    seasonAnimation.current = target.animate(
      [
        {
          transform: `translate(${from.left - to.left}px,${from.top - to.top}px) scale(.9)`,
          opacity: 0.3,
        },
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  }, [season]);

  const inputPlaceholder = selectionValid
    ? selected.kind === 'sonarr'
      ? season
        ? 'Episode…'
        : 'Season or episode…'
      : ''
    : 'Search a show or movie, e.g. Severance S01';

  const showSeasonBar = Boolean(
    selectionValid && selected.kind === 'sonarr' && shownSeasons.length > 0 && !busy,
  );

  return (
    <div
      ref={root}
      className="search-bar-wrapper"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setEditingSuffix(false);
          setFocused(false);
        }
      }}
    >
      <form
        className={`match-search ${busy ? 'is-searching' : ''} ${selectionValid ? 'has-title' : ''}`}
        aria-busy={busy}
        onSubmit={(event) => {
          setEditingSuffix(false);
          setFocused(false);
          setDismissed(true);
          const refresh = forceRefresh.current;
          forceRefresh.current = false;
          onSearch(event, selectionValid ? selected : null, undefined, refresh);
        }}
      >
        {selectionValid && (
          <SelectedTitleToken
            selected={selected}
            season={season}
            searchMode={searchMode}
            seasonSegmentRef={seasonSegment}
            onClearTitle={() => {
              setSelected(null);
              onQuery('');
              setDismissed(false);
              inputRef.current?.focus();
            }}
            onRemoveSeason={() => {
              onQuery(selected.title);
              inputRef.current?.focus();
            }}
          />
        )}

        <input
          ref={inputRef}
          aria-label="Show and season"
          role={canLookup ? 'combobox' : undefined}
          aria-autocomplete={canLookup ? 'list' : undefined}
          aria-expanded={canLookup ? showSuggestions : undefined}
          aria-controls={showSuggestions ? listId : undefined}
          aria-activedescendant={showSuggestions && active >= 0 ? `${listId}-${active}` : undefined}
          placeholder={inputPlaceholder}
          value={inputSuffix}
          onFocus={() => setFocused(true)}
          onChange={(event) => {
            if (!season) setEditingSuffix(true);
            const nextQuery = selectionValid
              ? composeSelectedInputQuery(selected.title, season, event.target.value)
              : event.target.value;
            onQuery(nextQuery);
            setDismissed(false);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDismissed(true);
              setActive(-1);
            }
            if (
              showSuggestions &&
              matches.length &&
              (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
              event.preventDefault();
              setActive((index) =>
                index < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : matches.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                    matches.length,
              );
            }
            if (event.key === 'Enter' && showSuggestions && active >= 0 && matches[active]) {
              event.preventDefault();
              choose(matches[active]!);
            }
          }}
          maxLength={200}
        />

        {(query || hasResults) && (
          <button
            type="button"
            className="clear-search"
            aria-label="Clear search"
            title="Clear search"
            onClick={() => {
              setSelected(null);
              setDismissed(false);
              onClear();
              inputRef.current?.focus();
            }}
          >
            <X size={18} />
          </button>
        )}

        <button
          aria-label="Search"
          className={`search-submit${holdingSearch ? ' is-holding' : ''}`}
          title="Hold to refresh"
          disabled={busy || !query.trim()}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            clearHold();
            const bounds = event.currentTarget.getBoundingClientRect();
            setHoldShape({
              width: bounds.width,
              height: bounds.height,
              radius: parseFloat(getComputedStyle(event.currentTarget).borderTopLeftRadius) || 0,
            });
            setHoldingSearch(true);
            holdFired.current = false;
            forceRefresh.current = false;
            const button = event.currentTarget;
            holdTimer.current = setTimeout(() => {
              holdFired.current = true;
              forceRefresh.current = true;
              clearHold();
              button.form?.requestSubmit(button);
            }, 600);
          }}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onClick={(event) => {
            if (holdFired.current && event.detail !== 0) {
              event.preventDefault();
              return;
            }
            forceRefresh.current = false;
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {holdingSearch && (
            <svg
              className="search-hold-edge"
              viewBox={`0 0 ${holdShape.width} ${holdShape.height}`}
              fill="none"
              aria-hidden="true"
            >
              <rect
                className="hold-edge-track"
                x="0"
                y="0"
                width={holdShape.width}
                height={holdShape.height}
                rx={holdShape.radius}
                pathLength="100"
              />
              <rect
                className="hold-edge-spark"
                x="0"
                y="0"
                width={holdShape.width}
                height={holdShape.height}
                rx={holdShape.radius}
                pathLength="100"
              />
            </svg>
          )}
          {busy ? <LoaderCircle className="search-spinner" size={22} /> : <ArrowRight size={22} />}
        </button>
      </form>

      {showSuggestions && (
        <div className="search-title-suggestions">
          <div className="search-title-suggestion-heading">
            <span>
              {loading ? (
                <>
                  <LoaderCircle size={12} className="search-spinner" /> Finding titles…
                </>
              ) : lookupError ? (
                'Title suggestions unavailable. You can still search.'
              ) : matches.length ? (
                'Titles'
              ) : (
                'No matching titles'
              )}
            </span>
            <div className="search-title-type-filters" role="group" aria-label="Title type">
              {(['all', 'tv', 'movie'] as const)
                .filter(
                  (type) =>
                    type === 'all' || (type === 'tv' && canTV) || (type === 'movie' && canMovie),
                )
                .map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={contentType === type}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setContentType(type);
                      setActive(-1);
                    }}
                  >
                    {type === 'all' ? 'All' : type === 'tv' ? 'TV' : 'Movies'}
                  </button>
                ))}
            </div>
          </div>
          {matches.length > 0 && (
            <SuggestionList
              matches={matches}
              active={active}
              listId={listId}
              onChoose={choose}
              onActive={setActive}
            />
          )}
        </div>
      )}

      <div className="search-bar-footer">
        <div className="search-bar-seasons" data-visible={showSeasonBar}>
          <div>
            {showSeasonBar && selectionValid && (
              <SearchSeasonChips
                selected={selected}
                season={season}
                shownSeasons={shownSeasons}
                hasXemDifference={Boolean(xem?.id === selected.id && xem.differs)}
                onChangeNumbering={(numbering) => {
                  setSelected({ ...selected, numbering });
                  setEditingSuffix(false);
                  onQuery(selected.title);
                }}
                onSelectAllSeasons={() => {
                  onQuery(selected.title);
                  onSearch(undefined, selected, selected.title);
                }}
                onSelectSeason={(seasonNum, rect) => {
                  setEditingSuffix(false);
                  seasonFrom.current = rect;
                  const next = formatSelectedSeasonQuery(selected.title, String(seasonNum));
                  onQuery(next);
                  onSearch(undefined, selected, next);
                }}
              />
            )}
          </div>
        </div>
        <div className="search-bar-status-row">
          {status}
          {actions?.(selectionValid ? selected : null)}
        </div>
      </div>
    </div>
  );
}
