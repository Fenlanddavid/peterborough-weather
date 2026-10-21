import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreModel, combineScores, observingWindows, rateNight } from '../src/sky/scoring.ts';
import type { WeatherInput, ScorePeriod } from '../src/sky/scoring.ts';
import { mphToMs, HOUR } from '../src/data/contracts.ts';
import { parseSky } from '../src/sky/weather.ts';
import { readFile } from 'node:fs/promises';
const sky = { time: 0, sunAltitude: -30, moonAltitude: -10, illumination: 1 };
const input: WeatherInput = { modelId: 'gfs_global', family: 'NOAA', cloud: 0, low: 0, mid: 0, high: 0, temperature: 1, dewPoint: 0, humidity: 0.8, visibility: 20_000, aerosol: 0.05, wind: 1, gust: 2, jet: 19.9 };
const p = (start: number, score: number | null, end = start + HOUR): ScorePeriod => ({ start, end, score, families: 2, transparencyKnown: true });
test('nonlinear cloud, radians Moon penalty, transparency and per-model fog disagreement', () => {
  const deep = scoreModel({ ...input, low: 0.2, mid: 0.3, high: 0.4 }, { ...sky, moonAltitude: 30 }, 'deep-sky');
  const expectedCloud = 1 - 0.8 * 0.7 * 0.72;
  assert.ok(Math.abs(deep.cloud! - expectedCloud) < 1e-12);
  assert.ok(Math.abs(deep.value! - 100 * (1 - expectedCloud) * 0.7 * 0.9) < 1e-8);
  const planet = scoreModel(input, { ...sky, moonAltitude: 90 }, 'moon-planets');
  assert.equal(planet.value, 90); assert.equal(planet.jet, 'favourable');
  const fog = scoreModel({ ...input, visibility: 999 }, sky, 'deep-sky');
  assert.equal(fog.value, 0);
  assert.equal(combineScores([planet, { ...fog, modelId: 'ecmwf_ifs025', family: 'ECMWF' }], { value: 0, basis: 'ensemble-probability' }, true), 45);
});
test('missing core stays unknown, missing layers fall back to total, optional inputs remain incomplete', () => {
  assert.equal(scoreModel({ ...input, low: null, cloud: null }, sky, 'deep-sky').value, null);
  assert.equal(scoreModel({ ...input, gust: null }, sky, 'deep-sky').value, null);
  const partial = scoreModel({ ...input, low: null, cloud: 0.5, humidity: null, aerosol: null, visibility: null }, sky, 'deep-sky');
  assert.equal(partial.cloud, 0.5); assert.deepEqual(partial.transparencyInputs, []); assert.equal(partial.value, 50);
  assert.equal(combineScores([partial], { value: null, basis: 'deterministic-agreement' }, true), null);
  assert.equal(combineScores([partial], { value: 0.4, basis: 'deterministic-agreement' }, true), 0);
});
test('gust, dew/frost/fog and jet thresholds use canonical units without the retired surface-wind penalty', () => {
  assert.equal(scoreModel({ ...input, gust: mphToMs(25) }, sky, 'deep-sky').value, 72);
  assert.equal(scoreModel({ ...input, gust: mphToMs(35) }, sky, 'deep-sky').value, 72);
  assert.equal(scoreModel({ ...input, gust: mphToMs(35.01) }, sky, 'deep-sky').value, 0);
  const dew = scoreModel({ ...input, humidity: 0.97, wind: mphToMs(4.99) }, sky, 'moon-planets');
  assert.equal(dew.dew, true); assert.equal(dew.frost, true); assert.equal(dew.radiationFog, true);
  assert.equal(scoreModel({ ...input, wind: mphToMs(8.1) }, sky, 'deep-sky').value, 90);
  assert.equal(scoreModel({ ...input, wind: mphToMs(7) }, sky, 'deep-sky').dew, false);
  assert.equal(scoreModel({ ...input, jet: 20 }, sky, 'moon-planets').jet, 'mixed');
  assert.equal(scoreModel({ ...input, jet: 35 }, sky, 'moon-planets').jet, 'mixed');
  assert.equal(scoreModel({ ...input, jet: 35.01 }, sky, 'moon-planets').jet, 'unfavourable');
});
test('03–06 clear window clips at exact dawn, current time and partial elapsed-hour boundaries', () => {
  const hours = [p(0, 0), p(HOUR, 0), p(2 * HOUR, 0), p(3 * HOUR, 80), p(4 * HOUR, 80), p(5 * HOUR, 80)];
  const dark = { start: 0, end: 5 * HOUR + 40 * 60_000 };
  const result = observingWindows(hours, dark);
  assert.equal(result.best?.start, 3 * HOUR); assert.equal(result.best?.end, dark.end); assert.equal(result.best?.duration, 2 * HOUR + 40 * 60_000);
  const current = observingWindows(hours, dark, 4 * HOUR + 30 * 60_000);
  assert.equal(current.best?.duration, 70 * 60_000);
});
test('missing periods break windows; tie-breaks use duration-weighted means then earlier start', () => {
  const result = observingWindows([p(0, 60), p(HOUR, null), p(2 * HOUR, 80), p(3 * HOUR, 80)], { start: 0, end: 4 * HOUR });
  assert.equal(result.best?.start, 2 * HOUR); assert.equal(result.windows.length, 2);
  const tied = observingWindows([p(0, 80), p(HOUR, null), p(2 * HOUR, 80)], { start: 0, end: 3 * HOUR });
  assert.equal(tied.best?.start, 0);
  assert.equal(observingWindows([p(0, 80), p(2 * HOUR, 80)], { start: 0, end: 3 * HOUR }).windows.length, 2);
});
test('ratings require adequate coverage; twilight-only and wholly unknown transparency cannot be Excellent', () => {
  const excellent = observingWindows([p(0, 90, 5 * HOUR)], { start: 0, end: 5 * HOUR });
  assert.equal(rateNight(excellent), 'Excellent'); assert.equal(rateNight(excellent, true), 'Good');
  const unknownTransparency = observingWindows([{ ...p(0, 90, 5 * HOUR), transparencyKnown: false }], { start: 0, end: 5 * HOUR });
  assert.notEqual(rateNight(unknownTransparency), 'Excellent');
  assert.equal(rateNight(observingWindows([p(0, 95)], { start: 0, end: 5 * HOUR })), 'Limited data');
});
test('real sky fixtures retain unknown IFS visibility, UKMO gaps, units and finite aerosol horizon', async () => {
  const read = async (name: string) => JSON.parse(await readFile(new URL(`fixtures/live/${name}.response.txt`, import.meta.url), 'utf8'));
  const visibility = await read('sky-ecmwf_ifs025-visibility');
  assert.throws(() => parseSky(visibility, 'ecmwf_ifs025', ['visibility']), /No usable/);
  const ukmo = parseSky(await read('sky-ukmo_global_deterministic_10km-cloud_cover'), 'ukmo_global_deterministic_10km', ['cloud_cover']);
  assert.ok(ukmo.warnings.some(w => w.includes('incomplete')));
  const aq = parseSky(await read('air-quality'), 'cams_global', ['aerosol_optical_depth', 'dust']);
  assert.ok(aq.times.length <= 7 * 24); assert.equal(aq.units.dust, 'μg/m³');
});
