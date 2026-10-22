import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CachedRun } from '../src/types.ts';
import { HOUR, localTime, utc } from '../src/data/contracts.ts';
import { getLocalDayHours } from '../src/hooks/useLocalTime.ts';
import { buildForecastSignals } from '../src/forecast/signals.ts';
import { PRECIP_3H } from '../src/forecast/events.ts';
import { formatPrecipitation, getDailyCondition, getHourlyCondition, precipitationKind } from '../src/metrics/hourlyWeather.ts';
import { buildHourlySlot } from '../src/metrics/hourlySlot.ts';

const start = utc('2026-10-21T14:00');
const time = new Date(start).toISOString();
function run(variable: CachedRun['variable'], values: (number | null)[], modelId = 'gfs_global', age = 0): CachedRun {
  return { key: `${modelId}:${variable}:${age}`, modelId, variable, runTime: new Date(start - age * HOUR).toISOString(), fetchedAt: start,
    times: values.map((_, i) => new Date(start + i * HOUR).toISOString()), values };
}
const evidence = { codes: [2], precipitation: 0, snowfall: 0, cloud: 0.4, daylight: 1 };

test('later rain and nonzero three-hour agreement cannot wet a dry slot', () => {
  const signals = buildForecastSignals([run('precipitation', [9, 0, 0, 2]), run('weather_code', [2]), run('cloud_cover', [40]), run('is_day', [1])], start);
  const event = signals.event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(event.value, 1);
  const slot = buildHourlySlot(signals, time);
  assert.equal(slot.precipitation, 0); assert.equal(slot.display.precipitation, '0.0 mm');
  assert.equal(slot.condition.icon, 'partly-cloudy');
  assert.equal(getDailyCondition(signals, time, event).icon, 'precipitation', 'daily period retains its separate event interpretation');
  const withProbability = { ...evidence, event: { ...event, basis: 'ensemble-probability', value: 0.001 } };
  assert.equal(getHourlyCondition(withProbability).icon, 'partly-cloudy');
});

test('ordinary wet code beside true zero uses sky and explains the conflict', () => {
  for (const code of [51, 53, 55, 61, 63, 65, 80, 81, 82]) {
    const condition = getHourlyCondition({ ...evidence, codes: [code] });
    assert.equal(condition.icon, 'partly-cloudy'); assert.match(condition.description!, /wet code conflicts with zero/);
  }
});

test('raw trace and 0.1 boundary have identical formatting and condition semantics', () => {
  for (const [value, kind, formatted] of [
    [0, 'zero', '0.0 mm'], [Number.MIN_VALUE, 'trace', '<0.1 mm'], [0.03, 'trace', '<0.1 mm'],
    [0.1 - Number.EPSILON, 'trace', '<0.1 mm'], [0.1, 'wet', '0.1 mm'], [0.1 + Number.EPSILON, 'wet', '0.1 mm'], [1.26, 'wet', '1.3 mm'],
  ] as const) {
    assert.equal(precipitationKind(value), kind); assert.equal(formatPrecipitation(value), formatted);
    const condition = getHourlyCondition({ ...evidence, precipitation: value });
    assert.equal(condition.icon, kind === 'wet' ? 'precipitation' : 'partly-cloudy');
    if (kind === 'trace') assert.match(condition.description!, /Trace precipitation/);
  }
  for (const value of [null, NaN, Infinity, -0.01]) assert.equal(formatPrecipitation(value), '—');
});

test('supported types, trace drizzle and instantaneous hazards retain explanations', () => {
  for (const [code, icon, label] of [[51, 'rain', /drizzle/], [61, 'rain', /rain/], [80, 'rain', /showers/], [71, 'snow', /snow/], [66, 'rain', /Freezing rain/], [95, 'storm', /Thunderstorm/]] as const) {
    const condition = getHourlyCondition({ ...evidence, codes: [code], precipitation: 0.5 });
    assert.equal(condition.icon, icon); assert.match(condition.label, label);
  }
  for (const code of [45, 48]) {
    assert.equal(getHourlyCondition({ ...evidence, codes: [code] }).icon, 'fog');
    assert.match(getHourlyCondition({ ...evidence, codes: [code], precipitation: 0.5 }).description!, /fog|Fog/);
  }
  for (const code of [51, 80]) {
    const condition = getHourlyCondition({ ...evidence, codes: [code], precipitation: 0.03 });
    assert.equal(condition.icon, 'rain'); assert.match(condition.description!, /Trace precipitation/);
  }
  assert.equal(getHourlyCondition({ ...evidence, codes: [61], precipitation: 0.03 }).icon, 'partly-cloudy');
  for (const code of [56, 66, 71, 95]) {
    const condition = getHourlyCondition({ ...evidence, codes: [code] });
    assert.match(condition.description!, /shown time; may not persist/);
    assert.notEqual(condition.icon, 'partly-cloudy');
  }
  assert.equal(getHourlyCondition({ ...evidence, snowfall: 0.001 }).icon, 'snow');
  assert.equal(getHourlyCondition({ ...evidence, precipitation: 1, codes: [] }).icon, 'precipitation');
});

test('dry codes work without cloud; daylight and missing values do not invent sun or dry weather', () => {
  for (const [code, dayIcon, nightIcon] of [[0, 'sun', 'moon'], [1, 'sun', 'moon'], [2, 'partly-cloudy', 'cloud-moon'], [3, 'cloud', 'cloud']] as const) {
    assert.equal(getHourlyCondition({ ...evidence, codes: [code], cloud: null }).icon, dayIcon);
    assert.equal(getHourlyCondition({ ...evidence, codes: [code], cloud: null, daylight: 0 }).icon, nightIcon);
  }
  assert.equal(getHourlyCondition({ ...evidence, codes: [], cloud: null }).icon, null);
  assert.equal(getHourlyCondition({ ...evidence, codes: [], cloud: 0.8 }).icon, 'cloud');
  for (const daylight of [0, null]) for (const code of [0, 2, 51, 61, 80]) {
    const condition = getHourlyCondition({ ...evidence, codes: [code], daylight, precipitation: 0.5 });
    assert.ok(!['sun', 'partly-cloudy', 'showers'].includes(condition.icon!));
  }
  const missing = getHourlyCondition({ ...evidence, codes: [61], precipitation: null });
  assert.equal(missing.icon, 'rain'); assert.match(missing.description!, /shown time.*unavailable/);
});

test('provider end timestamps supply amounts and gusts; instantaneous values stay at start', () => {
  const slot = buildHourlySlot(buildForecastSignals([
    run('temperature_2m', [12, 90]), run('wind_speed_10m', [5, 80]), run('precipitation', [7, 0.03]),
    run('snowfall', [1, 0]), run('wind_gusts_10m', [99, 10]), run('weather_code', [51]), run('is_day', [0]),
  ], start), time);
  assert.equal(slot.temperature, 12); assert.equal(slot.wind, 5); assert.equal(slot.gust, 10);
  assert.equal(slot.precipitation, 0.03); assert.equal(slot.snowfall, 0);
  assert.equal(slot.display.gust, '22 mph'); assert.equal(slot.display.precipitation, '<0.1 mm');
  assert.match(slot.accessible.gust, /blend of model maxima.*22 mph/);
  assert.match(slot.accessible.wind, /shown time 11 mph/);
  assert.match(slot.accessible.interval, /15:00 BST.*16:00 BST/);
  assert.equal(slot.condition.icon, 'rain');
});

test('missing endpoints, invalid/unknown-unit gusts and real zeros remain distinct; no clamping', () => {
  for (const values of [[10], [10, null], [10, -1], [10, NaN], [10, Infinity]]) {
    const slot = buildHourlySlot(buildForecastSignals([run('wind_gusts_10m', values)], start), time);
    assert.equal(slot.gust, null); assert.equal(slot.display.gust, '—'); assert.equal(slot.display.precipitation, '—');
    assert.match(slot.accessible.gust, /unavailable/);
  }
  const unknown = { ...run('wind_gusts_10m', [10, 10]), unitState: 'unknown-legacy' as const };
  assert.equal(buildHourlySlot(buildForecastSignals([unknown], start), time).gust, null);
  const slot = buildHourlySlot(buildForecastSignals([run('wind_gusts_10m', [10, 0]), run('wind_speed_10m', [10]), run('precipitation', [1, 0])], start), time);
  assert.equal(slot.display.gust, '0 mph'); assert.equal(slot.display.wind, '22 mph'); assert.equal(slot.display.precipitation, '0.0 mm');
});

test('family weighting and deterministic code ties are shared; fresh values exclude stale votes', () => {
  const runs = [run('wind_gusts_10m', [0, 0], 'ecmwf_ifs025'), run('wind_gusts_10m', [0, 0], 'ecmwf_aifs025_single'), run('wind_gusts_10m', [0, 12]), run('wind_gusts_10m', [0, 6], 'ukmo_global_deterministic_10km'), run('wind_gusts_10m', [0, 18], 'ukmo_uk_deterministic_2km')];
  assert.equal(buildHourlySlot(buildForecastSignals(runs, start), time).gust, 8);
  const codes = [run('weather_code', [3]), run('weather_code', [2], 'ecmwf_ifs025'), run('is_day', [1])];
  assert.equal(buildHourlySlot(buildForecastSignals(codes, start), time).condition.icon, 'partly-cloudy');
  assert.equal(buildHourlySlot(buildForecastSignals([...codes].reverse(), start), time).condition.icon, 'partly-cloudy');
  const mixed = buildHourlySlot(buildForecastSignals([run('precipitation', [0, 0]), run('precipitation', [1, 1], 'ecmwf_ifs025', 40), run('weather_code', [2]), run('weather_code', [95], 'ecmwf_ifs025', 40)], start), time);
  assert.equal(mixed.precipitation, 0); assert.equal(mixed.condition.icon, 'cloud'); assert.equal(mixed.cached, false);
  const stale = buildHourlySlot(buildForecastSignals([run('precipitation', [0, 1], 'gfs_global', 40), run('weather_code', [61], 'gfs_global', 40)], start), time);
  assert.equal(stale.precipitation, 1); assert.equal(stale.condition.icon, 'rain'); assert.match(stale.condition.description!, /cached/);
  assert.match(stale.accessible.precipitation, /cached/);
});

test('slots retain UTC duration across midnight, 23/25-hour days and repeated local hours', () => {
  for (const [date, count] of [['2026-03-29', 23], ['2026-10-25', 25], ['2026-07-07', 24]] as const) {
    const times = getLocalDayHours(date);
    assert.equal(times.length, count);
    const endpoints = times.map(t => new Date(utc(t) + HOUR).toISOString());
    const signals = buildForecastSignals([{ ...run('precipitation', []), times: endpoints, values: endpoints.map((_, i) => i), runTime: times[0] }], utc(times[0]));
    const slots = times.map(t => buildHourlySlot(signals, t));
    slots.forEach((slot, i) => { assert.equal(slot.end - slot.start, HOUR); assert.equal(slot.precipitation, i); });
    assert.equal(slots.at(-1)!.end, utc(times.at(-1)!) + HOUR);
    if (count === 25) {
      assert.match(localTime(slots[1].start), /01:00 BST/); assert.match(localTime(slots[2].start), /01:00 GMT/);
      assert.notEqual(slots[1].display.interval, slots[2].display.interval);
    }
  }
});

test('hourly card names stay simple while descriptions retain trace, hazard and missing-data context', () => {
  for (const [input, label, description] of [
    [{ ...evidence, codes: [61] }, 'Partly cloudy', /conflicts with zero/],
    [{ ...evidence, codes: [66] }, 'Freezing rain', /shown time/],
    [{ ...evidence, codes: [95] }, 'Thunderstorm', /shown time/],
    [{ ...evidence, codes: [45] }, 'Fog', /shown time/],
    [{ ...evidence, snowfall: 0.1 }, 'Snow', /Snowfall/],
    [{ ...evidence, codes: [], precipitation: 1 }, 'Precipitation', /type uncertain/],
    [{ ...evidence, codes: [51], precipitation: 0.03 }, 'Light drizzle', /Trace precipitation/],
    [{ ...evidence, precipitation: 0.03 }, 'Partly cloudy', /Trace precipitation/],
    [{ ...evidence, codes: [61], precipitation: null }, 'Light rain', /unavailable/],
    [{ ...evidence, codes: [], cloud: null, precipitation: null }, 'Unavailable', /unavailable/],
  ] as const) {
    const condition = getHourlyCondition(input);
    assert.equal(condition.label, label);
    assert.match(condition.description!, description);
  }
});
