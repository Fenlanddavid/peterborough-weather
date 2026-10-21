/** Deterministic browser integration. API responses are assembled test fixtures;
 * reused Single Runs values for other model IDs are synthetic test inputs, not real source fixtures.
 * Serve the production build at a Pages subpath before running this script. No live APIs are used.
 */
import { chromium, type Page } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:5187/peterborough-weather/';
const raw = async (name: string) => readFile(new URL(`../tests/fixtures/live/${name}.response.txt`, import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let debugPage: Page | null = null;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' });
  const requests = new Map<string, number>(); const errors: string[] = [];
  const fixtureSet = {
    single: await raw('single-runs'),
    metadata: Object.fromEntries(await Promise.all(['ecmwf_ifs025_ensemble','ncep_gefs025','ukmo_global_ensemble_20km'].map(async m => [m, await raw(`metadata-${m}`)]))),
    ensemble: Object.fromEntries(await Promise.all(['ecmwf_ifs025','gfs025','ukmo_global_ensemble_20km'].map(async m => [m, await raw(`runtime-ensemble-${m}`)]))),
    core: Object.fromEntries(await Promise.all(['ecmwf_ifs025','gfs_global','ukmo_global_deterministic_10km'].map(async m => [m, await raw(`runtime-sky-core-${m}`)]))),
    optional: Object.fromEntries(await Promise.all(['ecmwf_ifs025','gfs_global','ukmo_global_deterministic_10km'].map(async m => [m, await raw(`runtime-sky-optional-${m}`)]))),
    products: Object.fromEntries(await Promise.all(['air-quality','seasonal-monthly','seasonal-weekly','kp-current','kp-forecast','ovation','solar-mag-replacement','solar-plasma-replacement','aurorawatch','iss'].map(async m => [m, await raw(m)]))),
  };
  await context.exposeBinding('recordSourceFetch', (_source, url: string) => { requests.set(url, (requests.get(url) ?? 0) + 1); });
  // A page-level fetch fixture also covers service-worker-controlled pages; the worker still
  // performs real same-origin asset caching. Block all external network as a second guard.
  await context.route('https://**', route => route.abort());
  await context.addInitScript((fixtures: any) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin) return original(input, options);
      if (!navigator.onLine) throw new TypeError('Offline browser integration');
      await (window as any).recordSourceFetch(url.href);
      let body: string | undefined;
      const model = url.searchParams.get('models')!;
      if (url.hostname === 'single-runs-api.open-meteo.com') body = fixtures.single;
      else if (url.pathname.endsWith('/static/meta.json')) body = fixtures.metadata[url.pathname.split('/')[2]];
      else if (url.hostname === 'ensemble-api.open-meteo.com') body = fixtures.ensemble[model];
      else if (url.hostname === 'api.open-meteo.com') body = (url.searchParams.get('hourly')!.includes('cloud_cover') ? fixtures.core : fixtures.optional)[model];
      else if (url.hostname === 'air-quality-api.open-meteo.com') body = fixtures.products['air-quality'];
      else if (url.hostname === 'seasonal-api.open-meteo.com') body = fixtures.products[url.searchParams.has('monthly') ? 'seasonal-monthly' : 'seasonal-weekly'];
      else if (url.pathname.endsWith('/planetary_k_index_1m.json')) body = fixtures.products['kp-current'];
      else if (url.pathname.endsWith('/noaa-planetary-k-index-forecast.json')) body = fixtures.products['kp-forecast'];
      else if (url.pathname.endsWith('/ovation_aurora_latest.json')) body = fixtures.products.ovation;
      else if (url.pathname.endsWith('/rtsw_mag_1m.json')) body = fixtures.products['solar-mag-replacement'];
      else if (url.pathname.endsWith('/rtsw_wind_1m.json')) body = fixtures.products['solar-plasma-replacement'];
      else if (url.hostname === 'aurorawatch-api.lancs.ac.uk') body = fixtures.products.aurorawatch;
      else if (url.hostname === 'celestrak.org') body = fixtures.products.iss;
      if (body === undefined) throw new TypeError('Unconfigured external source in deterministic browser test');
      return new Response(body, { headers: { 'content-type': url.hostname === 'aurorawatch-api.lancs.ac.uk' ? 'application/xml' : url.hostname === 'celestrak.org' ? 'text/plain' : 'application/json' } });
    };
  }, fixtureSet);
  const page = await context.newPage(); debugPage = page; page.setDefaultTimeout(90000); page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('BROWSER', m.text().slice(0,500)); });
  page.on('pageerror', error => errors.push(String(error)));
  await page.clock.install({ time: new Date('2026-10-21T18:40:00Z') });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Your weather, at a glance.' }).waitFor();
  await page.waitForFunction(() => document.body.textContent?.includes('51/51 temperature members'));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const forecast = await page.locator('body').innerText();
  assert.ok(forecast.includes('Expected precipitation')); assert.ok(!forecast.includes('Snow warning'));
  await page.getByRole('button', { name: 'Refresh forecast', exact: true }).waitFor();
  const firstRequests = [...requests.keys()].filter(url => url.includes('open-meteo.com')).length;
  const second = await context.newPage(); second.on('pageerror', error => errors.push(String(error)));
  await second.clock.install({ time: new Date('2026-10-21T18:40:00Z') });
  await second.goto(base, { waitUntil: 'networkidle' });
  await second.getByRole('button', { name: 'Refresh forecast', exact: true }).waitFor();
  assert.equal([...requests.keys()].filter(url => url.includes('open-meteo.com')).length, firstRequests, 'second tab should reuse recently checked shared data');
  await second.close();
  await page.getByRole('button', { name: 'Night Sky', exact: true }).click();
  await page.getByRole('heading', { name: 'The night sky ahead.' }).waitFor();
  await page.waitForFunction(() => document.body.innerText.includes('NOAA SWPC') && document.body.textContent?.includes('GFS sky weather'));
  await page.waitForTimeout(300);
  const sky = await page.locator('body').innerText();
  assert.ok(sky.toLowerCase().includes('stargazing outlook')); assert.ok(sky.includes('Jet') || sky.includes('Moon and planets'));
  assert.ok(sky.includes('Moonrise')); assert.ok(sky.includes('ISS visible-segment predictions'));
  await page.getByRole('button', { name: 'Moon and planets', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('pb-weather:observing-mode')), 'moon-planets');
  await page.screenshot({ path: '/tmp/peterborough-weather-nightsky.png', fullPage: false });
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await page.getByRole('heading', { name: 'Your forecast, in detail.' }).waitFor();
  const summary = await page.locator('body').innerText(); assert.ok(summary.includes('Uncalibrated ensemble probability estimate'));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Your weather, at a glance.' }).waitFor();
  await page.getByRole('button', { name: 'Night Sky', exact: true }).click();
  await page.getByRole('heading', { name: 'The night sky ahead.' }).waitFor();
  await page.getByRole('button', { name: 'Trends', exact: true }).click();
  await page.getByRole('heading', { name: 'Observation verification · optional' }).waitFor();
  assert.deepEqual(errors, []);
  const duplicated = [...requests].filter(([url, count]) => /single-runs|ensemble-api/.test(url) && count > 1);
  assert.deepEqual(duplicated, [], 'no duplicate core/ensemble URLs across tabs');
  const report = { checkedAt: new Date().toISOString(), base, viewport: '390×844', pageErrors: errors, distinctExternalRequests: requests.size, duplicateCoreRequests: duplicated, offlineForecastNightSkyAndTrends: true, summaryUsesEnsembles: true, screenshot: '/tmp/peterborough-weather-nightsky.png', notes: 'Deterministic browser integration using assembled fixtures; no live source traffic. Synthetic reuse of Single Runs values tests wiring only, not model skill.' };
  await writeFile(new URL('../docs/browser-smoke.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) { if (debugPage) { console.error((await debugPage.locator('body').textContent())?.slice(-12000)); await debugPage.screenshot({ path: '/tmp/peterborough-smoke-failure.png', fullPage: false }); } throw error; } finally { await browser.close(); }
