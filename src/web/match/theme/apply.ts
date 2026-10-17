import { themeRoles } from './presets';
import type { ThemeTokens } from './resolve';

// Writes only allowlisted role properties to the document root so portals, tooltips and the auth
// screens inherit them. Every role is rewritten on each apply, so nothing leaks between presets.
export function applyTokens(tokens: ThemeTokens, root = document.documentElement) {
  for (const role of themeRoles) root.style.setProperty(`--${role}`, tokens[role]);
  root.style.colorScheme = 'dark';
}
