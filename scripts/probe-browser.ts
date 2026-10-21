import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { sourceProbes } from '../src/data/probes.ts';
const originUrl = process.env.PROBE_URL ?? 'https://fenlanddavid.github.io/peterborough-weather/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  // Load the real published HTML to establish the actual origin without running the old app's collectors.
  await page.route('**/*.js', route => route.abort());
  const navigation = await page.goto(originUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const origin = await page.evaluate(() => location.origin);
  const probes = sourceProbes().filter(p => !p.nodeOnly && (!process.argv[2] || p.id.includes(process.argv[2])));
  const results = [];
  for (const probe of probes) {
    const result = await page.evaluate(async p => {
      try {
        const response = await fetch(p.url, { signal: AbortSignal.timeout(20_000) });
        const body = await response.text();
        let schema: unknown;
        try { const data = JSON.parse(body); schema = Array.isArray(data) ? 'array' : Object.keys(data); } catch { schema = 'text/XML/TLE'; }
        return { id: p.id, url: p.url, readable: true, status: response.status, bytes: body.length, schema };
      } catch (error) { return { id: p.id, url: p.url, readable: false, status: null, error: String(error) }; }
    }, probe);
    results.push(result); console.log(probe.id, result.readable, result.status);
  }
  const output = new URL('../docs/browser-probes.json', import.meta.url);
  let previous: any = { results: [] };
  try { previous = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(error); }
  const merged = [...new Map([...previous.results, ...results].map(r => [r.id, r])).values()];
  await writeFile(output, JSON.stringify({ retrievedAt: new Date().toISOString(), page: originUrl, origin, navigationStatus: navigation?.status(), results: merged, note: 'Readability tested by JavaScript at the actual deployed origin; Access-Control-Allow-Origin inspection is not required.' }, null, 2) + '\n');
} finally { await browser.close(); }
