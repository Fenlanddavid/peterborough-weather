import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CachedRun } from '../src/types';
import { buildForecastBriefing } from '../src/metrics/forecastSummary.ts';
import { getLocalDayHours, toLocalTime } from '../src/hooks/useLocalTime.ts';
import { buildHourlySlot } from '../src/metrics/hourlySlot.ts';
import { buildForecastSignals } from '../src/forecast/signals.ts';
import { HOUR, utc } from '../src/data/contracts.ts';

function run(variable: CachedRun['variable'], times: string[], values: (number | null)[], modelId = 'ecmwf_ifs025', runTime = '2026-12-07T00:00'): CachedRun {
  return { key: `${modelId}:${variable}:${runTime}`, modelId, runTime, variable, times, values, fetchedAt: Date.parse(`${runTime}Z`) };
}
const winterDay = getLocalDayHours('2026-12-07');
const winterNow = new Date('2026-12-07T00:00:00Z');
const winterAccumulations = [...winterDay, '2026-12-08T00:00'];

test('Sunday and Wednesday cards reflect sunny daytime rather than longer clear nights, including the clock change', () => {
  const times = Array.from({ length: 7 }, (_, i) => getLocalDayHours(`2026-10-${23 + i}`)).flat();
  const isDay = (time: string) => {
    const hour = Number(toLocalTime(time, 'time').slice(0, 2));
    return hour >= 8 && hour < 17 ? 1 : 0;
  };
  const now = new Date('2026-10-23T00:00:00Z');
  const runs = [
    run('weather_code', times, times.map(() => 0), 'ecmwf_ifs025', '2026-10-23T00:00'),
    run('is_day', times, times.map(isDay), 'ecmwf_ifs025', '2026-10-23T00:00'),
  ];
  const briefing = buildForecastBriefing(runs, now, { wholeToday: true });
  const signals = buildForecastSignals(runs, now.getTime());
  for (const day of briefing.days) {
    assert.equal(day.condition.label, 'Sunny', day.label);
    assert.equal(day.condition.icon, 'sun', day.label);
    const daytimeHour = getLocalDayHours(day.date).find(t => isDay(t))!;
    assert.equal(day.condition.label, buildHourlySlot(signals, daytimeHour).condition.label);
    assert.equal(buildHourlySlot(signals, getLocalDayHours(day.date).at(-1)!).condition.icon, 'moon');
  }
  assert.equal(briefing.days[2].label, 'Sunday');
  assert.equal(briefing.days[2].expectedHours, 25);
  assert.equal(briefing.days[5].label, 'Wednesday');
});

test('daytime conditions determine the headline while overnight rain totals and hazards remain visible', () => {
  const daytime = (t: string) => Number(t.slice(11, 13)) >= 9 && Number(t.slice(11, 13)) < 16;
  for (const [dayCode, nightCode, expectedLabel, expectedIcon] of [
    [0, 95, 'Sunny', 'sun'],
    [2, 61, 'Partly cloudy', 'partly-cloudy'],
    [61, 0, 'Light rain', 'rain'],
    [95, 0, 'Thunderstorm', 'storm'],
  ] as const) {
    const rows = [
      run('weather_code', winterDay, winterDay.map(t => daytime(t) ? dayCode : nightCode)),
      run('is_day', winterDay, winterDay.map(t => daytime(t) ? 1 : 0)),
      run('precipitation', winterAccumulations, winterAccumulations.map(t => {
        const slot = new Date(utc(t) - HOUR).toISOString();
        return (daytime(slot) ? dayCode : nightCode) >= 51 ? 1 : 0;
      })),
    ];
    const day = buildForecastBriefing(rows, winterNow, { wholeToday: true }).days[0];
    assert.equal(day.condition.label, expectedLabel);
    assert.equal(day.condition.icon, expectedIcon);
    assert.equal(day.rainMm, dayCode >= 51 ? 7 : 17);
    if (nightCode === 95) assert.ok(day.hazardTiming.some(t => t.includes('Thunderstorm') && t.includes('03:00')));
  }
});

test('missing daytime evidence stays unavailable and missing daylight flags retain neutral artwork', () => {
  const codes = run('weather_code', winterDay, winterDay.map(t => Number(t.slice(11, 13)) < 6 ? 0 : null));
  const day = buildForecastBriefing([codes], winterNow, { wholeToday: true }).days[0];
  assert.equal(day.condition.label, 'Unavailable');
  assert.equal(day.condition.icon, null);
  const neutral = buildForecastBriefing([
    run('weather_code', winterDay, winterDay.map(t => Number(t.slice(11, 13)) >= 9 && Number(t.slice(11, 13)) < 17 ? 0 : 3)),
  ], winterNow, { wholeToday: true }).days[0];
  assert.equal(neutral.condition.label, 'Clear sky');
  assert.equal(neutral.condition.icon, 'clear-sky');
});

test('whole-today cards keep daytime conditions in the evening while the remaining-today summary can describe night', () => {
  const rows = [
    run('weather_code', winterDay, winterDay.map(() => 0)),
    run('is_day', winterDay, winterDay.map(t => Number(t.slice(11, 13)) >= 9 && Number(t.slice(11, 13)) < 16 ? 1 : 0)),
  ];
  const evening = new Date('2026-12-07T20:00:00Z');
  assert.equal(buildForecastBriefing(rows, evening, { wholeToday: true }).days[0].condition.label, 'Sunny');
  assert.equal(buildForecastBriefing(rows, evening).days[0].condition.label, 'Clear night');
});

test('uses latest forecast runs including UKV, and converts wind from m/s to mph', () => {
  const briefing = buildForecastBriefing([
    run('temperature_2m', winterDay, winterDay.map(() => 99), 'ecmwf_ifs025', '2026-12-06T00:00'),
    run('temperature_2m', winterDay, winterDay.map(() => 10), 'ecmwf_ifs025', '2026-12-07T00:00'),
    run('temperature_2m', winterDay, winterDay.map(() => 14), 'gfs_global'),
    run('temperature_2m', winterDay, winterDay.map(() => 18), 'ukmo_uk_deterministic_2km'),
    run('wind_speed_10m', winterDay, winterDay.map(() => 10)),
    run('wind_gusts_10m', winterAccumulations, winterAccumulations.map((_, index) => index === 14 ? 20 : 10)),
  ], winterNow);
  assert.equal(briefing.days[0].high, 14);
  assert.equal(briefing.days[0].temperatureSpread, 8);
  assert.equal(briefing.days[0].modelCount, 3);
  assert.ok(Math.abs(briefing.days[0].windMph! - 22.3694) < 0.001);
  assert.equal(briefing.days[0].gustTime, '13:00–14:00'); // end-labelled 14:00 maximum covers 13:00–14:00
  assert.match(briefing.wind, /45 mph/);
  assert.match(briefing.agreement, /at least 4°C/);
});

test('does not describe missing rain or wind data as dry or calm', () => {
  const briefing = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map(() => 10))], winterNow);
  assert.equal(briefing.days[0].rainMm, null);
  assert.equal(briefing.days[0].windMph, null);
  // With no rain data, no rain paragraph should appear at all
  assert.doesNotMatch(briefing.days[0].paragraphs.join(' '), /Little or no rain/);
  assert.match(briefing.rainfall, /full-week total is not available/);
  assert.match(briefing.agreement, /not enough overlapping/);
  assert.equal(briefing.cold, '');
});

test('marks partial rainfall totals and does not rank them as fully covered dry days', () => {
  const briefing = buildForecastBriefing([run('precipitation', winterDay, winterDay.map((_, index) => index < 3 ? 0 : null))], winterNow);
  assert.equal(briefing.days[0].rainMm, null);
  assert.equal(briefing.days[0].rainHours, 2);
  // With null rainMm, no rain paragraph should appear
  assert.doesNotMatch(briefing.days[0].paragraphs.join(' '), /Little or no rain/);
  assert.doesNotMatch(briefing.rainfall, /Little or no rain/);
});

test('totals the local seven-day forecast and reports rain timing, snow and freezing air', () => {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-12-${String(7 + index).padStart(2, '0')}`);
  const times = dates.flatMap(getLocalDayHours);
  const accumulations = [...times, '2026-12-14T00:00'];
  const briefing = buildForecastBriefing([
    run('temperature_2m', times, times.map((_, index) => index < 24 ? -2 : 10)),
    run('precipitation', accumulations, accumulations.map((time) => time === '2026-12-08T15:00' ? 5 : 0)),
    run('snowfall', accumulations, accumulations.map((time) => time === '2026-12-07T09:00' ? 0.2 : 0)),
  ], winterNow);
  assert.match(briefing.rainfall, /1 of the next seven forecast periods has/);
  assert.match(briefing.rainfall, /5.0 mm/);
  assert.match(briefing.days[1].rainTiming!, /afternoon/);
  assert.match(briefing.cold, /below-freezing/);
  assert.doesNotMatch(briefing.cold, /snowfall signal/); // 0.2 cm is below the banner threshold
  assert.equal(briefing.days[0].snowCm, 0.2);
  assert.equal(briefing.days[6].temperatureHours, 24);
  const coldOnly = buildForecastBriefing([run('temperature_2m', times, times.map(() => -2))], winterNow);
  assert.match(coldOnly.cold, /below-freezing/);
  assert.doesNotMatch(coldOnly.cold, /snowfall/);
  const snowOnly = buildForecastBriefing([
    run('temperature_2m', times, times.map(() => 2)),
    run('snowfall', times, times.map(() => 0.1)),
  ], winterNow);
  assert.match(snowOnly.cold, /snowfall signal/);
  assert.doesNotMatch(snowOnly.cold, /freezing/);
  const noSignals = buildForecastBriefing([
    run('temperature_2m', times, times.map(() => 10)),
    run('snowfall', times, times.map(() => 0)),
  ], winterNow);
  assert.equal(noSignals.cold, '');
});

test('starts today at the current hour and includes BST midnight in the correct local day', () => {
  const times = ['2026-07-06T22:00', '2026-07-06T23:00', '2026-07-07T00:00', '2026-07-07T23:00'];
  const briefing = buildForecastBriefing([run('temperature_2m', times, [99, 8, 12, 25])], new Date('2026-07-06T23:30:00Z'));
  assert.equal(briefing.days[0].date, '2026-07-07');
  assert.equal(briefing.days[0].high, null);
  assert.equal(briefing.days[0].temperatureHours, 2);
  assert.equal(briefing.days[1].high, null);
  assert.equal(briefing.days[1].temperatureHours, 1);
  const later = buildForecastBriefing([run('temperature_2m', times, [99, 8, 12, 25])], new Date('2026-07-07T00:30:00Z'));
  assert.equal(later.days[0].low, null);
  assert.equal(later.days[0].temperatureHours, 1);
  assert.equal(later.days[0].expectedHours, 23);
});

test('handles 23-hour and 25-hour local days at the clock changes', () => {
  for (const [date, length] of [['2026-03-29', 23], ['2026-10-25', 25]] as const) {
    const hours = getLocalDayHours(date);
    const accumulationHours = [...hours, new Date(Date.parse(`${hours.at(-1)}Z`) + 3600_000).toISOString().slice(0, 16)];
    const briefing = buildForecastBriefing([run('precipitation', accumulationHours, accumulationHours.map(() => 1), 'ecmwf_ifs025', `${date}T00:00`)], new Date(`${date}T00:00:00Z`));
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

test('whole-today option keeps the hours already gone so day cards show the full day', () => {
  const briefing = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map((_, i) => i))], new Date('2026-12-07T20:30:00Z'), { wholeToday: true });
  assert.equal(briefing.days[0].low, 0);
  assert.equal(briefing.days[0].high, 23);
  assert.equal(briefing.days[0].remainingToday, false);
  const remaining = buildForecastBriefing([run('temperature_2m', winterDay, winterDay.map((_, i) => i))], new Date('2026-12-07T20:30:00Z'));
  assert.equal(remaining.days[0].low, 20);
});

test('fills hours missing from a still-publishing run from the previous run', () => {
  const briefing = buildForecastBriefing([
    run('temperature_2m', winterDay, winterDay.map(() => 5), 'ecmwf_ifs025', '2026-12-06T18:00'),
    run('temperature_2m', winterDay, winterDay.map((_, i) => i < 12 ? 7 : null), 'ecmwf_ifs025', '2026-12-07T00:00'),
  ], winterNow);
  assert.equal(briefing.days[0].temperatureHours, 24);
  assert.equal(briefing.days[0].high, 7);
  assert.equal(briefing.days[0].low, 5);
});

test('daily precipitation symbol retains daily-period evidence when the representative hour is dry', () => {
  const briefing = buildForecastBriefing([
    run('precipitation', winterAccumulations, winterAccumulations.map(t => t === '2026-12-07T18:00' ? 2 : 0)),
    run('weather_code', winterDay, winterDay.map(() => 2)),
    run('is_day', winterDay, winterDay.map(() => 1)),
  ], winterNow);
  assert.equal(briefing.days[0].rainMm, 2);
  assert.equal(briefing.days[0].precipitation.value, 1);
  assert.equal(briefing.days[0].condition.icon, 'partly-cloudy');
  assert.equal(briefing.days[0].condition.label, 'Partly cloudy');
  assert.match(briefing.days[0].rainTiming!, /afternoon/);
});

// A dry representative hour should not hide a known precipitation type later in the day.
test('a brief shower does not replace the duration-weighted daily condition and its timing stays visible', () => {
  for (const [code] of [[51, 'Light drizzle'], [61, 'Light rain'], [63, 'Rain'], [80, 'Rain showers']] as const) {
    const briefing = buildForecastBriefing([
      run('precipitation', winterAccumulations, winterAccumulations.map(t => t === '2026-12-07T18:00' ? 2 : 0)),
      run('weather_code', winterDay, winterDay.map(t => t === '2026-12-07T17:00' ? code : 2)),
      run('is_day', winterDay, winterDay.map(() => 1)),
    ], winterNow);
    assert.equal(briefing.days[0].condition.label, 'Partly cloudy');
    assert.equal(briefing.days[0].condition.icon, 'partly-cloudy');
    assert.match(briefing.days[0].rainTiming!, /afternoon/);
  }
});
