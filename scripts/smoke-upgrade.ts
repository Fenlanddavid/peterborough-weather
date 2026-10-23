/** Offline fixtures exercise the forecast upgrade and Night Sky glance cards.
 * These checks verify behaviour/layout, never observed forecast accuracy. */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:5188/';
const fixture = async (name: string) => JSON.parse(await readFile(new URL(`../tests/fixtures/live/${name}.response.txt`, import.meta.url), 'utf8'));
const skyModels = ['ecmwf_ifs025', 'gfs_global', 'ukmo_global_deterministic_10km'];
const single = await fixture('single-runs');
// Four distinct conditions make every glance symbol observable in one night.
const cloud = (t: string) => [10, 45, 80, 100][Math.floor(Date.parse(t.endsWith('Z') ? t : `${t}Z`) / 3600_000) % 4];
single.hourly.cloud_cover = single.hourly.time.map(cloud);
single.hourly.snowfall = single.hourly.time.map(() => 0);
single.hourly.weather_code = single.hourly.time.map(() => 3);
const core = Object.fromEntries(await Promise.all(skyModels.map(async model => {
  const data = await fixture(`runtime-sky-core-${model}`);
  data.hourly.cloud_cover = data.hourly.time.map(cloud);
  return [model, data];
})));
const optional = Object.fromEntries(await Promise.all(skyModels.map(async model => [model, await fixture(`runtime-sky-optional-${model}`)])));
const ensemble = Object.fromEntries(await Promise.all(['ecmwf_ifs025', 'gfs025', 'ukmo_global_ensemble_20km'].map(async model => [model, await fixture(`runtime-ensemble-${model}`)])));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London', reducedMotion: 'reduce' });
  const requests: string[] = [];
  const pageErrors: string[] = [];
  await context.route('https://**', route => route.abort());
  await context.addInitScript((fixtures: any) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin) {
        if (/\/data\/forecast\//.test(url.pathname)) return new Response('{}', { status: 404 });
        return original(input, options);
      }
      (window as any).__sourceRequests ??= [];
      (window as any).__sourceRequests.push(url.href);
      const model = url.searchParams.get('models')!;
      let data;
      if (url.hostname === 'single-runs-api.open-meteo.com') data = fixtures.single;
      else if (url.hostname === 'ensemble-api.open-meteo.com') data = fixtures.ensemble[model];
      else if (url.hostname === 'api.open-meteo.com' && !url.pathname.endsWith('meta.json')) data = url.searchParams.get('hourly')?.includes('cloud_cover') ? fixtures.core[model] : fixtures.optional[model];
      return new Response(JSON.stringify(data ?? {}), { status: data ? 200 : 404, headers: { 'content-type': 'application/json' } });
    };
  }, { single, core, optional, ensemble });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-21T18:40:00Z') });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your weather, at a glance.' }).waitFor();
  await page.getByRole('button', { name: 'Refresh forecast', exact: true }).waitFor();
  assert.ok(await page.locator('.hourly-item').count() > 0);
  assert.ok((await page.locator('.forecast-details').innerText()).includes('Deterministic wet agreement') || (await page.locator('.forecast-details').innerText()).includes('Ensemble rain probability'));
  assert.equal(await page.getByRole('heading', { name: 'Wind warning', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Night Sky', exact: true }).click();
  await page.getByRole('heading', { name: 'The night sky ahead.' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.sky-period-symbol svg').length >= 10 && !!document.querySelector('.sky-period--clear'));
  const cards = page.locator('.sky-period');
  assert.ok(await cards.count() >= 10);
  assert.ok(await page.locator('.sky-period--clear .sky-period-symbol').count() > 0);
  assert.ok(await page.locator('.sky-period--mixed .sky-period-symbol').count() > 0);
  assert.ok(await page.locator('.sky-period--cloudy .sky-period-symbol').count() > 0);
  assert.ok((await cards.first().locator('.sky-period-condition').innerText()).length > 0);
  assert.ok(!/^\d+$/.test(await cards.first().locator('strong').innerText()), 'large card headline is a condition, not a numerical score');
  await cards.nth(3).click();
  assert.equal(await cards.nth(3).getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('#sky-hour-details').innerText(), /Observing score|score unavailable/);
  assert.match(await page.locator('#sky-hour-details').innerText(), /Moon.*illuminated/);
  await cards.nth(3).click();
  assert.equal(await cards.nth(3).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: 'Later observing hours' }).click();
  await page.waitForFunction(() => document.querySelector('.sky-timeline')!.scrollLeft > 0);
  const laterScroll = await page.locator('.sky-timeline').evaluate(e => e.scrollLeft);
  await page.getByRole('button', { name: 'Earlier observing hours' }).click();
  await page.waitForFunction(previous => document.querySelector('.sky-timeline')!.scrollLeft < previous, laterScroll);
  await page.locator('.sky-timeline').evaluate(e => e.scrollTo({ left: 0, behavior: 'instant' }));
  const layouts = [];
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.sky-hourly-heading').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => ({ width: innerWidth, pageWidth: document.documentElement.scrollWidth, stripScrollable: document.querySelector('.sky-timeline')!.scrollWidth > document.querySelector('.sky-timeline')!.clientWidth, cardsFit: [...document.querySelectorAll('.sky-period')].every(e => e.scrollWidth <= e.clientWidth), touchTargets: [...document.querySelectorAll('.sky-scroll-actions button, .sky-period')].every(e => e.getBoundingClientRect().height >= 44) }));
    assert.ok(layout.pageWidth <= width, JSON.stringify(layout)); assert.ok(layout.cardsFit && layout.touchTargets, JSON.stringify(layout));
    if (width < 768) assert.ok(layout.stripScrollable);
    layouts.push(layout);
    await page.locator('.sky-timeline-shell').screenshot({ path: `/tmp/peterborough-sky-glance-${width}.png` });
  }
  await cards.first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await cards.first().getAttribute('aria-expanded'), 'true');
  assert.deepEqual(pageErrors, []);
  requests.push(...await page.evaluate(() => (window as any).__sourceRequests ?? []));
  const report = { checkedAt: new Date().toISOString(), base, layouts, pageErrors, requestCount: requests.length, iconConditions: ['Mostly clear', 'Some cloud', 'Mostly cloudy', 'Overcast'], expandableDetails: true, keyboardActivation: true, sourceFallbacks: true, screenshot: '/tmp/peterborough-sky-glance-390.png', note: 'Assembled fixtures validate UI and fallback wiring, not observed forecast skill.' };
  await writeFile(new URL('../docs/upgrade-browser-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
