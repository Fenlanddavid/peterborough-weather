import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSeasonalData } from '../src/api/seasonal.ts';
import { upcomingKpForecast, fetchAuroraData } from '../src/api/aurora.ts';
import { getRelevantShowers } from '../src/astro/events.ts';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let saved: Map<string, string>;

beforeEach(() => {
  saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('requests monthly SEAS5 and weekly EC46, retaining the current month on a common rainfall scale', async () => {
  const requests: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    return Response.json(url.searchParams.has('monthly') ? { monthly: {
      time: ['2026-10-01', '2026-11-01', '2026-12-01'],
      temperature_2m_anomaly: [1.2, -0.5, 0], precipitation_mean: [62, 60, 31], precipitation_anomaly: [31, -30, 0],
    } } : { weekly: {
      time: ['2026-10-12', '2026-10-19', '2026-10-26'],
      temperature_2m_anomaly: [99, -1, -0.5], precipitation_mean: [99, 14, 28], precipitation_anomaly: [99, -7, -3.5],
    } });
  };
  const data = await fetchSeasonalData('2026-10-19');
  assert.equal(requests.length, 2);
  assert.equal(requests.find((u) => u.searchParams.get('models') === 'ecmwf_seas5')?.searchParams.get('forecast_days'), '210');
  assert.equal(requests.find((u) => u.searchParams.get('models') === 'ecmwf_ec46')?.searchParams.get('forecast_days'), '46');
  assert.deepEqual(data.months.map((m) => m.month), ['2026-10', '2026-11', '2026-12']);
  assert.equal(data.months[0].tempAnomalies.get('ecmwf_ec46'), -0.75);
  assert.equal(data.months[0].precipAnomalies.get('ecmwf_seas5'), 7);
  assert.equal(data.months[0].precipTotals.get('ecmwf_seas5'), 14);
  assert.equal(data.months[1].tempAnomalies.size, 1);
  assert.equal(data.months[2].tempMean, 0);
  await fetchSeasonalData('2026-10-19');
  assert.equal(requests.length, 2);
  await fetchSeasonalData('2026-10-19', true);
  assert.equal(requests.length, 4);
});

test('keeps a working system when the other is empty and rejects all-empty responses', async () => {
  globalThis.fetch = async (input) => Response.json(String(input).includes('ecmwf_seas5') ? {} : { weekly: {
    time: ['2026-10-19'], temperature_2m_anomaly: [null], precipitation_anomaly: [2],
  } });
  const data = await fetchSeasonalData('2026-10-19', true);
  assert.equal(data.models.length, 1);
  assert.equal(data.months[0].precipMean, 2);
  globalThis.fetch = async () => Response.json({});
  await assert.rejects(fetchSeasonalData('2026-10-19', true));
});

test('excludes historical storms from the future aurora outlook', async () => {
  const now = Date.parse('2026-10-19T20:00:00Z');
  const entries = [
    { time: '2026-10-12T00:00:00', kp: 9, observed: true },
    { time: '2026-10-19T15:00:00', kp: 8, observed: false },
    { time: '2026-10-19T18:00:00', kp: 3, observed: false },
    { time: '2026-10-19T21:00:00', kp: 4, observed: false },
    { time: '2026-10-23T00:00:00', kp: 8, observed: false },
  ];
  assert.deepEqual(upcomingKpForecast(entries, now).map((e) => e.kp), [3, 4]);
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await fetchAuroraData(true), null);
});

test('an active shower after its peak is no longer labelled peak approaching', () => {
  const showers = getRelevantShowers('2026-10-19');
  assert.equal(showers.find((s) => s.name === 'Southern Taurids')?.status, 'Active now');
  assert.equal(showers.find((s) => s.name === 'Orionids')?.status, 'Peak approaching');
});
