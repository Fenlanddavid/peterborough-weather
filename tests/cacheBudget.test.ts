import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { budgetDecision, estimatedCost, scheduledFetch, usageToday, HttpError } from '../src/data/scheduler.ts';
import { resource } from '../src/data/resource.ts';
import { HOUR } from '../src/data/contracts.ts';
const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => { globalThis.fetch = originalFetch; if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
function storage() { const values = new Map<string, string>(); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } }); return values; }
test('verified endpoint-specific member/variable/time counting, conservative rounding and metadata exemption', () => {
  assert.equal(estimatedCost('https://ensemble-api.open-meteo.com/v1/ensemble?models=ecmwf_ifs025&hourly=temperature_2m,precipitation,wind_gusts_10m,snowfall,cloud_cover&forecast_days=9'), 26);
  assert.equal(estimatedCost('https://ensemble-api.open-meteo.com/v1/ensemble?models=gfs025&hourly=a,b,c,d,e&forecast_days=9'), 16);
  assert.equal(estimatedCost('https://ensemble-api.open-meteo.com/v1/ensemble?models=ukmo_global_ensemble_20km&hourly=a,b,c,d,e&forecast_days=9'), 9);
  assert.equal(estimatedCost('https://api.open-meteo.com/data/ncep_gefs025/static/meta.json'), 0);
  assert.equal(estimatedCost('https://single-runs-api.open-meteo.com/v1/forecast?models=gfs_global&hourly=a,b,c&forecast_days=7'), 1);
});
test('optional reserve, daily hard limit and rolling minute cap apply to all refresh paths', () => {
  const now = Date.parse('2026-10-21T12:00Z');
  const usage = { blockedUntil: 0, entries: [{ time: now - HOUR, weighted: 1499, http: 1, endpoint: 'test' }] };
  assert.match(budgetDecision(usage, 2, true, now)!, /Optional/); assert.equal(budgetDecision(usage, 2, false, now), null);
  usage.entries[0].weighted = 1999; assert.match(budgetDecision(usage, 2, false, now)!, /Daily/);
  usage.entries[0] = { ...usage.entries[0], time: now, weighted: 300 }; assert.match(budgetDecision(usage, 1, false, now)!, /minute/);
});
test('in-flight deduplication shares a response without double-counting usage', async () => {
  storage(); let count = 0;
  globalThis.fetch = async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); return Response.json({ value: 3 }); };
  const url = 'https://api.open-meteo.com/v1/forecast?hourly=temperature_2m&dedupe=test';
  const [a, b] = await Promise.all([scheduledFetch(url), scheduledFetch(url)]);
  assert.equal(count, 1); assert.deepEqual(await a.json(), { value: 3 }); assert.deepEqual(await b.json(), { value: 3 }); assert.equal(usageToday().http, 1);
});
test('429 Retry-After persists backoff; subsequent requests are blocked before fetch', async () => {
  storage(); let count = 0;
  globalThis.fetch = async () => { count++; return new Response('limited', { status: 429, headers: { 'Retry-After': '60' } }); };
  await assert.rejects(scheduledFetch('https://api.open-meteo.com/v1/forecast?429=1'), error => error instanceof HttpError && error.status === 429);
  await assert.rejects(scheduledFetch('https://api.open-meteo.com/v1/forecast?429=2'), /backoff/);
  assert.equal(count, 1);
});
test('bounded transient retry counts HTTP attempts separately and successful data survives storage failure', async () => {
  storage(); let count = 0;
  globalThis.fetch = async () => ++count === 1 ? new Response('retry', { status: 503, headers: { 'Retry-After': '0' } }) : Response.json({ ok: true });
  const response = await scheduledFetch('https://api.open-meteo.com/v1/forecast?transient=1');
  assert.equal((await response.json()).ok, true); assert.equal(usageToday().http, 2);
  const result = await resource('test:volatile-resource', 0, async () => ({ sourceTime: 123, value: 8 }));
  assert.equal(result.data?.value, 8); assert.ok(result.storageError);
  const failed = await resource('test:volatile-resource', 0, async () => { throw new HttpError(404, 'wrong path'); }, true);
  assert.equal(failed.status, 'http-error'); assert.equal(failed.data?.sourceTime, 123); assert.equal(failed.stale, true); assert.match(failed.error!, /wrong path/);
});
test('source result distinguishes unsupported, malformed, rate-limited and offline without erasing cache', async () => {
  for (const [key, error, status] of [['unsupported', new HttpError(400, 'bad variable'), 'unsupported'], ['invalid', new RangeError('schema'), 'invalid-data'], ['limited', new HttpError(429, 'limited'), 'rate-limited'], ['network', new TypeError('offline'), 'network-error']] as const) {
    const result = await resource(`test:${key}`, 0, async () => { throw error; });
    assert.equal(result.status, status); assert.equal(result.data, null); assert.ok(result.error);
  }
});

test('an overlapping new subscriber retries an abandoned request without persisting cancellation as a source failure', async () => {
  const abandoned = resource('test:cancelled-resource', 0, async () => { await new Promise(resolve => setTimeout(resolve, 10)); throw new DOMException('tab closed', 'AbortError'); });
  const follower = resource('test:cancelled-resource', 0, async () => ({ value: 7 }));
  assert.equal((await abandoned).cancelled, true);
  const result = await follower;
  assert.equal(result.data?.value, 7); assert.equal(result.error, null); assert.equal(result.cancelled, undefined);
});

test('failed ensemble checks keep the three-hour default cadence across remounts', async () => {
  storage(); let requests = 0;
  globalThis.fetch = async () => { requests++; throw new TypeError('offline'); };
  const { fetchEnsemble } = await import('../src/forecast/ensembles.ts');
  const first = await fetchEnsemble('gfs025');
  assert.equal(first.status, 'network-error'); assert.equal(first.data, null);
  const count = requests;
  const again = await fetchEnsemble('gfs025');
  assert.equal(again.checkedAt, first.checkedAt); assert.equal(requests, count);
});
