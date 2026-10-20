import test from 'node:test';
import assert from 'node:assert/strict';
import { getRunTasks, makeRunKey } from '../src/api/runSchedule.ts';
import type { CachedRun } from '../src/types.ts';

const now = Date.parse('2026-10-20T15:00:00Z');

function fullCache(): CachedRun[] {
  return getRunTasks([], now).flatMap(({ modelId, runTime, variables }) => variables.map((variable) => ({
    key: makeRunKey(modelId, runTime, variable), modelId, runTime, variable,
    times: ['2026-10-21T12:00'], values: [1], fetchedAt: now,
  })));
}

test('recently checked complete runs do not trigger requests', () => {
  assert.deepEqual(getRunTasks(fullCache(), now), []);
});

test('backfills each missing core variable in a mature cached run', () => {
  const modelId = 'ecmwf_ifs025';
  const runTime = '2026-10-18T00:00';
  const cache = fullCache().map((run) => run.modelId === modelId && run.runTime === runTime
    ? { ...run, fetchedAt: now - 3600_000 } : run);

  for (const variable of ['precipitation', 'pressure_msl', 'wind_speed_10m', 'wind_gusts_10m'] as const) {
    const partial = cache.filter((run) => run.key !== makeRunKey(modelId, runTime, variable));
    const tasks = getRunTasks(partial, now);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].modelId, modelId);
    assert.equal(tasks[0].runTime, runTime);
    assert.ok(tasks[0].variables.includes(variable));
  }
});

test('missing variables respect the retry interval, then become eligible', () => {
  const modelId = 'ecmwf_ifs025';
  const runTime = '2026-10-18T00:00';
  const cache = fullCache().filter((run) => run.key !== makeRunKey(modelId, runTime, 'precipitation'));
  assert.deepEqual(getRunTasks(cache, now + 29 * 60_000), []);
  assert.ok(getRunTasks(cache, now + 30 * 60_000).some((task) => task.modelId === modelId && task.runTime === runTime));
});

test('backfills cloud cover for recent runs without fetching extras for older runs or UKV', () => {
  const cache = fullCache().filter((run) => run.variable !== 'cloud_cover').map((run) => ({
    ...run, fetchedAt: now - 3600_000,
  }));
  const tasks = getRunTasks(cache, now);
  const extraTasks = tasks.filter((task) => task.variables.includes('cloud_cover'));
  assert.equal(extraTasks.length, 5 * 4);
  assert.ok(extraTasks.every((task) => task.modelId !== 'ukmo_uk_deterministic_2km' && task.runTime >= '2026-10-19T18:00'));
});

test('still-publishing runs are checked again even when every variable is cached', () => {
  const modelId = 'ecmwf_ifs025';
  const runTime = '2026-10-20T06:00';
  const cache = fullCache().map((run) => run.modelId === modelId && run.runTime === runTime
    ? { ...run, fetchedAt: now - 3600_000 } : run);
  const tasks = getRunTasks(cache, now);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].runTime, runTime);
});
