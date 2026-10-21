import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastBriefing } from '../src/metrics/forecastSummary.ts';
import { getLocalDayHours } from '../src/hooks/useLocalTime.ts';
import type { CachedRun } from '../src/types.ts';
const hours = [...getLocalDayHours('2026-10-21'), '2026-10-21T23:00'];
function run(modelId: string, values: (number | null)[], variable: CachedRun['variable'] = 'precipitation'): CachedRun {
  return { key: modelId + variable, modelId, variable, runTime: '2026-10-20T18:00', fetchedAt: Date.parse('2026-10-21T00:00Z'), times: hours, values };
}
test('daily amounts use a complete-window cohort rather than silently switching models each hour', () => {
  const half = hours.length / 2;
  const runs = [run('gfs_global', hours.map((_, i) => i < half ? 0 : null)), run('ecmwf_ifs025', hours.map((_, i) => i < half ? null : 3))];
  const day = buildForecastBriefing(runs, new Date('2026-10-20T23:00Z'), { wholeToday: true }).days[0];
  assert.equal(day.rainMm, null); assert.equal(day.completeModels, 0);
});
test('one wet deterministic model plus four dry retains expected and conditional outcomes without a probability label', () => {
  const models = ['ecmwf_ifs025', 'ecmwf_aifs025_single', 'gfs_global', 'ncep_aigfs025', 'ukmo_global_deterministic_10km'];
  const runs = models.map((m, i) => run(m, hours.map((_, h) => i === 4 && h === 8 ? 3 : 0)));
  const day = buildForecastBriefing(runs, new Date('2026-10-20T23:00Z'), { wholeToday: true }).days[0];
  assert.equal(day.precipitation.basis, 'deterministic-agreement'); assert.equal(day.precipitation.value, 1 / 3);
  assert.equal(day.rainMm, 1); assert.equal(day.precipitation.conditionalAmount, 3);
  assert.ok(day.paragraphs.some(p => /shower|rain/i.test(p)));
});
