import {
  ArrowLeft,
  ArrowUp,
  Database,
  History,
  Info,
  Layers,
  Palette,
  Plug,
  RefreshCw,
  ScrollText,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
} from 'lucide-react';
import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { decodeResults } from '../../contracts/search';
import {
  defaultMatching,
  groupResults,
  validMatching,
  type MatchingConfig,
  type Result,
} from '../../domain/matching/group';
import { parseReleaseName } from '../../parser/parse-release-name.js';
import { hasQuiMatch, quiResultKey } from '../../qui-result';
import {
  historyKey,
  inferTvTitle,
  recentHistoryKey,
  splitTvSearch,
  validHistoryEntry,
  visibleRecentHistory,
  type SearchHistoryEntry,
  type SearchMode,
} from '../../search-history';
import { Button } from '../components/ui/button';
import '../styles.css';
import { authFetch } from './auth/auth-client';
import { ActivityPanel } from './results/activity';
import { useQuiPresence } from './results/qui';
import { IndexerIcon } from './results/result-presenters';
import './results/result-presenters.css';
import { ResultsView } from './results/results';
import {
  matchesSearchResultFilters,
  SearchFilterPopover,
  SearchLoadingSkeleton,
} from './search/search-filters';
import { SearchJourneys } from './search/search-journeys';
import './search/search-layout.css';
import { lookupTerm, SearchBar, type TitleMatch } from './search/title-lookup';
import { AppearancePanel } from './settings/appearance/appearance';
import { IndexersPanel, type TrackerAvailability } from './settings/indexers/indexers-settings';
import { IntegrationsPanel } from './settings/integrations/integrations';
import { MatchingSettings } from './settings/matching/matching-settings';
import { preferences } from './settings/common/preferences';
import { SaveStatus } from './settings/common/save-status';
import { AccountPanel } from './settings/panels/account-panel';
import { InfoPanel } from './settings/panels/info-panel';
import { TasksPanel } from './settings/panels/tasks-panel';
import { trackerAbbreviation } from './settings/indexers/tracker-abbreviations';
import { loadTrackerDefinitions } from './settings/indexers/tracker-definitions';
import { StatisticsPanel } from './statistics/statistics';
import './style.css';

type SettingsCategory =
  | 'indexers'
  | 'info'
  | 'cache'
  | 'logs'
  | 'matching'
  | 'tasks'
  | 'account'
  | 'integrations'
  | 'statistics'
  | 'appearance';

type AppPage = 'search' | 'settings' | 'history';

const SETTINGS_NAV_ITEMS = [
  { key: 'info', label: 'Info', icon: Info },
  { key: 'indexers', label: 'Indexers', icon: Database },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'matching', label: 'Matching', icon: SlidersHorizontal },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'cache', label: 'Search Cache', icon: Layers },
  { key: 'statistics', label: 'Statistics', icon: Layers },
  { key: 'tasks', label: 'Tasks', icon: RefreshCw },
  { key: 'account', label: 'Accounts', icon: UserRound },
  { key: 'logs', label: 'Logs', icon: ScrollText },
] as const;

const SEARCH_PROMPTS = [
  'What are you looking for?',
  'One more season?',
  'Something for movie night?',
  'That show everyone keeps mentioning?',
  'Time for a rewatch?',
  'What\u2019s next on your watchlist?',
  'Just one more episode?',
  'Looking for an old favorite?',
  'Something worth staying up for?',
  'What was that show called?',
  'A little late-night detective work?',
  'Your next rabbit hole?',
  'Ready for the next season?',
  'Got a title in mind?',
  'Time to find the good stuff?',
  'A classic or something new?',
  'What are we watching tonight?',
  'That cliffhanger won\u2019t resolve itself.',
  'Back for season two?',
  'Something for a rainy day?',
  'Let\u2019s find that release.',
  'A weekend watch, perhaps?',
  'Still thinking about that finale?',
  'The watchlist won\u2019t watch itself.',
  'Looking for the whole season?',
  'Something you missed the first time?',
  'Following a recommendation?',
  'What\u2019s the group chat watching?',
  'A comfort show kind of day?',
  'Your next \u201cjust one episode\u201d?',
  'Chasing a particular release?',
  'Somewhere, there\u2019s a season waiting.',
  'Remember that one show?',
  'Let\u2019s settle movie night.',
  'The search before the binge.',
];

function loadSavedMatchingConfig(): MatchingConfig {
  try {
    const saved = JSON.parse(preferences.getItem('xseek-match-matching') ?? 'null');
    return saved && validMatching(saved) ? saved : defaultMatching;
  } catch {
    return defaultMatching;
  }
}

function loadSavedSettingsCategory(): SettingsCategory {
  try {
    const saved = preferences.getItem('xseek-match-category');
    return SETTINGS_NAV_ITEMS.some((item) => item.key === saved)
      ? (saved as SettingsCategory)
      : 'info';
  } catch {
    return 'info';
  }
}

function loadSavedPage(): AppPage {
  try {
    const saved = preferences.getItem('xseek-match-page');
    return saved === 'settings' || saved === 'history' ? saved : 'search';
  } catch {
    return 'search';
  }
}

function loadSavedNumberList(key: string): number[] {
  try {
    const parsed = JSON.parse(preferences.getItem(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id),
        )
      : [];
  } catch {
    return [];
  }
}

function loadSavedCustomNames(): Record<string, string> {
  try {
    return JSON.parse(preferences.getItem('xseek-match-customnames') ?? '{}');
  } catch {
    return {};
  }
}

function loadSavedHistory(): SearchHistoryEntry[] {
  try {
    const saved = JSON.parse(preferences.getItem('xseek-match-history') ?? '[]');
    return Array.isArray(saved) ? saved.filter(validHistoryEntry).slice(0, 30) : [];
  } catch {
    return [];
  }
}

function loadSavedHiddenRecent(): string[] {
  try {
    const saved = JSON.parse(preferences.getItem('xseek-match-recent-hidden') || '[]');
    return Array.isArray(saved) ? saved.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setVisible(window.scrollY > 400);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  if (!visible) return null;

  return (
    <button
      className="back-to-top"
      aria-label="Back to top"
      title="Back to top"
      onClick={() =>
        window.scrollTo({
          top: 0,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        })
      }
    >
      <ArrowUp size={18} />
    </button>
  );
}

function App() {
  const [matching, setMatching] = useState<MatchingConfig>(loadSavedMatchingConfig);
  const [refreshKey, setRefreshKey] = useState(0);
  const [promptIndex, setPromptIndex] = useState(() =>
    Math.floor(Math.random() * SEARCH_PROMPTS.length),
  );
  const [settingsCategory, setSettingsCategory] =
    useState<SettingsCategory>(loadSavedSettingsCategory);
  const [page, setPage] = useState<AppPage>(loadSavedPage);
  const [excluded, setExcluded] = useState<number[]>(() =>
    loadSavedNumberList('xseek-match-excluded-trackers'),
  );
  const [important, setImportant] = useState<number[]>(() =>
    loadSavedNumberList('xseek-match-important'),
  );
  const [customNames, setCustomNames] = useState<Record<string, string>>(loadSavedCustomNames);
  const [saveError, setSaveError] = useState('');
  const [, setDefinitionsVersion] = useState(0);

  function saveMatching(config: MatchingConfig): boolean {
    try {
      preferences.setItem('xseek-match-matching', JSON.stringify(config));
      setMatching(config);
      return true;
    } catch {
      return false;
    }
  }

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: ReturnType<typeof setInterval> | undefined;

    function syncCarouselTimer() {
      if (timer) clearInterval(timer);
      if (!motion.matches) {
        timer = setInterval(() => {
          if (document.visibilityState === 'visible') {
            setPromptIndex(
              (index) =>
                (index + 1 + Math.floor(Math.random() * (SEARCH_PROMPTS.length - 1))) %
                SEARCH_PROMPTS.length,
            );
          }
        }, 20_000);
      } else {
        setPromptIndex(0);
      }
    }

    syncCarouselTimer();
    motion.addEventListener('change', syncCarouselTimer);
    return () => {
      if (timer) clearInterval(timer);
      motion.removeEventListener('change', syncCarouselTimer);
    };
  }, []);

  useEffect(() => {
    try {
      preferences.setItem('xseek-match-page', page);
      preferences.setItem('xseek-match-category', settingsCategory);
    } catch {}
  }, [page, settingsCategory]);

  useEffect(() => {
    const refreshDefinitions = () => {
      void loadTrackerDefinitions()
        .then(() => setDefinitionsVersion((version) => version + 1))
        .catch(() => {});
    };
    refreshDefinitions();
    window.addEventListener('focus', refreshDefinitions);
    const timer = window.setInterval(refreshDefinitions, 3_600_000);
    return () => {
      window.removeEventListener('focus', refreshDefinitions);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const onSaveFailed = () => setSaveError('Could not save preferences to SQLite.');
    window.addEventListener('preferences-save-error', onSaveFailed);
    return () => window.removeEventListener('preferences-save-error', onSaveFailed);
  }, []);

  function renameTracker(id: number, value: string): void {
    const next = { ...customNames };
    if (value) next[id] = value;
    else delete next[id];
    try {
      preferences.setItem('xseek-match-customnames', JSON.stringify(next));
      setCustomNames(next);
    } catch {
      setSaveError('Could not save preferences.');
    }
  }

  const shortName = (id: number, name: string): string =>
    customNames[id] || trackerAbbreviation(name) || name.replace(/\s*\(API\)/gi, '');

  function toggleImportantTracker(id: number): void {
    const next = important.includes(id)
      ? important.filter((item) => item !== id)
      : [...important, id];
    try {
      preferences.setItem('xseek-match-important', JSON.stringify(next));
      setImportant(next);
    } catch {
      setSaveError('Could not save preferences.');
    }
  }

  function toggleTracker(id: number): void {
    const next = excluded.includes(id)
      ? excluded.filter((value) => value !== id)
      : [...excluded, id];
    try {
      preferences.setItem('xseek-match-excluded-trackers', JSON.stringify(next));
      setExcluded(next);
      setSaveError('');
    } catch {
      setSaveError('Could not save settings in this browser.');
    }
  }

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [resolutions, setResolutions] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [resultIncludes, setResultIncludes] = useState<string[]>([]);
  const [resultExcludes, setResultExcludes] = useState<string[]>([]);
  const [releaseTypes, setReleaseTypes] = useState<string[]>([]);

  const searchInput = useRef<HTMLInputElement>(null);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => () => searchAbort.current?.abort(), []);

  const filterPanel = useRef<HTMLDivElement>(null);
  const filterTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!filtersOpen) return;
    function handleOutsidePointer(event: PointerEvent) {
      if (
        !filterPanel.current?.contains(event.target as Node) &&
        !filterTrigger.current?.contains(event.target as Node)
      ) {
        setFiltersOpen(false);
      }
    }
    function handleEscapeKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setFiltersOpen(false);
        filterTrigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleEscapeKey);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [filtersOpen]);

  const [history, setHistory] = useState<SearchHistoryEntry[]>(loadSavedHistory);
  const [hiddenRecent, setHiddenRecent] = useState<string[]>(loadSavedHiddenRecent);
  const recentHistory = useMemo(
    () => visibleRecentHistory(history, hiddenRecent),
    [history, hiddenRecent],
  );

  function hideRecent(keys: Set<string>): void {
    const next = [
      ...new Set([
        ...hiddenRecent,
        ...history.filter((entry) => keys.has(historyKey(entry))).map(recentHistoryKey),
      ]),
    ].slice(-100);
    setHiddenRecent(next);
    preferences.setItem('xseek-match-recent-hidden', JSON.stringify(next));
  }

  function saveHistory(next: SearchHistoryEntry[]): void {
    setHistory(next);
    try {
      preferences.setItem('xseek-match-history', JSON.stringify(next));
    } catch {}
  }

  const [query, setQuery] = useState('');
  const [lastSearch, setLastSearch] = useState<{
    term: string;
    title: string;
    hasIds: boolean;
    mode: SearchMode;
    selection?: TitleMatch;
  } | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const quiState = useQuiPresence(results, lastSearch?.term || '');
  const quiPresence = quiState.matches;
  const [quiOnly, setQuiOnly] = useState(false);
  useEffect(() => setQuiOnly(false), [results]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchNote, setSearchNote] = useState('');
  const [inferredTitle, setInferredTitle] = useState<TitleMatch | null>(null);

  useEffect(() => {
    setInferredTitle(null);
    if (
      busy ||
      results === null ||
      lastSearch?.mode !== 'text' ||
      splitTvSearch(lastSearch.term).title.length < 3
    ) {
      return;
    }

    const controller = new AbortController();
    const parsedSearch = splitTvSearch(lastSearch.term);
    const title = parsedSearch.title;
    const contentType = parsedSearch.suffix ? 'tv' : 'all';

    void (async () => {
      try {
        const response = await authFetch('/api/match/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'lookup', title, contentType }),
          signal: controller.signal,
        });
        if (!response.ok || controller.signal.aborted) return;

        const data = await response.json();
        const matches: TitleMatch[] = data?.matches || [];
        const tvMatch = inferTvTitle<TitleMatch>(matches, lastSearch.term);
        const exactMatches = matches.filter(
          (row) => row.title.toLowerCase() === title.toLowerCase(),
        );
        const resolved = exactMatches.length === 1 ? exactMatches[0] : tvMatch;
        if (resolved) setInferredTitle(resolved);
      } catch {}
    })();

    return () => controller.abort();
  }, [busy, results, lastSearch]);

  const [mode, setMode] = useState('groups');
  const [availability, setAvailability] = useState<TrackerAvailability>({
    message: 'Checking trackers…',
    trackers: [],
  });

  useEffect(() => {
    const controller = new AbortController();
    async function refreshTrackers() {
      try {
        const response = await authFetch(`/api/match/indexers${refreshKey ? '?refresh=1' : ''}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Indexer fetch failed');
        setAvailability(await response.json());
      } catch {
        if (!controller.signal.aborted) {
          setAvailability({ message: 'Tracker status unavailable', trackers: [] });
        }
      }
    }
    void refreshTrackers();
    return () => controller.abort();
  }, [refreshKey]);

  const previousSearchTop = useRef<number | null>(null);
  const layoutAnimation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    layoutAnimation.current?.cancel();
    if (page !== 'search') {
      previousSearchTop.current = null;
      return;
    }
    const form = searchInput.current?.closest('form');
    const main = form?.closest('main');
    if (!form || !main) {
      previousSearchTop.current = null;
      return;
    }
    const top = form.getBoundingClientRect().top;
    const previous = previousSearchTop.current;
    previousSearchTop.current = top;

    if (
      previous !== null &&
      Math.abs(previous - top) > 1 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      layoutAnimation.current = main.animate(
        [{ transform: `translateY(${previous - top}px)` }, { transform: 'translateY(0)' }],
        { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
    }
    return () => {
      layoutAnimation.current?.cancel();
    };
  }, [busy, results, page]);

  const allowedResults = useMemo(
    () => (results ?? []).filter((row) => !excluded.includes(row.indexerId)),
    [results, excluded],
  );
  const parsedResults = useMemo(
    () => allowedResults.map((row) => ({ row, parsed: parseReleaseName(row.title) })),
    [allowedResults],
  );
  const parsedResolutions = useMemo(
    () =>
      parsedResults
        .map((item) => item.parsed.resolution)
        .filter((value): value is string => Boolean(value)),
    [parsedResults],
  );
  const sourceOptions = useMemo(
    () =>
      [
        ...new Set(
          parsedResults
            .map((item) => item.parsed.source)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
    [parsedResults],
  );

  const filterSelection = useMemo(
    () => ({ resolutions, sources, releaseTypes, resultIncludes, resultExcludes }),
    [resolutions, sources, releaseTypes, resultIncludes, resultExcludes],
  );
  const appliedFilters = useDeferredValue(filterSelection);

  const parsedByRow = useMemo(
    () => new Map(parsedResults.map(({ row, parsed }) => [row, parsed])),
    [parsedResults],
  );

  const visibleResults = useMemo(
    () =>
      parsedResults
        .filter(({ row, parsed }) => matchesSearchResultFilters(row, parsed, appliedFilters))
        .map((item) => item.row)
        .filter((row) => !quiOnly || hasQuiMatch(quiPresence[quiResultKey(row)], mode === 'all')),
    [parsedResults, appliedFilters, quiOnly, quiPresence, mode],
  );

  const activeFilters =
    resolutions.length +
    sources.length +
    releaseTypes.length +
    resultIncludes.length +
    resultExcludes.length;

  const groups = useMemo(
    () => groupResults(visibleResults, matching, parsedByRow),
    [visibleResults, matching, parsedByRow],
  );

  const includedTrackers = useMemo(
    () => availability.trackers.filter((tracker) => !excluded.includes(tracker.id)),
    [availability.trackers, excluded],
  );

  async function search(
    event?: FormEvent,
    previous?: string,
    selection?: TitleMatch,
    searchMode: SearchMode = selection ? 'enriched' : 'text',
    refresh = false,
  ): Promise<void> {
    event?.preventDefault();
    const term = (previous ?? query).trim();
    if (!term || busy) return;

    setPage('search');
    setQuery(term);
    setLastSearch({
      term,
      title: selection?.title || lookupTerm(term),
      hasIds: searchMode === 'enriched' && Boolean(selection),
      mode: searchMode,
      selection,
    });

    const entry: SearchHistoryEntry = {
      query: term,
      at: Date.now(),
      mode: searchMode,
      ...(selection
        ? {
            selection: {
              key: selection.key,
              title: selection.title,
              kind: selection.kind as 'sonarr' | 'radarr',
              id: selection.id,
              imdb: selection.imdb,
              year: selection.year,
              seasons: selection.seasons,
              numbering: selection.numbering,
              resolvedBy: selection.resolvedBy,
            },
          }
        : {}),
    };
    saveHistory(
      [entry, ...history.filter((item) => historyKey(item) !== historyKey(entry))].slice(0, 30),
    );

    const controller = new AbortController();
    searchAbort.current = controller;
    setBusy(true);
    setSearchNote('');
    setError('');
    setResults(null);

    try {
      const idParams =
        searchMode === 'enriched' && selection
          ? `&kind=${selection.kind}&id=${selection.id}&numbering=${selection.numbering || 'tvdb'}${selection.imdb ? `&imdb=${encodeURIComponent(selection.imdb)}` : ''}`
          : '';
      const response = await authFetch(
        `/api/match/search?q=${encodeURIComponent(term)}&exclude=${excluded.join(',')}${idParams}${refresh ? '&refresh=1' : ''}`,
        { signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Search failed');
      if (!controller.signal.aborted) {
        setResults(decodeResults(data.results));
        setSearchNote(data.cacheWarning || '');
      }
    } catch (searchErr) {
      if (!controller.signal.aborted) {
        setError(searchErr instanceof Error ? searchErr.message : 'Search failed');
      }
    } finally {
      if (searchAbort.current === controller) {
        setBusy(false);
        searchAbort.current = null;
      }
    }
  }

  function reset(): void {
    searchAbort.current?.abort();
    searchAbort.current = null;
    setBusy(false);
    setPage('search');
    setResults(null);
    setQuery('');
    setError('');
    setLastSearch(null);
  }

  function renderSettingsContent() {
    if (settingsCategory === 'statistics') {
      const icons = Object.fromEntries(
        availability.trackers.map((tracker) => [
          String(tracker.id),
          tracker.icon || `/api/match/favicon?id=${tracker.id}`,
        ]),
      );
      const abbreviations = Object.fromEntries(
        availability.trackers.map((tracker) => [
          String(tracker.id),
          trackerAbbreviation(tracker.name) ||
            trackerAbbreviation(customNames[tracker.id] || '') ||
            '·',
        ]),
      );
      return <StatisticsPanel icons={icons} abbreviations={abbreviations} />;
    }
    if (settingsCategory === 'integrations') return <IntegrationsPanel />;
    if (settingsCategory === 'account') return <AccountPanel />;
    if (settingsCategory === 'tasks') {
      return <TasksPanel onSync={() => setRefreshKey((key) => key + 1)} />;
    }
    if (settingsCategory === 'info') return <InfoPanel />;
    if (settingsCategory === 'appearance') return <AppearancePanel />;
    if (settingsCategory === 'matching') {
      return <MatchingSettings config={matching} onSave={saveMatching} />;
    }
    if (settingsCategory === 'cache' || settingsCategory === 'logs') {
      return <ActivityPanel key={settingsCategory} kind={settingsCategory} />;
    }

    return (
      <IndexersPanel
        availability={availability}
        includedCount={includedTrackers.length}
        excluded={excluded}
        important={important}
        customNames={customNames}
        saveError={saveError}
        onRefresh={() => setRefreshKey((key) => key + 1)}
        onRenameTracker={renameTracker}
        onToggleImportant={toggleImportantTracker}
        onToggleTracker={toggleTracker}
      />
    );
  }

  return (
    <div className="match-app">
      <SaveStatus />
      <BackToTop />

      {page === 'search' && (
        <div
          className="search-ambient-droplets"
          data-quiet={busy || results !== null}
          aria-hidden="true"
        >
          <i />
          <i />
          <i />
        </div>
      )}

      <aside className="match-rail">
        <button onClick={reset} aria-label="New search" className="match-mark">
          x<span>m</span>
        </button>
        <button
          className={page === 'search' ? 'rail-active' : ''}
          aria-label="Search page"
          onClick={() => setPage('search')}
        >
          <Search size={19} />
        </button>
        <button
          className={page === 'history' ? 'rail-active' : ''}
          aria-label="History"
          title="History"
          onClick={() => setPage('history')}
        >
          <History size={19} />
        </button>
        <button
          className={`settings-nav ${page === 'settings' ? 'rail-active' : ''}`}
          aria-label="Settings"
          onClick={() => setPage('settings')}
        >
          <Settings size={19} />
        </button>
      </aside>

      {page !== 'search' && (
        <header className="match-header">
          <nav aria-label="App navigation" className="app-heading">
            <button className="match-wordmark" onClick={reset}>
              <span className="brand-xseek">xseek</span> <span className="brand-match">match</span>
            </button>
            <span className="header-divider" aria-hidden="true" />
            <span className="breadcrumb-page">{page === 'settings' ? 'Settings' : 'History'}</span>
          </nav>
        </header>
      )}

      {page === 'history' ? (
        <main key="history" className="match-main has-results match-history-page page-enter">
          <h1>History</h1>
          <SearchJourneys
            detailed
            history={history}
            onRun={(entry) =>
              void search(undefined, entry.query, entry.selection, entry.mode || 'text')
            }
            onRemove={(keys) =>
              saveHistory(history.filter((entry) => !keys.has(historyKey(entry))))
            }
            onClear={() => saveHistory([])}
          />
          {history.length === 0 && <p className="match-note">No searches yet.</p>}
        </main>
      ) : page === 'settings' ? (
        <main key="settings" className="match-main has-results match-settings page-enter">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <div className="settings-layout">
            <nav className="settings-categories" aria-label="Settings categories">
              {SETTINGS_NAV_ITEMS.map((item) => (
                <button
                  key={item.key}
                  aria-current={settingsCategory === item.key ? 'page' : undefined}
                  onClick={() => setSettingsCategory(item.key)}
                >
                  <item.icon size={16} />
                  {item.label}
                </button>
              ))}
            </nav>
            <div key={settingsCategory} className="settings-content page-enter">
              {renderSettingsContent()}
            </div>
          </div>
        </main>
      ) : (
        <main
          key="search"
          className={
            busy || results !== null ? 'match-main has-results page-enter' : 'match-main page-enter'
          }
        >
          <section className="match-hero">
            <h1 className="search-headline">
              <span className="sr-only">What are you looking for?</span>
              <span className="headline-carousel" aria-hidden="true">
                <span key={promptIndex}>{SEARCH_PROMPTS[promptIndex]}</span>
              </span>
            </h1>
          </section>

          <SearchBar
            status={
              important.length > 0 &&
              (busy || results !== null) && (
                <div className="important-indexers">
                  {availability.trackers
                    .filter((tracker) => important.includes(tracker.id))
                    .map((tracker) => (
                      <span
                        key={tracker.id}
                        title={
                          excluded.includes(tracker.id)
                            ? `${tracker.name} · disabled`
                            : `${tracker.name} · important`
                        }
                      >
                        <IndexerIcon src={tracker.icon} />
                        {shortName(tracker.id, tracker.name)}
                        {excluded.includes(tracker.id) && ' · off'}
                      </span>
                    ))}
                </div>
              )
            }
            actions={(selected) => (
              <div className="search-actions">
                {!busy &&
                  results !== null &&
                  inferredTitle &&
                  lastSearch?.mode === 'text' &&
                  query === lastSearch.term && (
                    <Button
                      className="enrich-action"
                      variant="ghost"
                      size="sm"
                      title={`Search with ${inferredTitle.title}`}
                      onClick={() =>
                        void search(
                          undefined,
                          `${inferredTitle.title} ${splitTvSearch(lastSearch.term).suffix}`.trim(),
                          inferredTitle,
                          'enriched',
                        )
                      }
                    >
                      <Sparkles size={14} /> Enrich
                    </Button>
                  )}
                {!busy &&
                  results !== null &&
                  lastSearch?.mode === 'deep' &&
                  lastSearch.selection && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Return to enriched search"
                      onClick={() =>
                        void search(undefined, lastSearch.term, lastSearch.selection, 'enriched')
                      }
                    >
                      <ArrowLeft size={14} /> Enriched
                    </Button>
                  )}
                {!busy &&
                  selected &&
                  !(lastSearch?.mode === 'deep' && lastSearch.selection?.key === selected.key) && (
                    <button
                      type="button"
                      className="dig-deeper-action"
                      title="Broaden your search"
                      onClick={() => void search(undefined, query, selected, 'deep')}
                    >
                      <Sparkles size={14} strokeWidth={2.2} />
                      <span>Dig Deeper</span>
                    </button>
                  )}
                {includedTrackers.some((tracker) => !tracker.available) && (
                  <span
                    className="tracker-warning"
                    role="status"
                    title={includedTrackers
                      .filter((tracker) => !tracker.available)
                      .map((tracker) => customNames[tracker.id] || tracker.name)
                      .join(', ')}
                  >
                    <span className="status-dot" />
                    {includedTrackers.filter((tracker) => !tracker.available).length} unavailable
                  </span>
                )}
                <Button
                  ref={filterTrigger}
                  variant={activeFilters ? 'brand' : 'ghost'}
                  size="sm"
                  aria-expanded={filtersOpen}
                  aria-controls="search-filters"
                  onClick={() => setFiltersOpen((open) => !open)}
                >
                  <SlidersHorizontal size={14} /> Filters
                  {activeFilters > 0 && <span>{activeFilters}</span>}
                </Button>
              </div>
            )}
            searchMode={lastSearch?.mode}
            restoredSelection={lastSearch?.selection}
            query={query}
            onQuery={setQuery}
            busy={busy}
            hasResults={results !== null}
            onSearch={(event, selection, term, refresh) =>
              void search(
                event,
                term,
                selection ?? undefined,
                selection ? 'enriched' : 'text',
                refresh,
              )
            }
            onClear={reset}
            inputRef={searchInput}
          />

          <div className="filter-anchor">
            {filtersOpen && (
              <SearchFilterPopover
                panelRef={filterPanel}
                excludedTrackerCount={availability.trackers.length - includedTrackers.length}
                parsedResolutions={parsedResolutions}
                sourceOptions={sourceOptions}
                resolutions={resolutions}
                setResolutions={setResolutions}
                sources={sources}
                setSources={setSources}
                releaseTypes={releaseTypes}
                setReleaseTypes={setReleaseTypes}
                resultIncludes={resultIncludes}
                setResultIncludes={setResultIncludes}
                resultExcludes={resultExcludes}
                setResultExcludes={setResultExcludes}
                activeFilterCount={activeFilters}
                onClose={() => {
                  setFiltersOpen(false);
                  filterTrigger.current?.focus();
                }}
                onReset={() => {
                  setResolutions([]);
                  setSources([]);
                  setReleaseTypes([]);
                  setResultIncludes([]);
                  setResultExcludes([]);
                }}
              />
            )}
          </div>

          {!busy && results === null && recentHistory.length > 0 && (
            <SearchJourneys
              onHistory={() => setPage('history')}
              history={recentHistory}
              onRun={(entry) =>
                void search(undefined, entry.query, entry.selection, entry.mode || 'text')
              }
              onRemove={hideRecent}
              onClear={() => hideRecent(new Set(recentHistory.map(historyKey)))}
            />
          )}

          {busy && <SearchLoadingSkeleton />}

          {error && (
            <div role="alert" className="match-error">
              {error}
            </div>
          )}

          {results !== null && searchNote && (
            <p className="match-note" role="status">
              {searchNote}
            </p>
          )}

          <ResultsView
            results={results}
            visibleResults={visibleResults}
            groups={groups}
            mode={mode}
            setMode={setMode}
            availability={availability}
            important={important}
            excluded={excluded}
            shortName={shortName}
            customNames={customNames}
            quiPresence={quiPresence}
            quiState={quiState}
            quiOnly={quiOnly}
            onToggleQui={() => setQuiOnly((value) => !value)}
            allowedResults={allowedResults}
            matching={matching}
            lastSearch={lastSearch}
          />
        </main>
      )}
    </div>
  );
}

export default App;
