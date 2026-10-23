import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blendValue, blendWeights, defaultFamilyFactor, leadBand, familyMean, DEFAULT_VERSION } from '../src/forecast/policy.ts';
import { buildForecastSignals } from '../src/forecast/signals.ts';
import { matchLearning, newLearningState, predictCase, validateLearningState } from '../src/verification/learning.ts';
import type { LearningCase } from '../src/verification/learning.ts';
import { HOUR } from '../src/data/contracts.ts';
import type { CachedRun } from '../src/types.ts';
const sources = [{ modelId: 'ecmwf_ifs025', family: 'ECMWF' as const, value: 0 }, { modelId: 'gfs_global', family: 'NOAA' as const, value: 6 }, { modelId: 'ukmo_global_deterministic_10km', family: 'UKMO' as const, value: 12 }];
test('lead bands include negative and beyond-seven-day leads and exact boundaries', () => {
  for (const [lead, band] of [[-1, 0], [0, 0], [5.99, 0], [6, 1], [24, 2], [48, 3], [120, 4], [168, 4], [170, 4]]) assert.equal(leadBand(lead), band);
});
test('default prior ramps ECMWF only; learned factors multiply it, and repeated models cannot gain allocation', () => {
  for (const [lead, factor] of [[-1, 1], [48, 1], [72, 1.5], [96, 2], [170, 2]]) assert.equal(defaultFamilyFactor('ECMWF', lead), factor);
  assert.equal(defaultFamilyFactor('NOAA', 170), 1); assert.equal(defaultFamilyFactor('UKMO', 170), 1);
  assert.equal(blendValue(sources, undefined, 48), familyMean(sources));
  assert.equal(blendValue(sources, undefined, 96), 4.5);
  const rule = { variable: 'temperature_2m' as const, band: 4, location: 'peterborough', familyFactors: { ECMWF: 1.25 }, modelFactors: {}, metOfficeShare: 0.5, temperatureCorrection: 0, occurrenceSlope: 1, occurrenceIntercept: 0 };
  const weights = blendWeights([...sources, sources[0]], rule, 120);
  assert.ok(Math.abs(weights.filter(w => w.source.family === 'ECMWF').reduce((s, w) => s + w.weight, 0) - 2.5 / 4.5) < 1e-12);
  assert.equal(blendValue([...sources, sources[0]], undefined, 120), 4.5);
});
test('point, period and public blend central paths use valid-start lead, while agreement stays equal-family', () => {
  const now = Date.parse('2026-10-23T00:00Z');
  const valid = now + 96 * HOUR;
  for (const variable of ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'precipitation'] as const) {
    const preceding = ['precipitation', 'wind_gusts_10m'].includes(variable);
    const time = valid + (preceding ? HOUR : 0);
    const runs: CachedRun[] = sources.map(s => ({ key: s.modelId, modelId: s.modelId, runTime: new Date(now).toISOString(), variable, fetchedAt: now, times: [new Date(time).toISOString()], values: [s.value] }));
    const signals = buildForecastSignals(runs, now);
    const expected = variable === 'cloud_cover' ? 0.045 : 4.5;
    assert.equal(signals.mean(variable, time), expected);
    assert.equal(signals.blend(variable, signals.samples(variable, time), valid, time), expected);
    assert.equal(signals.blendPeriod(variable, [time], 'max'), expected);
    assert.equal(signals.agreement({ variable, operation: 'point', threshold: variable === 'cloud_cover' ? 0.05 : 5, label: 'test' }, time, time).value, 2 / 3);
  }
});
test('learning predictions use the central prior but probability predictions keep equal families; old state is rejected', () => {
  const row = { sources, variable: 'temperature_2m', leadHours: 120 } as LearningCase;
  assert.equal(predictCase(row), 4.5);
  assert.equal(predictCase({ ...row, variable: 'precipitation_probability', sources: sources.map(s => ({ ...s, value: s.value / 12 })) }), 0.5);
  assert.equal(validateLearningState(newLearningState()).defaultVersion, DEFAULT_VERSION);
  assert.throws(() => validateLearningState({ ...newLearningState(), defaultVersion: 'equal-family-metoffice-half-v1' }));
  assert.deepEqual(matchLearning([{ ...row, defaultVersion: 'old' }], []), []);
});
