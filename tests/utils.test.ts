import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLatestIndex, getTrendValue, parseUtc, sixHourPrecipTotal } from '../src/metrics/utils.ts';
import type { CachedRun } from '../src/types.ts';

const hours = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}Z`) + i * 3600_000).toISOString().slice(0, 16));

function run(variable: CachedRun['variable'], runTime: string, times: string[], values: (number | null)[], modelId = 'ecmwf_ifs025'): CachedRun {
  return { key: `${modelId}__${runTime}__${variable}`, modelId, runTime, variable, times, values, fetchedAt: 0 };
}

test('parses Open-Meteo times as UTC regardless of device time zone', () => {
  assert.equal(parseUtc('2026-07-01T06:00'), Date.UTC(2026, 6, 1, 6));
});

test('six-hour rain total covers the six UTC hours ending at the valid time (BST date)', () => {
  const times = hours('2026-07-01T00:00', 12);
  const values = times.map((_, i) => i); // 0..11 mm, one per hour
  const total = sixHourPrecipTotal(run('precipitation', '2026-07-01T00:00', times, values), '2026-07-01T06:00');
  assert.equal(total.value, 1 + 2 + 3 + 4 + 5 + 6);
  assert.equal(total.complete, true);
});

test('trend value uses the 6h total for rain and the instant value for temperature', () => {
  const times = hours('2026-07-01T00:00', 12);
  assert.equal(getTrendValue(run('precipitation', '2026-07-01T00:00', times, times.map(() => 0.5)), '2026-07-01T06:00'), 3);
  assert.equal(getTrendValue(run('temperature_2m', '2026-07-01T00:00', times, times.map((_, i) => i)), '2026-07-01T06:00'), 6);
  // An incomplete window is unknown, not a smaller total
  assert.equal(getTrendValue(run('precipitation', '2026-07-01T00:00', times, times.map(() => 0.5)), '2026-07-01T03:00'), null);
});

test('latest index prefers the newest run and fills its gaps from the previous run', () => {
  const times = hours('2026-07-01T06:00', 3);
  const index = buildLatestIndex([
    run('temperature_2m', '2026-07-01T00:00', times, [10, 11, 12]),
    run('temperature_2m', '2026-07-01T06:00', times, [20, null, null]),
  ]);
  assert.equal(index.value('ecmwf_ifs025', 'temperature_2m', times[0]), 20);
  assert.equal(index.value('ecmwf_ifs025', 'temperature_2m', times[1]), 11);
});
