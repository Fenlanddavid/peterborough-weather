import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCurrentKp, parseKpForecast, kpForDarkness, parseOvation, wrappedLongitude, parseSolarWind, sustainedSouthward, parseAuroraWatch, freshProduct } from '../src/sky/aurora.ts';
import { HOUR } from '../src/data/contracts.ts';
const read = async (name: string) => JSON.parse(await readFile(new URL(`fixtures/live/${name}.response.txt`, import.meta.url), 'utf8'));
test('real decimal Kp, integer fallback, invalid/missing values and actual predicted schema', async () => {
  const current = parseCurrentKp(await read('kp-current'));
  assert.ok(current.entries.some(e => !Number.isInteger(e.kp)));
  const fallback = parseCurrentKp([{ time_tag: '2026-10-21T18:00', estimated_kp: null, kp_index: 3 }]);
  assert.equal(fallback.entries[0].kp, 3); assert.equal(fallback.entries[0].decimal, false);
  assert.throws(() => parseCurrentKp([{ time_tag: 'bad', kp_index: null }]));
  const forecast = parseKpForecast(await read('kp-forecast'));
  assert.ok(forecast.entries.some(e => e.kind === 'forecast')); assert.ok(forecast.entries.some(e => e.kind === 'estimated'));
});
test('daylight blocks do not drive the night headline and fresh fetches do not make stale source data current', () => {
  const now = Date.parse('2026-10-21T18:00Z');
  const product = parseKpForecast([{ time_tag: '2026-10-21T12:00', kp: 9, observed: 'predicted' }, { time_tag: '2026-10-21T18:00', kp: 3, observed: 'predicted' }], now);
  const blocks = kpForDarkness(product, { start: now + HOUR, end: now + 3 * HOUR });
  assert.deepEqual(blocks.map(b => b.kp), [3]); assert.equal(blocks[0].start, now + HOUR);
  const stale = parseCurrentKp([{ time_tag: '2026-10-20T18:00', estimated_kp: 8 }], now);
  assert.equal(freshProduct(stale, HOUR, now), false);
});
test('OVATION wraps longitude and retains regional context and product timestamps', async () => {
  assert.equal(wrappedLongitude(359), -1); assert.equal(wrappedLongitude(-1), -1);
  const product = parseOvation(await read('ovation'));
  assert.ok(product.context.every(p => p.latitude >= 55 && p.latitude <= 60 && Math.abs(p.longitude) <= 2));
  assert.match(product.coverage, /not local viewing probability/);
  assert.notEqual(product.sourceTime, product.fetchedAt);
});
test('new RTSW products use active quality-zero GSM samples; gaps, northward samples, stale data or daylight veto sustained Bz', async () => {
  const parsed = parseSolarWind(await read('solar-mag-replacement'), await read('solar-plasma-replacement'));
  assert.ok(parsed.samples.length); assert.equal(parsed.units.bzGsm, 'nT (GSM)'); assert.ok(parsed.speed! > 0);
  const now = Date.parse('2026-10-21T18:00Z');
  const raw = Array.from({ length: 31 }, (_, i) => ({ time_tag: new Date(now - i * 60_000).toISOString(), active: true, overall_quality: 0, source: 'test', bz_gsm: -11, bz_gse: 99 }));
  const good = parseSolarWind(raw, null, now);
  assert.equal(sustainedSouthward(good, now, true), true); assert.equal(sustainedSouthward(good, now, false), false);
  assert.equal(sustainedSouthward(good, now + HOUR, true), false);
  const gap = parseSolarWind(raw.filter((_, i) => i < 10 || i > 17), null, now);
  assert.equal(sustainedSouthward(gap, now, true), false);
  raw[4].bz_gsm = -9;
  assert.equal(sustainedSouthward(parseSolarWind(raw, null, now), now, true), false);
});
test('AuroraWatch XML retains upstream level and source time and rejects HTML/malformed timestamps', async () => {
  const xml = await readFile(new URL('fixtures/live/aurorawatch.response.txt', import.meta.url), 'utf8');
  const parsed = parseAuroraWatch(xml); assert.equal(parsed.level, 'yellow'); assert.ok(parsed.sourceTime! > 0);
  assert.throws(() => parseAuroraWatch('<html>fallback</html>'));
  assert.throws(() => parseAuroraWatch(xml.replace(/2026-10-21T[^<]+/, 'invalid')));
});
