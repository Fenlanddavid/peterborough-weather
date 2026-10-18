import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTeleconnections, readTeleconnections } from '../src/api/teleconnections.ts';
import { classifyTeleconnections } from '../src/metrics/regime.ts';
import { monthlySummary } from '../src/metrics/monthly.ts';

const cacheKey = 'pb-weather:teleconnections:v2';
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const main = { nao: { value: -1.6, phase: 'neg', updated: '2026-10-16' }, ao: { value: -1.1, updated: '2026-10-16' } };
const mjo = { latest: { phase: 7, amplitude: 2.1, rmm1: 1.2, rmm2: 1.7, date: '2026-10-16' } };
let saved: Map<string, string>;

function respond(mainBody: unknown = main, mjoBody: unknown = mjo) {
  globalThis.fetch = async (url) => Response.json(String(url).endsWith('/mjo') ? mjoBody : mainBody);
}

beforeEach(() => {
  saved = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) },
  });
  respond();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('parses the live API shape without treating index sign as a trend', async () => {
  const snapshot = await fetchTeleconnections();
  assert.equal(snapshot.nao?.value, -1.6);
  assert.equal(snapshot.nao?.trend, undefined);
  assert.equal(snapshot.mjo?.phase, 7);
  assert.equal(classifyTeleconnections(snapshot).regime.id, 'greenland-block');
  assert.deepEqual(readTeleconnections(), snapshot);
});

test('deduplicates concurrent callers and reuses the successful cache', async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return Response.json(String(url).endsWith('/mjo') ? mjo : main);
  };
  const first = fetchTeleconnections();
  assert.equal(fetchTeleconnections(), first);
  await first;
  await fetchTeleconnections();
  assert.equal(calls, 2);
});

test('rejects total failure, preserves saved data, and retries without caching failure', async () => {
  const snapshot = await fetchTeleconnections();
  const cache = saved.get(cacheKey);
  globalThis.fetch = async () => { throw new TypeError('Offline'); };
  await assert.rejects(fetchTeleconnections(true), /unavailable/);
  assert.equal(saved.get(cacheKey), cache);
  assert.deepEqual(readTeleconnections(), snapshot);
  saved.clear();
  await assert.rejects(fetchTeleconnections(), /unavailable/);
  assert.equal(saved.size, 0);
  respond();
  assert.equal((await fetchTeleconnections()).nao?.value, -1.6);
});

test('keeps usable indices when the MJO endpoint fails and preserves the complete cache', async () => {
  await fetchTeleconnections();
  const cache = saved.get(cacheKey);
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/mjo')) throw new TypeError('Offline');
    return Response.json(main);
  };
  const snapshot = await fetchTeleconnections(true);
  assert.equal(snapshot.nao?.value, -1.6);
  assert.equal(snapshot.mjo, null);
  assert.equal(saved.get(cacheKey), cache);
});

test('does not infer a regime from missing indices when only MJO is available', async () => {
  globalThis.fetch = async (url) => String(url).endsWith('/mjo')
    ? Response.json(mjo) : new Response(null, { status: 503 });
  const context = classifyTeleconnections(await fetchTeleconnections());
  assert.equal(context.regime.id, 'unavailable');
  assert.equal(context.mjoOutlook?.phase, 7);
});

test('rejects malformed payloads and invalid MJO phases', async () => {
  for (const payload of [null, [], { nao: { value: '1.2' } }, { nao: { value: null } }]) {
    respond(payload, { latest: { ...mjo.latest, phase: 9 } });
    await assert.rejects(fetchTeleconnections(), /unavailable/);
  }
  assert.equal(saved.size, 0);
});

test('keeps expired data available offline while trying to refresh it', async () => {
  const snapshot = await fetchTeleconnections();
  const fetchedAt = Date.now() - 7 * 3600_000;
  const stale = { ...snapshot, fetchedAt };
  saved.set(cacheKey, JSON.stringify({ data: stale, fetchedAt }));
  assert.deepEqual(readTeleconnections(), stale);
  globalThis.fetch = async () => { throw new TypeError('Offline'); };
  await assert.rejects(fetchTeleconnections(), /unavailable/);
  assert.deepEqual(readTeleconnections(), stale);
});

test('ignores corrupt cached data and still loads fresh data', async () => {
  for (const value of ['{', '{"fetchedAt":1}', JSON.stringify({ fetchedAt: Date.now(), data: { nao: { value: 'bad' } } })]) {
    saved.set(cacheKey, value);
    assert.equal(readTeleconnections(), null);
  }
  assert.equal((await fetchTeleconnections()).nao?.value, -1.6);
});


test('does not cache a partial response when an endpoint returns malformed JSON data', async () => {
  await fetchTeleconnections();
  const cache = saved.get(cacheKey);
  respond(main, null);
  const partial = await fetchTeleconnections(true);
  assert.equal(partial.nao?.value, -1.6);
  assert.equal(partial.mjo, null);
  assert.equal(saved.get(cacheKey), cache);
});

test('limits MJO temperature interpretation to winter outlooks', async () => {
  const context = classifyTeleconnections(await fetchTeleconnections());
  const weeks = ['2026-12-07', '2026-12-14', '2026-12-21', '2026-12-28'].map((date) => ({
    date, temperatureAnomaly: -2, rainfallMm: 10, rainfallAnomaly: 0,
  }));
  assert.match(monthlySummary(weeks, context), /may support this temperature signal/);
  assert.doesNotMatch(monthlySummary(weeks.map((week) => ({ ...week, date: week.date.replace('-12-', '-07-') })), context), /MJO/);
  assert.doesNotMatch(monthlySummary(weeks, null), /MJO/);
});
