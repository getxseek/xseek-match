import { execFileSync } from 'node:child_process';
import { XSEEK_VERSION } from '../../version.js';

export interface GitStatus {
  commit: string;
  modified: boolean;
}

export function readGitStatus(): GitStatus {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const modified = Boolean(
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
    return { commit, modified };
  } catch {
    return { commit: 'Unavailable', modified: false };
  }
}

export interface SystemInfoParams {
  git: GitStatus;
  startedAt: number;
  production: boolean;
  prowlarrBaseUrl?: string;
  prowlarrApiKey?: string;
  indexerCacheHours: number;
  indexerCachedAt: number | null;
  indexerCount: number | null;
}

export function buildSystemInfo(params: SystemInfoParams) {
  let prowlarrHost: string | null = null;
  try {
    if (params.prowlarrBaseUrl) {
      prowlarrHost = new URL(params.prowlarrBaseUrl).host;
    }
  } catch {}

  return {
    version: XSEEK_VERSION,
    commit: params.git.commit,
    modified: params.git.modified,
    mode: params.production ? 'Production' : 'Development preview',
    startedAt: params.startedAt,
    uptimeSeconds: Math.floor((Date.now() - params.startedAt) / 1000),
    runtime: process.version,
    platform: `${process.platform}/${process.arch}`,
    prowlarrConfigured: Boolean(params.prowlarrBaseUrl && params.prowlarrApiKey),
    prowlarrHost,
    indexerCacheHours: params.indexerCacheHours,
    indexerCachedAt: params.indexerCachedAt,
    indexerCount: params.indexerCount,
    preferences: 'SQLite · .local/match.sqlite',
    cacheLocation: '.local/match-cache',
    authentication: 'Owner login · server-side sessions',
  };
}
