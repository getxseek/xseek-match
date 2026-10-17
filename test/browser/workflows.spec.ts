import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const rows = [1, 2].map((indexerId) => ({
  guid: String(indexerId),
  indexerId,
  indexer: 'Tracker ' + indexerId,
  title: 'Show.S01.1080p.WEB-DL.x264-GRP',
  size: 1000,
  infoHash: 'a'.repeat(64),
  seeders: 10,
}));
async function fixture(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const values: Record<string, string> = {};
  const revisions: Record<string, number> = {};
  const searches: URL[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const path = url.pathname;
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === '/api/auth/status')
      return json({
        setup: false,
        authenticated: true,
        csrf: 'fixture',
        username: 'owner',
        onboarded: true,
      });
    if (path === '/api/match/preferences') {
      if (request.method() !== 'GET') {
        const input = request.postDataJSON();
        for (const [key, value] of Object.entries(input.values)) {
          values[key] = String(value);
          revisions[key] = (revisions[key] || 0) + 1;
        }
      }
      return json({ values, revisions, imported: true });
    }
    if (path === '/api/match/indexers')
      return json({
        message: '2 available',
        trackers: [1, 2].map((id) => ({
          id,
          name: 'Tracker ' + id,
          available: true,
          categories: ['TV'],
        })),
      });
    if (path === '/api/match/tracker-definitions')
      return json({ at: Date.now(), trackers: [], nextAt: Date.now() + 86400000 });
    if (path === '/api/match/xem')
      return json({
        stale: false,
        mappings: [{ tvdbSeason: 1, tvdbEpisode: 15, sceneSeason: 2, sceneEpisode: 1 }],
      });
    if (path === '/api/match/integrations') {
      if (request.method() === 'GET')
        return json({ connections: [], capabilities: ['tv-title-lookup'] });
      return json({
        ok: true,
        failed: 0,
        matches: [
          {
            key: 'sonarr:123',
            title: 'Show',
            kind: 'sonarr',
            id: 123,
            year: 2020,
            seasons: [1],
            directMatch: true,
          },
        ],
      });
    }
    if (path === '/api/match/search') {
      searches.push(url);
      return json({ results: rows, cached: true, note: 'Initial response only.' });
    }
    if (path === '/api/match/statistics')
      return json({
        counts: { searches: 1 },
        timings: [],
        overlap: [
          { aId: 1, bId: 2, a: 'Same', b: 'Same', total: 1, evidence: 'hash' },
          { aId: 1, bId: 2, a: 'Same', b: 'Same', total: 2, evidence: 'release' },
        ],
      });
    if (path === '/api/match/info')
      return json({
        version: 'fixture',
        uptimeSeconds: 1,
        startedAt: Date.now(),
        indexerCacheHours: 24,
      });
    return json({});
  });
  await page.goto('/');
  await expect(page.getByRole('combobox')).toBeVisible();
  return { errors, values, searches };
}

test('search, v2 grouping, details, filters, flat view and history replay', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('combobox').fill('Show S01');
  await page.getByRole('combobox').press('Enter');
  await expect(page.getByRole('heading', { name: '2 results. 1 release groups.' })).toBeVisible();
  await page.locator('.release-group summary').click();
  await expect(page.locator('.release-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'All results', exact: true }).click();
  await expect(page.locator('.flat-result')).toHaveCount(2);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: '720p', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('No results match these filters.')).toBeVisible();
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page.locator('.journey-resume').click();
  await expect(page.locator('.flat-result')).toHaveCount(2);
  expect(state.searches).toHaveLength(2);
  expect(state.errors).toEqual([]);
});

test('keyboard title selection carries release numbering through the search request', async ({
  page,
}) => {
  const state = await fixture(page);
  const input = page.getByRole('combobox');
  await input.fill('Sho');
  await expect(page.getByRole('option')).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await page.getByRole('button', { name: 'S02', exact: true }).click();
  await expect(page.locator('.match-results')).toBeVisible();
  expect(state.searches[0]?.searchParams.get('numbering')).toBe('release');
  expect(state.searches[0]?.searchParams.get('q')).toBe('Show S02');
  expect(state.errors).toEqual([]);
});

test('failed history saves are visible and recover through retry', async ({ page }) => {
  const state = await fixture(page);
  let fail = true;
  await page.route('**/api/match/preferences', async (route) => {
    if (
      route.request().method() === 'PUT' &&
      route.request().postDataJSON().values['xseek-match-history'] &&
      fail
    )
      return route.fulfill({ status: 503, json: { error: 'Fixture failure' } });
    return route.fallback();
  });
  await page.getByRole('combobox').fill('Show S01');
  await page.getByRole('combobox').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Changes are not saved');
  fail = false;
  await page.getByRole('button', { name: 'Retry save' }).click();
  await expect(page.getByRole('button', { name: 'Retry save' })).toHaveCount(0);
  expect(JSON.parse(state.values['xseek-match-history']!)).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test('statistics show exact evidence and keep duplicate labels separate', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exact hash', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('button', {
      name: 'Same (#1) and Same (#2): 1 shared observations',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Inferred release', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Same (#1) and Same (#2): 2 shared observations',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Overlap map', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Highlight Same (#1)', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Highlight Same (#2)', exact: true }),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});

test('malformed optional fields and records do not break the result page', async ({ page }) => {
  const state = await fixture(page);
  await page.route('**/api/match/search?**', (route) =>
    route.fulfill({
      json: {
        results: [
          null,
          { ...rows[0], seeders: { bad: true }, infoUrl: 'javascript:bad' },
          { ...rows[1], title: 'x'.repeat(1001) },
        ],
      },
    }),
  );
  await page.getByRole('combobox').fill('Malformed');
  await page.getByRole('combobox').press('Enter');
  await expect(page.getByRole('heading', { name: '1 results. 1 release groups.' })).toBeVisible();
  await page.locator('.release-group summary').click();
  await expect(page.locator('.result-actions a')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('clear prevents a delayed response from overwriting the next search', async ({ page }) => {
  const state = await fixture(page);
  let started = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/match/search?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('q') === 'Slow') {
      started = true;
      await gate;
      await route
        .fulfill({ json: { results: [{ ...rows[0], title: 'Old result' }] } })
        .catch(() => {});
    } else await route.fallback();
  });
  await page.getByRole('combobox').fill('Slow');
  await page.getByRole('combobox').press('Enter');
  await expect.poll(() => started).toBe(true);
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await page.getByRole('combobox').fill('New query');
  await page.getByRole('combobox').press('Enter');
  await expect(page.locator('.match-results')).toBeVisible();
  release();
  await expect(page.getByText('Old result', { exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('cold title aliases revalidate without editing the query', async ({ page }) => {
  const state = await fixture(page);
  let lookups = 0;
  await page.route('**/api/match/integrations', (route) => {
    if (route.request().method() === 'GET') return route.fallback();
    lookups++;
    return route.fulfill({
      json: {
        ok: true,
        failed: 0,
        enrichmentPending: lookups === 1,
        matches: [
          {
            key: 'sonarr:123',
            title: 'Show',
            kind: 'sonarr',
            id: 123,
            year: 2020,
            seasons: [1],
            directMatch: lookups > 1,
            matchedAlias: lookups > 1 ? 'Alternate' : undefined,
          },
        ],
      },
    });
  });
  await page.getByRole('combobox').fill('Alternate');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Alternate');
  expect(lookups).toBeGreaterThan(1);
  expect(state.errors).toEqual([]);
});

test('preference conflicts require reload instead of overwriting another tab', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/match/preferences', (route) =>
    route.request().method() === 'PUT' &&
    route.request().postDataJSON().values['xseek-match-history']
      ? route.fulfill({ status: 409, json: { error: 'Concurrent update' } })
      : route.fallback(),
  );
  await page.getByRole('combobox').fill('Show');
  await page.getByRole('combobox').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Settings changed in another tab');
  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toHaveCount(0);
});

test('search controls and result details have no serious automated accessibility violations', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('combobox').fill('Show S01');
  await page.getByRole('combobox').press('Enter');
  await expect(page.locator('.match-results')).toBeVisible();
  await page.locator('.release-group summary').click();
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});

test('invalid legacy browser settings do not block startup or discard valid imports', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('xseek-match-history', 'invalid JSON');
    sessionStorage.setItem('xseek-match-page', 'obsolete');
    localStorage.setItem('xseek-match-important', '[1]');
  });
  // Install the fixture first, then reload through a one-time legacy-import response.
  await fixture(page);
  let imported: Record<string, string> | undefined;
  await page.route('**/api/match/preferences', (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { values: {}, revisions: {}, imported: false } });
    if (route.request().method() === 'POST') imported = route.request().postDataJSON().values;
    return route.fallback();
  });
  await page.reload();
  await expect(page.getByRole('combobox')).toBeVisible();
  expect(imported).toEqual({ 'xseek-match-important': '[1]' });
});

test('virtualized suggestions retain the active descendant and wrap keyboard selection', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/match/integrations', (route) =>
    route.request().method() === 'GET'
      ? route.fallback()
      : route.fulfill({
          json: {
            ok: true,
            failed: 0,
            matches: Array.from({ length: 100 }, (_, i) => ({
              key: 'sonarr:' + i,
              title: 'Show ' + i,
              kind: 'sonarr',
              id: i + 1,
              year: 2020,
              seasons: [1],
              directMatch: true,
            })),
          },
        }),
  );
  const input = page.getByRole('combobox');
  await input.fill('Show');
  await expect(page.getByRole('listbox')).toBeVisible();
  await input.press('ArrowUp');
  await expect(page.getByRole('option', { selected: true })).toContainText('Show 99');
  await input.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText('Show 0');
  await page.getByRole('listbox').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const active = await input.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  await expect(page.locator(`[id="${active}"]`)).toHaveCount(1);
});

test('holding Search automatically refreshes once while normal clicks reuse cache', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.getByRole('combobox').fill('Show S01');
  const button = page.getByRole('button', { name: 'Search', exact: true });
  await button.click();
  await expect(page.locator('.match-results')).toBeVisible();
  expect(state.searches[0]?.searchParams.has('refresh')).toBe(false);
  await button.hover();
  await page.mouse.down();
  await expect(page.locator('.search-hold-edge')).toBeVisible();
  await expect.poll(() => state.searches.length).toBe(2);
  await expect(button).toBeEnabled();
  await page.mouse.up();
  await expect.poll(() => state.searches.length).toBe(2);
  expect(state.searches[1]?.searchParams.get('refresh')).toBe('1');
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(() => state.searches.length).toBe(3);
  expect(state.searches[2]?.searchParams.has('refresh')).toBe(false);
});

const rootToken = (page: Page, name: string) =>
  page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name), name);
async function openAppearance(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
}

test('theme presets and accents preview, persist across reloads and reset', async ({ page }) => {
  const state = await fixture(page);
  expect(await rootToken(page, '--primary')).toBe('#e5484d');
  await openAppearance(page);
  await page.getByRole('radio', { name: /Midnight/ }).check();
  await expect.poll(() => rootToken(page, '--primary')).toBe('#5b9cff');
  await expect
    .poll(() => state.values['xseek-match-theme'])
    .toBe('{"version":1,"preset":"midnight","accent":null}');
  const hex = page.getByRole('textbox', { name: 'Accent color', exact: true });
  await hex.fill('#22c55e');
  await hex.press('Enter');
  await expect.poll(() => JSON.parse(state.values['xseek-match-theme']!).accent).toBe('#22c55e');
  expect(await rootToken(page, '--danger')).toBe('#f0565c');
  await page.reload();
  await expect(page.getByRole('combobox').or(page.getByRole('radio').first())).toBeVisible();
  expect(await rootToken(page, '--primary')).toBe('#22c55e');
  expect(await rootToken(page, '--background')).toBe('#0b0e14');
  await openAppearance(page).catch(() => {});
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect.poll(() => rootToken(page, '--primary')).toBe('#e5484d');
  await expect
    .poll(() => state.values['xseek-match-theme'])
    .toBe('{"version":1,"preset":"xseek","accent":null}');
  expect(state.errors).toEqual([]);
});

test('unreadable accents explain the problem and are not saved', async ({ page }) => {
  const state = await fixture(page);
  await openAppearance(page);
  const hex = page.getByRole('textbox', { name: 'Accent color', exact: true });
  await hex.fill('#111111');
  await hex.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Not saved');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  expect(state.values['xseek-match-theme']).toBeUndefined();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect.poll(() => rootToken(page, '--primary')).toBe('#e5484d');
});

test('failed theme saves stay visible and are not restored from the startup cache', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/match/preferences', (route) =>
    route.request().method() === 'PUT' && route.request().postDataJSON().values['xseek-match-theme']
      ? route.fulfill({ status: 503, json: { error: 'Fixture failure' } })
      : route.fallback(),
  );
  await openAppearance(page);
  await page.getByRole('radio', { name: /Midnight/ }).check();
  await expect(page.getByRole('alert')).toContainText('Changes are not saved');
  expect(await rootToken(page, '--primary')).toBe('#5b9cff');
  expect(
    await page.evaluate(() => localStorage.getItem('xseek-match-theme-snapshot') ?? ''),
  ).not.toContain('midnight');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await fixture(page);
  expect(await rootToken(page, '--primary')).toBe('#e5484d');
});

test('corrupt startup theme cache falls back to the default and the server value wins', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('xseek-match-theme-snapshot', '{"version":1,"preset":"evil"'),
  );
  const state = await fixture(page);
  expect(await rootToken(page, '--primary')).toBe('#e5484d');
  expect(state.errors).toEqual([]);
});

test('appearance settings have no serious automated accessibility violations', async ({ page }) => {
  await fixture(page);
  await openAppearance(page);
  await page.getByRole('radio', { name: /Midnight/ }).focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('radio', { name: /xseek/ })).toBeChecked();
  await page.getByRole('radio', { name: /Midnight/ }).check();
  await expect.poll(() => rootToken(page, '--primary')).toBe('#5b9cff');
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    audit.violations
      .filter((v) => v.impact === 'critical' || v.impact === 'serious')
      .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.map((n) => n.target) })),
  ).toEqual([]);
});

test('info panel offers the AGPL source link', async ({ page }) => {
  await fixture(page);
  await openAppearance(page);
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  const source = page.getByRole('link', { name: 'github.com/getxseek/xseek-match' });
  await expect(source).toHaveAttribute('href', 'https://github.com/getxseek/xseek-match');
  await expect(page.getByText('AGPL-3.0-or-later')).toBeVisible();
});

test('step 2 connects, then quietly syncs indexers and their icons before the result', async ({
  page,
}) => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const iconRequests = new Set<string>();
  let releaseIcons!: () => void;
  const iconsReleased = new Promise<void>((resolve) => (releaseIcons = resolve));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/status')
      return route.fulfill({
        json: {
          setup: false,
          authenticated: true,
          csrf: 'fixture',
          onboarded: false,
          step: 'connection',
        },
      });
    if (url.pathname === '/api/auth/connection')
      return route.fulfill({ json: { ok: true, count: 2 } });
    if (url.pathname === '/api/match/preferences')
      return route.fulfill({ json: { values: {}, revisions: {}, imported: true } });
    if (url.pathname === '/api/match/indexers')
      return route.fulfill({
        json: {
          trackers: [1, 2].map((id) => ({
            id,
            name: id === 1 ? 'TrackerAlpha' : 'TrackerBeta',
            icon: `/api/match/favicon?id=${id}`,
          })),
        },
      });
    if (url.pathname === '/api/match/favicon') {
      iconRequests.add(url.searchParams.get('id')!);
      await iconsReleased;
      return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    return route.fulfill({ json: { ok: true } });
  });
  const started = Date.now();
  await page.goto('/');
  await expect(page.getByText('Connected to your Prowlarr')).toBeVisible();
  await expect(page.getByText('Syncing your indexers')).toBeVisible();
  await expect.poll(() => iconRequests.size).toBe(2);
  await expect(page.getByText(/icon/i)).toHaveCount(0);
  releaseIcons();
  await expect(page.getByRole('button', { name: 'Review trackers' })).toBeVisible();
  expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
  await expect(page.getByText('Discovered 2 indexers')).toBeVisible();
  await page.getByRole('button', { name: 'Review trackers' }).click();
  await expect(page.getByRole('heading', { name: 'Configure your indexers' })).toBeVisible();
  await expect(page.locator('.onboarding-trackers .result-indexer-icon img')).toHaveCount(2);
});

test('important indexers sit under the search bar, left of the actions', async ({ page }) => {
  const state = await fixture(page);
  state.values['xseek-match-important'] = '[1,2]';
  await page.reload();
  await page.getByRole('combobox').fill('Show S01');
  await page.getByRole('combobox').press('Enter');
  const indexers = page.locator('.search-bar-footer .important-indexers');
  await expect(indexers).toContainText('Tracker 1');
  const footer = (await page.locator('.search-bar-footer').boundingBox())!;
  const box = (await indexers.boundingBox())!;
  const actions = (await page.locator('.search-bar-footer .search-actions').boundingBox())!;
  // Regression: without .search-bar-status-row { display: contents } the list jumps beside the actions.
  expect(box.x).toBeLessThan(footer.x + footer.width / 3);
  expect(box.x).toBeLessThan(actions.x);
});

test('suggestion posters load small sizes: shimmer, blurred preview, then sharp', async ({
  page,
}) => {
  await fixture(page);
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const posterRequests: string[] = [];
  let releaseFull!: () => void;
  const fullReleased = new Promise<void>((resolve) => (releaseFull = resolve));
  await page.route('https://image.tmdb.org/**', async (route) => {
    posterRequests.push(new URL(route.request().url()).pathname);
    if (route.request().url().includes('/w185/')) await fullReleased;
    await route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  });
  await page.route('**/api/match/integrations', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { connections: [], capabilities: ['tv-title-lookup'] } })
      : route.fulfill({
          json: {
            ok: true,
            failed: 0,
            matches: [
              {
                key: 'sonarr:123',
                title: 'Show',
                kind: 'sonarr',
                id: 123,
                year: 2020,
                seasons: [1],
                directMatch: true,
                poster: 'https://image.tmdb.org/t/p/original/fixture.jpg',
              },
            ],
          },
        }),
  );
  await page.getByRole('combobox').fill('Sho');
  const frame = page.locator('.search-title-suggestions .poster-frame');
  await expect(frame).toHaveAttribute('data-preview', 'true');
  await expect(frame).toHaveAttribute('data-full', 'false');
  releaseFull();
  await expect(frame).toHaveAttribute('data-full', 'true');
  expect(posterRequests.sort()).toEqual(['/t/p/w185/fixture.jpg', '/t/p/w45/fixture.jpg']);
});

test('owners can keep an unreadable accent with an explicit override', async ({ page }) => {
  const state = await fixture(page);
  await openAppearance(page);
  const hex = page.getByRole('textbox', { name: 'Accent color', exact: true });
  await hex.fill('#111111');
  await hex.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Not saved');
  expect(state.values['xseek-match-theme']).toBeUndefined();
  await page.getByRole('button', { name: 'Use anyway' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect.poll(() => state.values['xseek-match-theme']).toContain('#111111');
  await expect.poll(() => rootToken(page, '--primary')).toBe('#111111');
});

test('qui presence is reused for a minute when re-running a search', async ({ page }) => {
  const state = await fixture(page);
  let presenceCalls = 0;
  await page.route('**/api/match/integrations', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { connections: [], capabilities: ['tv-title-lookup', 'torrent-presence'] },
      });
    const input = route.request().postDataJSON();
    if (input.action !== 'release-presence') return route.fallback();
    presenceCalls++;
    return route.fulfill({
      json: {
        ok: true,
        failed: 0,
        matches: input.releases.map((release: { key: string }) => ({
          resultKey: release.key,
          evidence: 'release',
          hash: 'a'.repeat(40),
          connection: 'Seedbox',
          client: 'qBittorrent',
          state: 'seeding',
          url: 'http://qui.test/',
        })),
      },
    });
  });
  const input = page.getByRole('combobox');
  await input.fill('Show S01');
  await input.press('Enter');
  await page.locator('.release-group summary').first().click();
  await expect(page.locator('.qui-presence-icon').first()).toBeVisible();
  expect(presenceCalls).toBe(1);
  await input.press('Enter');
  await expect.poll(() => state.searches.length).toBe(2);
  await page.locator('.release-group summary').first().click();
  await expect(page.locator('.qui-presence-icon').first()).toBeVisible();
  expect(presenceCalls).toBe(1);
});

test('logs open scrolled to the newest entry', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/match/logs', (route) =>
    route.fulfill({
      json: {
        logs: Array.from({ length: 200 }, (_, index) => ({
          at: Date.now() - (200 - index) * 1000,
          level: 'info',
          message: `Fixture event ${index}`,
        })),
      },
    }),
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  const view = page.locator('.log-view');
  await expect(view).toContainText('Fixture event 199');
  await expect
    .poll(() =>
      view.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight),
    )
    .toBeLessThan(2);
});

test('integration test buttons spin, then show the result', async ({ page }) => {
  await fixture(page);
  let releaseTest!: () => void;
  const testReleased = new Promise<void>((resolve) => (releaseTest = resolve));
  const connection = {
    id: 'sonarr-main',
    kind: 'sonarr',
    name: 'Main',
    baseUrl: 'http://sonarr:8989',
    enabled: true,
    hasApiKey: true,
    checkedAt: Date.now(),
    status: 'connected',
    detail: 'Connected · 4.0',
    capabilities: ['tv-title-lookup'],
  };
  await page.route('**/api/match/integrations', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        json: { connections: [connection], capabilities: ['tv-title-lookup'] },
      });
    await testReleased;
    return route.fulfill({ json: { ok: true, detail: 'Connected · 4.0' } });
  });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Integrations', exact: true }).click();
  const button = page.getByRole('button', { name: 'Test Main' });
  await button.click();
  await expect(button).toHaveAttribute('aria-busy', 'true');
  await expect(button.locator('.search-spinner')).toBeVisible();
  releaseTest();
  await expect(button).toHaveAttribute('data-result', 'ok');
  await expect(button).toContainText('Connection works');
  await expect(button).toHaveAttribute('data-result', 'idle', { timeout: 4000 });
});
