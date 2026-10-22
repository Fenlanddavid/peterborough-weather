import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOUR } from '../src/data/contracts.ts';
import { evaluateVerification } from '../src/verification/verification.ts';
import type { Observation, VerificationForecast } from '../src/verification/verification.ts';
import { compactForecasts, compactResults, expandForecasts, verificationIsRecent, VERIFICATION_RETENTION_MS } from '../scripts/lib/verificationArchive.ts';

const now = Date.parse('2026-10-22T12:00Z');
const station = { id: 'EGXT', name: 'Wittering', latitude: 52.611, longitude: -0.461, elevation: 74 };
const forecast = (validTime = now - HOUR, value = 10.125): VerificationForecast => ({ modelId: 'gfs_global', family: 'NOAA', validTime, leadHours: 24, value, variable: 'temperature', station, forecastLocation: { latitude: 52.6, longitude: -0.5, elevation: 70 }, provider: 'Open-Meteo Previous Runs', issuedAt: null, sourceTime: null, fetchedAt: now, unit: '°C', measurementCompatible: true });
const observation = (time: number): Observation => ({ station, id: String(time), time, reportTime: null, type: 'METAR', temperature: 9, wind: null, gust: null, direction: null, raw: 'synthetic', fetchedAt: now });

test('legacy migration retains temperature, raw values, locations and identical evaluator results', () => {
  const rows = [forecast(now - 2 * HOUR), forecast(), { ...forecast(), modelId: 'ecmwf_ifs025', family: 'ECMWF' as const }, { ...forecast(), variable: 'wind' as const, unit: 'm/s' as const, measurementCompatible: false }];
  const compact = compactForecasts(expandForecasts({ station, forecasts: rows }), station, now);
  const restored = expandForecasts(compact);
  assert.equal(compact.version, 2); assert.equal(compact.rows.length, 3);
  assert.equal(compact.rows.at(-1)![1], (now - HOUR) / 1000);
  assert.equal(compact.rows.at(-1)![3], 10.125);
  assert.deepEqual(compact.locations.gfs_global, forecast().forecastLocation);
  assert.ok(restored.every(row => row.variable === 'temperature' && row.unit === '°C' && row.measurementCompatible));
  assert.deepEqual(evaluateVerification(restored, rows.map(row => observation(row.validTime)), now), evaluateVerification(rows, rows.map(row => observation(row.validTime)), now));
  assert.equal(JSON.stringify(compact), JSON.stringify(compactForecasts(rows.map(row => ({ ...row, fetchedAt: now + HOUR })), station, now)));
  assert.equal('collectedAt' in compact, false);
  assert.equal('fetchedAt' in compact, false);
});

test('100-day retention drops old forecasts, keeps the boundary, and de-duplicates repeated offsets', () => {
  const compact = compactForecasts([forecast(now - VERIFICATION_RETENTION_MS - 1), forecast(now - VERIFICATION_RETENTION_MS), forecast(), forecast()], station, now);
  assert.equal(compact.rows.length, 2);
  assert.equal(compact.rows[0][1], (now - VERIFICATION_RETENTION_MS) / 1000);
  const boundary = expandForecasts(compact)[0];
  assert.equal(boundary.validTime, now - VERIFICATION_RETENTION_MS);
});

test('daily gate skips only a valid result newer than 20 hours; exactly 20 hours retries', () => {
  const product = { station, results: [], collectedAt: now - 20 * HOUR + 1 };
  assert.equal(verificationIsRecent(product, now), true);
  for (const collectedAt of [now - 20 * HOUR, now + HOUR, NaN]) assert.equal(verificationIsRecent({ ...product, collectedAt }, now), false);
  assert.equal(verificationIsRecent(null, now), false);
});

test('hourly evaluation migration keeps the latest per UTC collection date and preserves client fields exactly', () => {
  const old = evaluateVerification([forecast()], [observation(now - HOUR)], now);
  const latest = evaluateVerification([forecast(now - HOUR, 12)], [observation(now - HOUR)], now);
  const product = { station, results: latest, sourceTime: now - HOUR, collectedAt: now, evaluations: [
    { time: now - VERIFICATION_RETENTION_MS - 24 * HOUR, results: old },
    { time: now - 24 * HOUR, results: old }, { time: now - HOUR, results: old }, { time: now, results: latest },
  ] };
  const compact = compactResults(product, now);
  assert.deepEqual(compact.results, latest); assert.equal(compact.station, station); assert.equal(compact.collectedAt, now); assert.equal(compact.sourceTime, product.sourceTime);
  assert.equal('evaluations' in compact, false); assert.equal(compact.daily!.length, 2);
  assert.deepEqual(compact.daily!.at(-1), { date: '2026-10-22', modelId: 'gfs_global', leadHours: 24, n: latest[0].metrics.n, mae: latest[0].metrics.mae, bias: latest[0].metrics.bias });
  assert.deepEqual(compactResults(compact, now), compact, 'unchanged daily gate does not churn the results file');
  const tomorrow = compactResults({ ...compact, collectedAt: now + 24 * HOUR }, now + 24 * HOUR);
  assert.equal(tomorrow.daily!.length, 3);
});

test('malformed versions and compact values fail rather than silently emptying the archive', () => {
  const compact = compactForecasts([forecast()], station, now);
  for (const changed of [{ version: 3 }, { rows: null }, { rows: [['gfs_global', NaN, 24, 10]] }, { locations: {} }]) {
    assert.throws(() => expandForecasts({ ...compact, ...changed } as typeof compact), RangeError);
  }
});
