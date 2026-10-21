import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMetars, matchForecasts, evaluateVerification, errorMetrics, subsetGate, VERIFICATION_CONFIG } from '../src/verification/verification.ts';
import type { Observation, VerificationForecast } from '../src/verification/verification.ts';
import { HOUR } from '../src/data/contracts.ts';
const station = { id: 'EGXT', name: 'Wittering', latitude: 52.611, longitude: -0.461, elevation: 74 };
const base = Date.parse('2026-10-01T00:00Z');
const observation = (time: number): Observation => ({ station, id: String(time), time, reportTime: null, type: 'METAR', temperature: 10, wind: 3, gust: null, direction: 'VRB', raw: 'synthetic', fetchedAt: time });
const forecast = (time: number, value = 12): VerificationForecast => ({ modelId: 'gfs_global', family: 'NOAA', validTime: time, leadHours: 24, variable: 'temperature', value, station, forecastLocation: station, provider: 'Open-Meteo Previous Runs', issuedAt: null, sourceTime: null, fetchedAt: time + HOUR, unit: '°C', measurementCompatible: true });
test('real METAR reports retain station location/elevation, raw text and absent gusts as missing', async () => {
  const data = JSON.parse(await readFile(new URL('fixtures/live/metar.response.txt', import.meta.url), 'utf8'));
  const rows = parseMetars(data);
  assert.ok(rows.length); assert.equal(rows[0].station.elevation, 74); assert.equal(rows[0].station.latitude, 52.611);
  assert.ok(rows.some(o => o.gust === null)); assert.ok(rows.every(o => o.raw.includes('EGXT')));
  const variable = parseMetars([{ ...data[0], wdir: 'VRB', wspd: undefined, wgst: undefined }]);
  assert.equal(variable[0].direction, 'VRB'); assert.equal(variable[0].wind, null); assert.equal(variable[0].gust, null);
});
test('nearest report within 30 minutes, one report per UTC hour, no Peterborough/station substitution', () => {
  const observations = [observation(base - 10 * 60_000), { ...observation(base - 5 * 60_000), id: 'SPECI', type: 'SPECI' }, observation(base + 40 * 60_000)];
  const matched = matchForecasts([forecast(base), forecast(base + HOUR)], observations);
  assert.equal(matched.length, 2); assert.equal(matched[0].observation.id, 'SPECI'); assert.equal(matched[0].offsetMinutes, -5); assert.notEqual(matched[0].observation.id, matched[1].observation.id);
  assert.equal(matchForecasts([{ ...forecast(base), station: { ...station, latitude: 52.5736 } }], observations).length, 0);
  assert.equal(matchForecasts([{ ...forecast(base), variable: 'wind', measurementCompatible: false }], observations).length, 0);
});
test('MAE, MSE and forecast-minus-observation bias preserve sign and unknown empty metrics', () => {
  assert.deepEqual(errorMetrics([]), { n: 0, days: 0, mae: null, mse: null, bias: null });
  const metrics = errorMetrics([{ error: 2, forecast: { validTime: base } }, { error: -1, forecast: { validTime: base + HOUR } }]);
  assert.equal(metrics.mae, 1.5); assert.equal(metrics.mse, 2.5); assert.equal(metrics.bias, 0.5);
});
test('proposals require training dates and hours, remain capped/disabled and use subsequent held-out dates', () => {
  const now = base + 40 * 24 * HOUR;
  const times = Array.from({ length: 37 * 12 }, (_, i) => base + 3 * 24 * HOUR + i * 2 * HOUR);
  const forecasts = times.map(t => forecast(t, 15));
  const observations = times.map(observation);
  const result = evaluateVerification(forecasts, observations, now)[0];
  assert.ok(result.training.n >= 200); assert.ok(result.training.days >= 20); assert.equal(result.proposal, 3); assert.equal(result.enabled, false);
  assert.equal(result.heldOutRaw.mae, 5); assert.equal(result.heldOutProposed?.mae, 2); assert.equal(result.heldOutBaseline.mae, 5);
  const sparse = evaluateVerification(forecasts.slice(0, 20), observations, now)[0]; assert.equal(sparse.proposal, null);
  assert.equal(VERIFICATION_CONFIG.automaticCorrection, false); assert.equal(VERIFICATION_CONFIG.automaticReweighting, false); assert.equal(VERIFICATION_CONFIG.transferStationBiasToPeterborough, false);
  assert.equal(subsetGate(matchForecasts(forecasts.slice(0, 20), observations)), false);
});
