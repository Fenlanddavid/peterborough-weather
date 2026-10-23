import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CachedRun } from '../src/types.ts';
import { buildForecastSignals, familyMean } from '../src/forecast/signals.ts';
import { buildLatestIndex } from '../src/metrics/utils.ts';
import { latestDisplayToCanonical, HOUR, dayWindow, frostWindow, localTime } from '../src/data/contracts.ts';
import { PRECIP_3H, SNOW } from '../src/forecast/events.ts';
import { buildHourlySlot } from '../src/metrics/hourlySlot.ts';
const now = Date.parse('2026-10-21T12:00Z');
function run(modelId: string, value: number | null, age = 0, variable: CachedRun['variable'] = 'precipitation'): CachedRun {
  return { key: `${modelId}:${age}:${variable}`, modelId, runTime: new Date(now - age * HOUR).toISOString().slice(0, 16), fetchedAt: now, variable, times: Array.from({ length: 8 }, (_, i) => new Date(now + i * HOUR).toISOString().slice(0, 16)), values: Array(8).fill(value) };
}
test('equal family weight, equal models within family, UKV actual-range inclusion and Trends unchanged', () => {
  const runs = [run('ecmwf_ifs025', 0), run('ecmwf_aifs025_single', 0), run('gfs_global', 0), run('ukmo_global_deterministic_10km', 3), run('ukmo_uk_deterministic_2km', 9)];
  const signals = buildForecastSignals(runs, now);
  assert.equal(signals.mean('precipitation', now), 2);
  assert.equal(buildLatestIndex(runs).consensus('precipitation', runs[0].times[0]), 0.75);
  runs.at(-1)!.values = [9, null, null, null, null, null, null, null];
  const limited = buildForecastSignals([...runs], now);
  assert.equal(limited.mean('precipitation', now + HOUR), 1);
  assert.equal(limited.samples('precipitation', now + HOUR).length, 4);
});
test('wind adapter converts LatestIndex display mph exactly once while raw signals stay m/s', () => {
  const runs = [run('gfs_global', 10, 0, 'wind_gusts_10m')];
  const display = buildLatestIndex(runs).value('gfs_global', 'wind_gusts_10m', runs[0].times[0]);
  assert.equal(latestDisplayToCanonical('wind_gusts_10m', display), 10);
  assert.equal(buildForecastSignals(runs, now).mean('wind_gusts_10m', now), 10);
});
test('previous-run gap filling retains real run provenance, while lagged support uses distinct raw runs', () => {
  const latest = run('gfs_global', null); const previous = run('gfs_global', 1, 6);
  latest.values[1] = 0;
  const index = buildForecastSignals([latest, previous], now);
  const value = index.samples('precipitation', now)[0];
  assert.equal(value.runTime, now - 6 * HOUR); assert.equal(value.issuedAt, value.runTime); assert.equal(value.gapFilled, true);
  const support = index.support(PRECIP_3H, now, now + 3 * HOUR);
  assert.equal(support.usable, 1); assert.equal(support.value, 1);
  assert.equal(index.agreement(PRECIP_3H, now, now + 3 * HOUR).provenance.length, 2);
});
test('extra runs do not give a model additional influence; stale runs remain displayable but not support', () => {
  const base = [run('gfs_global', 0), run('ecmwf_ifs025', 1)];
  const extras = [run('gfs_global', 0, 6), run('gfs_global', 0, 12), run('gfs_global', 0, 18), run('gfs_global', 5, 48)];
  assert.equal(buildForecastSignals(base, now).support(PRECIP_3H, now, now + 3 * HOUR).value, 0.5);
  assert.equal(buildForecastSignals([...base, ...extras], now).support(PRECIP_3H, now, now + 3 * HOUR).value, 0.5);
  const stale = buildForecastSignals([run('gfs_global', 1, 37)], now);
  assert.equal(stale.mean('precipitation', now), 1); assert.equal(stale.agreement(PRECIP_3H, now, now + 3 * HOUR).value, null);
});
test('single snow trace stays below event and hourly icon thresholds', () => {
  const runs = [run('gfs_global', 0.01, 0, 'snowfall'), run('gfs_global', 0, 0, 'weather_code'), run('gfs_global', 1, 0, 'is_day')];
  const signals = buildForecastSignals(runs, now);
  assert.equal(signals.supporting(SNOW, now, now + 3 * HOUR).models, 0);
  assert.equal(buildHourlySlot(signals, runs[0].times[0]).condition.icon, 'sun');
  assert.equal(buildHourlySlot(buildForecastSignals([...runs, run('gfs_global', 95, 0, 'weather_code')], now), runs[0].times[0]).condition.icon, 'storm');
});
test('calendar and frost windows preserve 25 October repeated hours and elapsed duration', () => {
  const [start, end] = dayWindow('2026-10-25'); assert.equal((end - start) / HOUR, 25);
  assert.notEqual(localTime(start + HOUR), localTime(start + 2 * HOUR));
  const [a, b] = frostWindow('2026-10-24'); assert.equal((b - a) / HOUR, 16);
  assert.equal(familyMean([]), null);
});

test('clock changes reuse the data-load lookup while evaluating freshness at the new instant', () => {
  const runs = [run('gfs_global', 1)];
  const first = buildForecastSignals(runs, now);
  const later = buildForecastSignals(runs, now + 37 * HOUR);
  assert.equal(first.raw, later.raw); assert.equal(first.groups, later.groups);
  assert.equal(first.samples('precipitation', now, true).length, 1);
  assert.equal(later.samples('precipitation', now, true).length, 0);
  assert.equal(later.support(PRECIP_3H, now, now + 3 * HOUR).value, null);
});

test('whole-today forecast values can come from older recent runs with provenance while LatestIndex retains its contract', () => {
  const midnight = Date.parse('2026-10-21T00:00Z');
  const hours = Array.from({ length: 24 }, (_, i) => new Date(midnight + i * HOUR).toISOString().slice(0, 16));
  const runs: CachedRun[] = [0, 6, 12, 18].map(cycle => ({ key: String(cycle), modelId: 'gfs_global', runTime: new Date(midnight + cycle * HOUR).toISOString().slice(0, 16), fetchedAt: midnight + 19 * HOUR, variable: 'temperature_2m', times: hours, values: hours.map((_, i) => i < cycle ? null : cycle + 4) }));
  const index = buildForecastSignals(runs, midnight + 19 * HOUR);
  const sample = index.samples('temperature_2m', midnight + 3 * HOUR)[0];
  assert.equal(sample.value, 4); assert.equal(sample.issuedAt, midnight); assert.equal(sample.gapFilled, true);
  assert.equal(index.aggregate('temperature_2m', hours.map(t => Date.parse(t + 'Z')), 'min')[0].value, 4);
  assert.equal(buildLatestIndex(runs).value('gfs_global', 'temperature_2m', hours[3]), null);
});

test('event percentage display preserves a non-zero signal and does not round possible support into a likely tier', async () => {
  const { eventPercent } = await import('../src/data/contracts.ts');
  assert.equal(eventPercent(0.001), '<1%'); assert.equal(eventPercent(0), '0%');
  assert.equal(eventPercent(0.599), '59%'); assert.equal(eventPercent(0.6), '60%');
  assert.equal(eventPercent(null), 'unknown'); assert.equal(eventPercent(NaN), 'unknown');
});

test('coarse deterministic daily agreement aligns BST windows, retaining equal-family votes and provenance', async () => {
  const { PRECIP_DAY } = await import('../src/forecast/events.ts');
  const begin = Date.parse('2026-10-23T23:00Z');
  const times = Array.from({ length: 27 }, (_, i) => new Date(begin + i * HOUR).toISOString());
  const data = ['gfs_global', 'ecmwf_ifs025'].map(modelId => ({ ...run(modelId, 1), runTime: '2026-10-23T18:00', times, values: times.map(() => 1), nativeHours: 3 }));
  const signals = buildForecastSignals(data, begin);
  const event = signals.agreement(PRECIP_DAY, begin, begin + 24 * HOUR);
  assert.equal(event.value, 1); assert.equal(event.systems.length, 2);
  assert.ok(event.alignedWindows!.every(w => w.shiftHours === 1));
  assert.ok(event.provenance.every(p => /shifted \+1 h/.test(p.coverage)));
  assert.equal(signals.agreement(PRECIP_3H, begin, begin + 3 * HOUR).value, null);
});
