/** Account standing on one tracker, as reported by Yata and joined to a Prowlarr indexer. */
export type TrackerAccount = {
  indexerId: number;
  connection: string;
  name: string;
  abbr?: string;
  status: 'ok' | 'error' | 'disabled' | 'opted_out' | 'retired' | 'unknown';
  errorKind?: string;
  group?: string;
  ratio?: number;
  uploadedGib?: number;
  downloadedGib?: number;
  bufferGib?: number;
  seeding?: number;
  bonusPoints?: number;
  hitAndRuns?: number;
  warnings?: number;
  updatedAt: number;
  target?: { met: number; total: number; remaining: number };
};

import { isFreeleech, type Result } from './domain/matching/group.js';

const GIB = 1024 ** 3;

/** Hostname without `www.`, a trailing dot or case, for joining Yata trackers to indexers. */
export function trackerHost(value: string): string | null {
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\.$/, '');
  } catch {
    return null;
  }
}

type GrabImpact = {
  sizeGib: number;
  bufferAfterGib?: number;
  ratioBefore?: number;
  ratioAfter?: number;
  overBuffer: boolean;
};

/** What downloading `sizeBytes` does to this account. Freeleech grabs cost nothing. */
export function grabImpact(
  account: TrackerAccount,
  sizeBytes: number,
  freeleech: boolean,
): GrabImpact | null {
  if (freeleech || !(sizeBytes > 0)) return null;
  const sizeGib = sizeBytes / GIB;
  const bufferAfterGib = account.bufferGib === undefined ? undefined : account.bufferGib - sizeGib;
  const canRate = account.uploadedGib !== undefined && account.downloadedGib !== undefined;
  return {
    sizeGib,
    bufferAfterGib,
    ratioBefore: account.ratio,
    ratioAfter: canRate ? account.uploadedGib! / (account.downloadedGib! + sizeGib) : undefined,
    overBuffer: bufferAfterGib !== undefined && bufferAfterGib < 0,
  };
}

type GrabReason = { score: number; text: string };

/**
 * Reasons to prefer or avoid grabbing a release from this tracker. The score orders rows
 * inside a release group; it never hides one.
 */
export function grabReasons(
  account: TrackerAccount | undefined,
  sizeBytes: number,
  freeleech: boolean,
): GrabReason[] {
  if (!account) return [];
  const reasons: GrabReason[] = [];
  if (freeleech) reasons.push({ score: 2, text: 'Freeleech here' });
  if (account.target && account.target.remaining > 0) {
    reasons.push({
      score: 1,
      text: `${account.target.remaining} of ${account.target.total} promotion requirements left`,
    });
  }
  if (grabImpact(account, sizeBytes, freeleech)?.overBuffer) {
    reasons.push({ score: -3, text: 'Uses more than your buffer' });
  }
  if (account.hitAndRuns) {
    reasons.push({ score: -1, text: `${account.hitAndRuns} hit and runs` });
  }
  if (account.status === 'error') {
    reasons.push({ score: -1, text: 'Yata could not refresh this account' });
  }
  return reasons;
}

export function grabScore(reasons: GrabReason[]): number {
  return reasons.reduce((total, reason) => total + reason.score, 0);
}

/** The row to suggest in a release group, only when one row scores strictly higher than the rest. */
export function suggestedGrab<T extends Result>(
  rows: T[],
  accounts: Record<number, TrackerAccount>,
): { row: T; reasons: GrabReason[]; score: number } | null {
  if (new Set(rows.map((row) => row.indexerId)).size < 2) return null;
  const [best, next] = rows
    .map((row) => {
      const reasons = grabReasons(accounts[row.indexerId], row.size, isFreeleech(row));
      return { row, reasons, score: grabScore(reasons) };
    })
    .sort((left, right) => right.score - left.score);
  if (!best || best.score <= 0 || (next && next.score === best.score)) return null;
  return best;
}

/** Short description of a Yata refresh failure, e.g. `http_401` becomes "API returned 401". */
export function accountProblem(account: TrackerAccount): string | null {
  if (account.status !== 'error') return null;
  const status = account.errorKind?.match(/^http_(\d{3})$/)?.[1];
  if (status) return `API returned ${status}`;
  if (account.errorKind === 'timeout') return 'API timed out';
  if (account.errorKind === 'connection_error') return 'API unreachable';
  if (account.errorKind === 'no_key') return 'No API key in Yata';
  return 'Refresh failed';
}
