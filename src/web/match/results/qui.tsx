import { quiResultKey, preferredQuiMatches, hasQuiMatch } from '../../../qui-result';
import { useEffect, useState } from 'react';
import { authFetch } from '../auth/auth-client';
import type { Result } from '../../../domain/matching/group';
export type Presence = {
  resultKey?: string;
  evidence?: 'entry' | 'release';
  hash: string;
  connection: string;
  client: string;
  state: string;
  url: string;
};
export type PresenceState = {
  matches: Record<string, Presence[]>;
  status: 'idle' | 'checking' | 'done' | 'failed';
  hashes: number;
  checked: number;
  failed: number;
};
/** Presence answers reused for a minute so switching between related searches does not flicker. */
const PRESENCE_TTL_MS = 60_000;
const MAX_CACHED_RELEASES = 2_000;
const presenceCache = new Map<string, { at: number; matches: Presence[] }>();
let presenceCapability: { at: number; enabled: boolean } | undefined;

function presenceKey(title: string, releaseKey: string): string {
  return JSON.stringify([title, releaseKey]);
}

function cachedPresence(title: string, releaseKey: string): Presence[] | undefined {
  const entry = presenceCache.get(presenceKey(title, releaseKey));
  return entry && Date.now() - entry.at < PRESENCE_TTL_MS ? entry.matches : undefined;
}

function rememberPresence(title: string, releaseKey: string, matches: Presence[]): void {
  const key = presenceKey(title, releaseKey);
  presenceCache.delete(key);
  if (presenceCache.size >= MAX_CACHED_RELEASES) {
    presenceCache.delete(presenceCache.keys().next().value!);
  }
  presenceCache.set(key, { at: Date.now(), matches });
}

async function presenceEnabled(signal: AbortSignal): Promise<boolean> {
  if (presenceCapability && Date.now() - presenceCapability.at < PRESENCE_TTL_MS) {
    return presenceCapability.enabled;
  }
  const response = await authFetch('/api/match/integrations', { signal });
  if (!response.ok) return false;
  const connections = await response.json();
  const enabled = Boolean(connections.capabilities?.includes('torrent-presence'));
  presenceCapability = { at: Date.now(), enabled };
  return enabled;
}

export function useQuiPresence(results: Result[] | null, title: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => {
      presenceCache.clear();
      presenceCapability = undefined;
      setRevision((value) => value + 1);
    };
    window.addEventListener('integrations-changed', update);
    return () => window.removeEventListener('integrations-changed', update);
  }, []);
  const [state, setState] = useState<PresenceState>({
    matches: {},
    status: 'idle',
    hashes: 0,
    checked: 0,
    failed: 0,
  });
  useEffect(() => {
    const idle: PresenceState = { matches: {}, status: 'idle', hashes: 0, checked: 0, failed: 0 };
    if (!results?.length) {
      setState(idle);
      return;
    }
    const releases = results.slice(0, 500).map((row) => ({
      key: quiResultKey(row),
      title: row.title.slice(0, 1000),
      size: row.size,
      sourceUrl: row.infoUrl,
      hash:
        row.infoHash && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(row.infoHash)
          ? row.infoHash
          : undefined,
    }));
    const searchTitle = title.slice(0, 200);
    const cachedMatches: Record<string, Presence[]> = {};
    const unchecked = releases.filter((release) => {
      const cached = cachedPresence(searchTitle, release.key);
      if (cached === undefined) return true;
      if (cached.length) cachedMatches[release.key] = cached;
      return false;
    });
    const skipped = Math.max(0, results.length - releases.length);
    const startState: PresenceState = {
      matches: cachedMatches,
      status: unchecked.length ? 'checking' : 'done',
      hashes: releases.length,
      checked: releases.length - unchecked.length,
      failed: skipped,
    };
    // With the capability already known, show cached answers in the same render: no flicker.
    const capabilityKnown =
      presenceCapability && Date.now() - presenceCapability.at < PRESENCE_TTL_MS;
    setState(capabilityKnown && presenceCapability!.enabled ? startState : idle);
    const controller = new AbortController();
    void (async () => {
      try {
        if (!(await presenceEnabled(controller.signal)) || controller.signal.aborted) return;
        if (!capabilityKnown) setState(startState);
        for (let i = 0; i < unchecked.length; i += 20) {
          const batch = unchecked.slice(i, i + 20);
          const response = await authFetch('/api/match/integrations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'release-presence',
              title: searchTitle,
              releases: batch,
            }),
            signal: controller.signal,
          });
          if (!response.ok) throw Error();
          const data = await response.json();
          if (controller.signal.aborted) return;
          const found = data.matches as Presence[];
          if (!data.failed && !data.truncated) {
            for (const release of batch) {
              rememberPresence(
                searchTitle,
                release.key,
                found.filter((match) => match.resultKey === release.key),
              );
            }
          }
          setState((old) => {
            const matches = { ...old.matches };
            for (const match of found) {
              if (!match.resultKey) continue;
              matches[match.resultKey] = [...(matches[match.resultKey] || []), match];
            }
            return {
              ...old,
              matches,
              checked: old.checked + batch.length,
              failed: old.failed + (data.failed || 0) + (data.truncated ? 1 : 0),
              status: i + batch.length >= unchecked.length ? 'done' : 'checking',
            };
          });
        }
      } catch {
        if (!controller.signal.aborted) setState((old) => ({ ...old, status: 'failed' }));
      }
    })();
    return () => controller.abort();
  }, [results, revision, title]);
  return state;
}
export function QuiSearchStatus({
  state,
  only,
  onToggle,
  trackerOnly = false,
}: {
  state: PresenceState;
  only: boolean;
  onToggle: () => void;
  trackerOnly?: boolean;
}) {
  if (state.status === 'idle') return null;
  const count = Object.values(state.matches).filter((matches) =>
    hasQuiMatch(matches, trackerOnly),
  ).length;
  return (
    <div className="qui-search-status">
      {state.status === 'checking' && <span role="status">Checking torrents…</span>}
      {state.status !== 'checking' && count === 0 && !only && (
        <img
          className="qui-empty"
          src="/icons/qui.svg"
          alt="No matches found"
          title="No matches found"
        />
      )}
      {(count > 0 || only) && (
        <button
          type="button"
          aria-label={`In qui: ${count}`}
          aria-pressed={only}
          onClick={onToggle}
        >
          <img src="/icons/qui.svg" alt="" aria-hidden="true" />
          {count}
        </button>
      )}
    </div>
  );
}
export function QuiTorrentContext({
  rows,
  matches,
  trackerOnly = false,
}: {
  rows: Result[];
  matches: Record<string, Presence[]>;
  trackerOnly?: boolean;
}) {
  const clients = new Map<string, Presence>();
  for (const match of rows.flatMap((row) =>
    preferredQuiMatches(matches[quiResultKey(row)] || []).filter(
      (match) => !trackerOnly || match.evidence === 'entry',
    ),
  )) {
    const key = match.url.split('?')[0]!;
    const old = clients.get(key);
    if (!old || (match.evidence === 'entry' && old.evidence !== 'entry')) clients.set(key, match);
  }
  const found = [...clients.values()].sort(
    (a, b) => Number(b.evidence === 'entry') - Number(a.evidence === 'entry'),
  );
  if (!found.length) return null;
  const match = found[0]!,
    label = match.evidence === 'entry' ? 'Tracker entry in qui' : 'Same release in qui';
  return (
    <span className="qui-torrent-context">
      <a
        className={`qui-presence-icon is-${match.evidence === 'entry' ? 'entry' : 'release'}`}
        href={match.url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        aria-label={label}
        title={found
          .map(
            (item) =>
              `${item.state.charAt(0).toUpperCase() + item.state.slice(1)} in ${item.client}`,
          )
          .join('\n')}
      >
        <span className="qui-presence-symbol" aria-hidden="true" />
      </a>
    </span>
  );
}
