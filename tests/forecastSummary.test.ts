import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CachedRun } from '../src/types';
import { buildForecastBriefing } from '../src/metrics/forecastSummary.ts';
import { getLocalDayHours } from '../src/hooks/useLocalTime.ts';

function run(variable: CachedRun['variable'], times: string[], values: (number | null)[], modelId = 'ecmwf_ifs025', runTime = '2026-10-18T00:00'): CachedRun {
  return { key: `${modelId}:${variable}:${runTime}`, modelId, runTime, variable, times, values, fetchedAt: Date.parse(`${runTime}Z`) };
}
const winterDay = getLocalDayHours('2026-12-07');
const winterNow = new Date('2026-12-07T00:00:00Z');

test('uses latest runs, excludes overlays, and converts wind from m/s to mph', () => {
  const briefing = buildForecastBriefing([
    run('temperature_2m', winterDay, winterDay.map(() => 99), 'ecmwf_ifs025', '2026-12-06T00:00'),
    run('temperature_2m', winterDay, winterDay.map(() => 10), 'ecmwf_ifs025', '2026-12-07T00:00'),
    run('temperature_2m', winterDay, winterDay.map(() => 14), 'gfs_global'),
    run('temperature_2m', winterDay, winterDay.map(() => 90), 'ukmo_uk_deterministic_2km'),
    run('wind_speed_10m', winterDay, winterDay.map(() => 10)),
    run('wind_gusts_10m', winterDay, winterDay.map((_, index) => index === 14 ? 20 : 10)),
  ], winterNow);
  assert.equal(briefing.days[0].high, 12);
  assert.equal(briefing.days[0].temperatureSpread, 4);
  assert.equal(briefing.days[0].modelCount, 2);
  assert.ok(Math.abs(briefing.days[0].windMph! - 22.3694) < 0.001);
  assert.equal(briefing.days[0].gustTime, '14:00');
  assert.match(briefing.wind, /45 mph/);
  assert.match(briefing.agreement, /at least 4°C/);
});

test('does not describe missing rain or wind data as dry or calm', () => {
  const briefing = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map(() => 10))], winterNow);
  assert.equal(briefing.days[0].rainMm, null);
  assert.equal(briefing.days[0].windMph, null);
  assert.match(briefing.days[0].paragraphs.join(' '), /Rainfall data is unavailable/);
  assert.doesNotMatch(briefing.days[0].paragraphs.join(' '), /Little or no rain/);
  assert.match(briefing.rainfall, /full-week total is not available/);
  assert.match(briefing.agreement, /not enough overlapping/);
});

test('marks partial rainfall totals and does not rank them as fully covered dry days', () => {
  const briefing = buildForecastBriefing([run('precipitation', winterDay, winterDay.map((_, index) => index < 2 ? 0 : null))], winterNow);
  assert.equal(briefing.days[0].rainMm, 0);
  assert.equal(briefing.days[0].rainHours, 2);
  assert.match(briefing.days[0].paragraphs.join(' '), /coverage is incomplete \(2 of 24 hours\)/);
  assert.doesNotMatch(briefing.rainfall, /Little or no rain is indicated/);
});

test('totals the local seven-day forecast and reports rain timing, snow and freezing air', () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-12-${String(7 + index).padStart(2, '0')}`);
  const times = dates.flatMap(getLocalDayHours);
  const briefing = buildForecastBriefing([
    run('temperature_2m', times, times.map((_, index) => index < 24 ? -2 : 10)),
    run('precipitation', times, times.map((time) => time === '2026-12-08T15:00' ? 5 : 0)),
    run('snowfall', times, times.map((time) => time === '2026-12-07T09:00' ? 0.2 : 0)),
  ], winterNow);
  assert.match(briefing.rainfall, /1 of the next seven forecast periods has/);
  assert.match(briefing.rainfall, /5.0 mm/);
  assert.match(briefing.days[1].rainTiming!, /afternoon/);
  assert.match(briefing.cold, /below-freezing/);
  assert.match(briefing.cold, /snowfall signal/);
  assert.equal(briefing.days[0].snowCm, 0.2);
  assert.equal(briefing.days[6].temperatureHours, 24);
});

test('starts today at the current hour and includes BST midnight in the correct local day', () => {
  const times = ['2026-07-06T22:00', '2026-07-06T23:00', '2026-07-07T00:00', '2026-07-07T23:00'];
  const briefing = buildForecastBriefing([run('temperature_2m', times, [99, 8, 12, 25])], new Date('2026-07-06T23:30:00Z'));
  assert.equal(briefing.days[0].date, '2026-07-07');
  assert.equal(briefing.days[0].high, 12);
  assert.equal(briefing.days[0].low, 8);
  assert.equal(briefing.days[1].high, 25);
  const later = buildForecastBriefing([run('temperature_2m', times, [99, 8, 12, 25])], new Date('2026-07-07T00:30:00Z'));
  assert.equal(later.days[0].low, 12);
  assert.equal(later.days[0].expectedHours, 23);
});

test('handles 23-hour and 25-hour local days at the clock changes', () => {
  for (const [date, length] of [['2026-03-29', 23], ['2026-10-25', 25]] as const) {
    const hours = getLocalDayHours(date);
    const briefing = buildForecastBriefing([run('precipitation', hours, hours.map(() => 1))], new Date(`${date}T00:00:00Z`));
    assert.equal(briefing.days[0].expectedHours, length - (date === '2026-10-25' ? 1 : 0));
    assert.equal(briefing.days[0].rainMm, briefing.days[0].expectedHours);
    assert.doesNotMatch(briefing.days[0].paragraphs.join(' '), /coverage is incomplete/);
  }
});

test('ignores invalid values and expired forecast hours instead of generating a fabricated outlook', () => {
  const briefing = buildForecastBriefing([
    run('temperature_2m', winterDay, winterDay.map(() => Number.NaN)),
    run('precipitation', winterDay, winterDay.map(() => -1)),
    run('wind_speed_10m', winterDay, winterDay.map(() => Number.POSITIVE_INFINITY)),
  ], winterNow);
  assert.equal(briefing.hasData, false);
  assert.equal(briefing.days[0].high, null);
  assert.equal(briefing.days[0].rainMm, null);
  const expired = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map(() => 10))], new Date('2026-12-20T12:00:00Z'));
  assert.equal(expired.hasData, false);
  assert.equal(expired.latestRun, null);
});

test('indicates stale model runs separately from a fresh fetch time', () => {
  const briefing = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map(() => 10), 'ecmwf_ifs025', '2026-12-04T00:00')], winterNow);
  assert.equal(briefing.stale, true);
  assert.equal(briefing.latestRun, '2026-12-04T00:00');
});


test('uses the most frequent weather category rather than averaging weather codes', () => {
  const briefing = buildForecastBriefing([
    run('weather_code', winterDay, winterDay.map(() => 3)),
    run('weather_code', winterDay, winterDay.map(() => 3), 'gfs_global'),
    run('weather_code', winterDay, winterDay.map(() => 61), 'ukmo_global_deterministic_10km'),
  ], winterNow);
  assert.equal(briefing.days[0].weatherCode, 3);
});
