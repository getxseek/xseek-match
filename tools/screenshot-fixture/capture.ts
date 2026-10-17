import { chromium } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { getIndexersPayload, getTrackerDefinitionsPayload } from './trackers.js';
import {
  MOCK_SEARCH_QUERY,
  MOCK_SEARCH_RESULTS,
  MOCK_RECENT_HISTORY,
  MOCK_STATISTICS,
  MOCK_TITLE_LOOKUP_MATCHES,
} from './mock-data.js';

const PORT = 5198;
const DIST_ROOT = resolve('dist');

function startStaticServer(): Promise<Server> {
  return new Promise((res, rej) => {
    const server = createServer(async (req, resHttp) => {
      try {
        const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
        const filePath = resolve(
          DIST_ROOT,
          '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
        );
        if (!filePath.startsWith(DIST_ROOT + sep) || url.pathname.startsWith('/api/')) {
          resHttp.statusCode = 404;
          resHttp.end();
          return;
        }
        resHttp.setHeader(
          'Content-Type',
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
          }[extname(filePath)] || 'application/octet-stream',
        );
        resHttp.end(await readFile(filePath));
      } catch {
        resHttp.statusCode = 404;
        resHttp.end();
      }
    });

    server.once('error', rej);
    server.listen(PORT, '127.0.0.1', () => res(server));
  });
}

async function capture() {
  console.log('Starting static server on port %d...', PORT);
  let server: Server | undefined;
  try {
    server = await startStaticServer();
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'EADDRINUSE') {
      console.log('Server already running on port %d, reusing it.', PORT);
    } else {
      throw err;
    }
  }

  console.log('Launching headless browser at 1080p (1920x1080)...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'dark',
  });

  // Pre-seed localStorage before page mount so React useState hooks initialize with them immediately
  await context.addInitScript(
    ({ history, important }) => {
      localStorage.setItem('xseek-match-important', JSON.stringify(important));
      localStorage.setItem(
        'xseek-match-theme',
        JSON.stringify({ version: 1, preset: 'xseek', accent: null }),
      );
      localStorage.setItem(
        'xseek-match-theme-snapshot',
        JSON.stringify({ version: 1, preset: 'xseek', accent: null }),
      );
      localStorage.setItem('xseek-match-history', JSON.stringify(history));
    },
    { history: MOCK_RECENT_HISTORY, important: [1, 4, 2, 3] },
  );

  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  // Intercept backend APIs with parody tracker fixtures
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });

    if (path === '/api/auth/status') {
      return json({
        setup: false,
        authenticated: true,
        csrf: 'fixture-csrf',
        username: 'owner',
        onboarded: true,
      });
    }

    if (path === '/api/match/preferences') {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON?.() || {};
        return json({
          revisions: {},
          values: body.values || {},
        });
      }
      return json({
        values: {
          'xseek-match-theme': JSON.stringify({ version: 1, preset: 'xseek', accent: null }),
          'xseek-match-important': JSON.stringify([1, 4, 2, 3]), // SeedLagoon, WaifuBytes, Eurydice, MySecretHamster
          'xseek-match-history': JSON.stringify(MOCK_RECENT_HISTORY),
        },
        revisions: {},
        imported: true,
      });
    }

    if (path === '/api/match/indexers') {
      return json(getIndexersPayload());
    }

    if (path === '/api/match/tracker-definitions') {
      return json(getTrackerDefinitionsPayload());
    }

    if (path === '/api/match/integrations') {
      if (req.method() === 'GET') {
        return json({
          connections: [
            {
              id: 'sonarr-1',
              type: 'sonarr',
              name: 'Sonarr (Anime)',
              enabled: true,
            },
            {
              id: 'qui-main',
              type: 'qui',
              name: 'Seedbox (qui)',
              enabled: true,
            },
          ],
          capabilities: ['tv-title-lookup', 'torrent-presence'],
        });
      }

      const body = req.postDataJSON();
      if (body.action === 'release-presence') {
        return json({
          ok: true,
          failed: 0,
          matches: (body.releases || []).slice(0, 1).map((r: { key: string }) => ({
            resultKey: r.key,
            evidence: 'release',
            hash: 'e1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0',
            connection: 'Seedbox (qui)',
            client: 'qBittorrent',
            state: 'seeding',
            url: 'http://qui.lan/',
          })),
        });
      }

      if (body.action === 'lookup') {
        return json({
          ok: true,
          failed: 0,
          matches: MOCK_TITLE_LOOKUP_MATCHES,
        });
      }

      return json({ ok: true });
    }

    if (path === '/api/match/search') {
      return json({
        results: MOCK_SEARCH_RESULTS,
        cached: true,
        note: '3 release groups found across 5 trackers.',
      });
    }

    if (path === '/api/match/statistics') {
      return json(MOCK_STATISTICS);
    }

    if (path === '/api/match/info') {
      return json({
        version: '0.1.1',
        uptimeSeconds: 86400,
        startedAt: Date.now() - 86400000,
        indexerCacheHours: 24,
      });
    }

    return json({});
  });

  // --- SCREENSHOT 1: Empty search state with recent search journeys ---
  console.log('Capturing empty search landing state...');
  await page.goto(`http://127.0.0.1:${PORT}`);
  const searchInput = page.getByRole('combobox');
  await searchInput.waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  const emptyPath = resolve('docs/assets/screenshot-empty.png');
  await page.screenshot({ path: emptyPath });
  console.log('Saved -> %s', emptyPath);

  // --- SCREENSHOT 2: Enrich / title lookup suggestions ---
  console.log('Capturing Enrich / title lookup dropdown for Frasier...');
  await searchInput.fill('Frasier');
  await page.waitForSelector('.search-title-suggestions', { state: 'visible', timeout: 5000 });
  await page.waitForTimeout(500);
  const enrichPath = resolve('docs/assets/screenshot-enrich.png');
  await page.screenshot({ path: enrichPath });
  console.log('Saved -> %s', enrichPath);

  // --- SCREENSHOT 3: Main Hero Results (1080p, Freeleech, Important Trackers, Qui) ---
  console.log('Capturing Main Hero Results for Frasier S03...');
  const firstSuggestion = page.locator('[role="option"]').first();
  if (await firstSuggestion.isVisible()) {
    await firstSuggestion.click();
    await page.waitForTimeout(400);
    const s03Chip = page.getByRole('button', { name: 'S03', exact: true });
    if (await s03Chip.isVisible()) {
      await s03Chip.click();
    } else {
      await searchInput.fill('S03');
    }
    const submitBtn = page.locator('button[type="submit"]');
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    } else {
      await searchInput.press('Enter');
    }
  } else {
    await searchInput.fill(MOCK_SEARCH_QUERY);
    await searchInput.press('Enter');
  }

  const firstGroup = page.locator('.release-group').first();
  await firstGroup.waitFor({ state: 'visible', timeout: 5000 });

  // Expand top release group
  await firstGroup.locator('summary').click();
  await page.locator('.release-row').first().waitFor({ state: 'visible', timeout: 3000 });
  await page.waitForTimeout(600);

  const heroPath = resolve('docs/assets/screenshot-hero.png');
  await page.screenshot({ path: heroPath });
  console.log('Saved -> %s', heroPath);

  // --- SCREENSHOT 4: Settings -> Appearance (Themes gallery) ---
  console.log('Capturing Settings -> Appearance (Themes)...');
  await page.locator('.settings-nav').click();
  await page.waitForSelector('.settings-layout');
  await page.locator('.settings-categories').getByRole('button', { name: 'Appearance' }).click();
  await page.waitForTimeout(600);
  const themesPath = resolve('docs/assets/screenshot-themes.png');
  await page.screenshot({ path: themesPath });
  console.log('Saved -> %s', themesPath);

  // --- SCREENSHOT 5: Settings -> Statistics (Tracker Overlap Matrix) ---
  console.log('Capturing Settings -> Statistics (Overlap Matrix & Timings)...');
  await page.locator('.settings-categories').getByRole('button', { name: 'Statistics' }).click();
  await page.waitForTimeout(600);
  const overlapPath = resolve('docs/assets/screenshot-overlap.png');
  await page.screenshot({ path: overlapPath });
  console.log('Saved -> %s', overlapPath);

  // --- ALTERNATIVE THEMES: Capture Hero in other popular themes ---
  const alternativeThemes = [
    { id: 'midnight', name: 'Midnight' },
    { id: 'dracula', name: 'Dracula' },
    { id: 'nord', name: 'Nord' },
    { id: 'catppuccin', name: 'Catppuccin' },
  ];

  for (const { id, name } of alternativeThemes) {
    console.log(`Capturing alternative theme: ${name} (${id})...`);
    // Return to Appearance settings
    await page.locator('.settings-categories').getByRole('button', { name: 'Appearance' }).click();
    await page.waitForTimeout(400);

    // Select the theme preset
    await page.locator(`input[name="theme-preset"][value="${id}"]`).click({ force: true });
    await page.waitForTimeout(400);

    // Navigate back to Search page
    await page.locator('.match-rail button[aria-label="Search page"]').click();
    await page.waitForTimeout(400);

    // Ensure the top release group is open
    const group = page.locator('.release-group').first();
    await group.waitFor({ state: 'visible', timeout: 5000 });
    const isOpen = await group.getAttribute('open');
    if (isOpen === null) {
      await group.locator('summary').click();
      await page.locator('.release-row').first().waitFor({ state: 'visible', timeout: 3000 });
      await page.waitForTimeout(400);
    }

    const themeHeroPath = resolve(`docs/assets/screenshot-hero-${id}.png`);
    await page.screenshot({ path: themeHeroPath });
    console.log('Saved -> %s', themeHeroPath);

    // Navigate back to Settings for next theme
    await page.locator('.settings-nav').click();
    await page.waitForTimeout(400);
  }

  console.log('Cleaning up...');
  await browser.close();
  if (server) {
    await new Promise<void>((res) => server?.close(() => res()));
  }

  console.log('All screenshots captured successfully!');
}

capture().catch((err) => {
  console.error('Failed to capture screenshots:', err);
  process.exit(1);
});
