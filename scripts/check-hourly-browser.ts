/** Hourly presentation through the production cache adapter. Synthetic Single Runs
 * inputs test wiring and layout, not provider accuracy. No live API traffic. */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:5188/';
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/live/single-runs.response.txt', import.meta.url), 'utf8'));
for (const [timestamp, precipitation, gust, code] of [
  ['2026-10-21T18:00', 9, null, 2], ['2026-10-21T19:00', 0, 10, 51],
  ['2026-10-21T20:00', 0.03, 0, 61], ['2026-10-21T21:00', 2, null, 3],
  ['2026-10-21T22:00', null, null, 3],
] as const) {
  const i = fixture.hourly.time.indexOf(timestamp);
  assert.ok(i >= 0);
  fixture.hourly.precipitation[i] = precipitation;
  fixture.hourly.wind_gusts_10m[i] = gust;
  fixture.hourly.weather_code[i] = code;
  fixture.hourly.snowfall[i] = 0;
  fixture.hourly.is_day[i] = 0;
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Europe/London' });
  await context.route('https://**', route => route.abort());
  await context.addInitScript((single: string) => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin) return original(input, options);
      return url.hostname === 'single-runs-api.open-meteo.com'
        ? new Response(single, { headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    };
  }, JSON.stringify(fixture));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install({ time: new Date('2026-10-21T18:40:00Z') });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Refresh forecast', exact: true }).waitFor();
  const cards = page.locator('.hourly-item');
  await cards.first().getByText('Gust 22 mph', { exact: true }).waitFor();
  assert.equal(await cards.nth(0).locator('.hourly-rain > span[aria-hidden]').innerText(), '0.0 mm');
  assert.match(await cards.nth(0).locator('.hourly-condition').getAttribute('aria-label') ?? '', /Partly cloudy/);
  assert.equal(await cards.nth(1).locator('.hourly-rain > span[aria-hidden]').innerText(), '<0.1 mm');
  assert.match(await cards.nth(1).locator('.hourly-condition').getAttribute('aria-label') ?? '', /Trace precipitation/);
  assert.equal(await cards.nth(1).locator('.hourly-gust > [aria-hidden]').innerText(), 'Gust 0 mph');
  assert.equal(await cards.nth(2).locator('.hourly-gust > [aria-hidden]').innerText(), 'Gust —');
  assert.equal(await cards.nth(3).locator('.hourly-rain > span[aria-hidden]').innerText(), '—');
  assert.match(await cards.nth(2).locator('.hourly-gust .hourly-sr-only').textContent() ?? '', /unavailable/);
  assert.equal(await page.locator('.hourly-condition .icon-sun').count(), 0, 'wet night must have no sun artwork');
  const hourlyLayouts = [];
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.hourly-section').scrollIntoViewIfNeeded();
    const layout = await page.evaluate(() => {
      const scroll = document.querySelector('.hourly-scroll')!;
      const rows = [...document.querySelectorAll<HTMLElement>('.hourly-wind, .hourly-gust, .hourly-rain')];
      return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, scrolling: scroll.scrollWidth > scroll.clientWidth,
        rowsFit: rows.every(row => row.scrollWidth <= row.clientWidth && row.getBoundingClientRect().width <= row.parentElement!.clientWidth),
        labelled: rows.every(row => !!row.querySelector('.hourly-sr-only')?.textContent) };
    });
    await page.locator('.hourly-section').screenshot({ path: `/tmp/peterborough-hourly-${width}.png` });
    assert.ok(layout.pageWidth <= width, `horizontal scrolling stays inside the forecast strip: ${JSON.stringify(layout)}`);
    assert.ok((width >= 768 || layout.scrolling) && layout.rowsFit && layout.labelled, JSON.stringify(layout));
    hourlyLayouts.push(layout);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const accessible = await cards.first().ariaSnapshot();
  assert.match(accessible, /Sustained wind at the shown time/);
  assert.match(accessible, /Gust, blend of model maxima for the following hour 22 mph/);
  assert.match(accessible, /Partly cloudy/);
  await page.locator('.hourly-scroll').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.hourly-scroll')!.scrollLeft > 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ hourlyLayouts, pageErrors: errors, accessibleText: true, keyboardScrolling: true, examples: ['dry 0.0 mm', 'trace <0.1 mm', 'gust 22 mph', 'missing gust/precipitation —'] }, null, 2));
} finally { await browser.close(); }
