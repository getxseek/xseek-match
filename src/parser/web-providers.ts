/**
 * Streaming / web-origin provider detection — derived from detect-core v4 (detect-core:9bd5477).
 */
import { WEB_PROVIDERS } from './web-providers-list.js';

/** How a web-sourced release was delivered (WEB-DL vs group re-encode). */
export type WebDelivery = 'web-dl' | 'webrip' | 'web-encode';

/** Scene-boundary matching only — skip space-adjacent WEB parse (e.g. NOW, AS, iT). */
const SPACE_WEB_CAUTIOUS_MAX_LEN = 3;

/** Group re-encode pattern: `.WEB.H265`, `.WEB.h264`, etc. (not WEB-DL). */
function nameLooksWebEncode(nameOrLower: string): boolean {
  const lower = nameOrLower.toLowerCase();
  return /\bweb[-.](?:h\.?264|h\.?265|x264|x265|hevc|avc|av1)\b/.test(lower);
}

export function extractWebDelivery(lower: string): WebDelivery | null {
  if (/\bweb[-.]?dl\b/.test(lower)) return 'web-dl';
  if (/\bwebrip\b/.test(lower)) return 'webrip';
  if (nameLooksWebEncode(lower)) return 'web-encode';
  return null;
}

/** True when release name indicates remux (provider tags ignored). */
function nameLooksRemux(lower: string): boolean {
  return /\bremux\b/.test(lower);
}

/** Whether web-provider parsing should run for this release. */
function shouldParseWebProvider(lower: string, sourceType: string | null): boolean {
  if (nameLooksRemux(lower)) return false;
  const src = sourceType?.toUpperCase() ?? null;
  if (src === 'HDTV') return false;
  if (src === 'BLURAY' || src === 'BDRIP' || src === 'DVDRIP') return false;
  if (/\bbluray\b/.test(lower) && !/\bweb/i.test(lower)) return false;
  if (/\bhdtv\b/.test(lower)) return false;
  return true;
}

const WEB_TAG = 'web[-.]?dl|webrip|web[-.](?:h\\.?264|h\\.?265|x264|x265|hevc|avc|av1)';
const WEB_TAG_RE = new RegExp(`\\b(?:${WEB_TAG})\\b`, 'i');

const COMPILED_PROVIDERS = WEB_PROVIDERS.map((provider) => {
  const esc = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cautious = provider.length <= SPACE_WEB_CAUTIOUS_MAX_LEN;
  const spaceWeb = new RegExp(
    `(?:\\b${esc}\\b\\s+(?:${WEB_TAG})|(?:${WEB_TAG})\\b\\s+${esc}\\b)`,
    'i',
  );
  const capitalised =
    provider.length >= 2 && provider === provider.toUpperCase()
      ? new RegExp(`(?:\\b${esc}\\s+[Ww][Ee][Bb]|[Ww][Ee][Bb]\\S*\\s+${esc}\\b)`)
      : null;
  return {
    provider,
    cautious,
    token: new RegExp(`(?:^|[._-])${esc}(?:[._-]|$)`, 'i'),
    spaceWeb,
    capitalised,
  };
});

/**
 * Extract allowlisted web provider from a release name.
 * Returns null for BluRay/HDTV/Remux or when no known token is present.
 * Tokens are checked longest-first (from master list).
 */
export function extractWebProvider(name: string, sourceType: string | null): string | null {
  const lower = name.toLowerCase();
  if (!shouldParseWebProvider(lower, sourceType)) return null;

  for (const entry of COMPILED_PROVIDERS) {
    if (entry.token.test(name)) return entry.provider;
  }
  if (WEB_TAG_RE.test(name)) {
    for (const entry of COMPILED_PROVIDERS) {
      if (entry.cautious) {
        if (entry.capitalised && entry.spaceWeb.test(name) && entry.capitalised.test(name)) {
          return entry.provider;
        }
        continue;
      }
      if (entry.spaceWeb.test(name)) return entry.provider;
    }
  }
  return null;
}
