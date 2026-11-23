import { Award, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { isFreeleech, type Result } from '../../../domain/matching/group';
import { accountProblem, grabImpact, type TrackerAccount } from '../../../tracker-accounts';
import { authFetch } from '../auth/auth-client';

export type TrackerAccounts = Record<number, TrackerAccount>;

/** Account standing per indexer id. Empty when no Yata connection is enabled. */
export function useTrackerAccounts(refreshKey: number): TrackerAccounts {
  const [accounts, setAccounts] = useState<TrackerAccounts>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('integrations-changed', update);
    return () => window.removeEventListener('integrations-changed', update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const listed = await authFetch('/api/match/integrations', { signal: controller.signal });
        if (!listed.ok) throw Error();
        if (!(await listed.json()).capabilities?.includes('tracker-accounts')) {
          setAccounts({});
          return;
        }
        const response = await authFetch('/api/match/integrations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'accounts' }),
          signal: controller.signal,
        });
        if (!response.ok) throw Error();
        const data = (await response.json()) as { accounts: TrackerAccount[] };
        setAccounts(Object.fromEntries(data.accounts.map((row) => [row.indexerId, row])));
      } catch {
        if (!controller.signal.aborted) setAccounts({});
      }
    })();
    return () => controller.abort();
  }, [refreshKey, revision]);

  return accounts;
}

function formatGib(value: number): string {
  const sign = value < 0 ? '-' : '';
  const size = Math.abs(value);
  return size >= 1024 ? `${sign}${(size / 1024).toFixed(2)} TiB` : `${sign}${size.toFixed(1)} GiB`;
}

function formatRatio(value: number | undefined): string {
  return value === undefined ? '?' : value.toFixed(2);
}

function updatedNote(account: TrackerAccount): string {
  return account.updatedAt
    ? `Yata · updated ${new Date(account.updatedAt * 1000).toLocaleString()}`
    : 'Yata · no stats yet';
}

/** Ratio and buffer under the tracker name, or why Yata has no fresh numbers. */
export function AccountLine({ account }: { account?: TrackerAccount }) {
  if (!account) return null;
  const problem = accountProblem(account);
  if (problem) {
    return (
      <span className="account-line is-problem" title={`${problem} · ${updatedNote(account)}`}>
        {problem}
      </span>
    );
  }

  const details = [
    account.group,
    account.seeding !== undefined && `${account.seeding} seeding`,
    account.hitAndRuns && `${account.hitAndRuns} hit and runs`,
    account.warnings && `${account.warnings} warnings`,
    account.target && `${account.target.met} of ${account.target.total} promotion requirements met`,
    updatedNote(account),
  ].filter(Boolean);

  return (
    <span
      className={`account-line ${account.hitAndRuns || account.warnings ? 'is-warning' : ''}`}
      title={details.join('\n')}
    >
      {formatRatio(account.ratio)}
      {account.bufferGib !== undefined && ` · ${formatGib(account.bufferGib)}`}
    </span>
  );
}

/** Warns when a non-freeleech grab would take more than the remaining buffer. */
export function GrabImpactWarning({ row, account }: { row: Result; account?: TrackerAccount }) {
  const impact = account && grabImpact(account, row.size, isFreeleech(row));
  if (!impact?.overBuffer) return null;
  const ratio =
    impact.ratioAfter !== undefined
      ? ` Ratio ${formatRatio(impact.ratioBefore)} → ${formatRatio(impact.ratioAfter)}.`
      : '';
  const label = `Over buffer by ${formatGib(-impact.bufferAfterGib!)}.${ratio}`;
  return (
    <span className="grab-impact" role="img" aria-label={label} title={label}>
      <TriangleAlert size={13} />
    </span>
  );
}

export function GrabSuggestion({ reasons }: { reasons: { text: string }[] }) {
  const label = `Suggested grab · ${reasons.map((reason) => reason.text).join(' · ')}`;
  return (
    <span className="grab-suggestion" role="img" aria-label={label} title={label}>
      <Award size={13} />
    </span>
  );
}
