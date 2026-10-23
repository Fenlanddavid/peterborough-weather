import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEnsemble, ENSEMBLE_MODELS, rotateSnapshot } from '../src/forecast/ensembles.ts';
import type { EnsembleSnapshot } from '../src/forecast/ensembles.ts';
import { buildEnsembleIndex, PRECIP_3H, SNOW, GUST, FROST, weightedMedian } from '../src/forecast/events.ts';
import { HOUR } from '../src/data/contracts.ts';
const fixture = async (id: string) => JSON.parse(await readFile(new URL(`fixtures/live/${id}.response.txt`, import.meta.url), 'utf8'));
const start = Date.parse('2026-10-21T00:00Z');
/** Synthetic edge-case data, separate from saved live API responses. */
function synthetic(modelId = 'ecmwf_ifs025', expected = 5): EnsembleSnapshot {
  return { provider: 'synthetic test', modelId, issuedAt: null, sourceTime: null, fetchedAt: start, validFrom: start, validTo: start + 6 * HOUR, units: { precipitation: 'mm' }, coverage: 'synthetic', identity: 'test', expected, nativeHours: 1, warnings: [], times: Array.from({ length: 6 }, (_, i) => start + i * HOUR), members: { precipitation: Object.fromEntries(Array.from({ length: expected }, (_, i) => [String(i), [99, 0, 0, 0, 0, 0]])) } };
}
for (const model of ENSEMBLE_MODELS) for (const variable of ['temperature_2m', 'precipitation', 'wind_gusts_10m', 'snowfall', 'cloud_cover'] as const) test(`real ${model.id} ${variable}: members, units, UTC axis and control`, async () => {
  const parsed = parseEnsemble(await fixture(`ensemble-${model.id}-${variable}`), model.id, start);
  assert.equal(Object.keys(parsed.members[variable]!).length, model.expected);
  assert.ok(parsed.members[variable]!['0']);
  assert.equal(parsed.issuedAt, null);
  assert.equal(parsed.times[1] - parsed.times[0], HOUR);
  assert.ok(parsed.warnings.some(w => w.includes('absent')));
});
test('rejects deterministic-only, invalid axes, malformed arrays, conflicting aliases and wrong units', async () => {
  const raw = await fixture('ensemble-ecmwf_ifs025-temperature_2m');
  const deterministic = structuredClone(raw); deterministic.hourly = { time: raw.hourly.time, temperature_2m: raw.hourly.temperature_2m };
  assert.throws(() => parseEnsemble(deterministic, 'ecmwf_ifs025'), /deterministic-only/);
  const duplicate = structuredClone(raw); duplicate.hourly.temperature_2m_member00 = raw.hourly.temperature_2m.map(() => 999); duplicate.hourly_units.temperature_2m_member00 = '°C';
  assert.throws(() => parseEnsemble(duplicate, 'ecmwf_ifs025'), /Conflicting/);
  duplicate.hourly.temperature_2m_member00 = raw.hourly.temperature_2m;
  assert.equal(Object.keys(parseEnsemble(duplicate, 'ecmwf_ifs025').members.temperature_2m!).length, 51);
  const wrong = structuredClone(raw); wrong.hourly_units.temperature_2m = '°F';
  assert.throws(() => parseEnsemble(wrong, 'ecmwf_ifs025'), /units/);
  const short = structuredClone(raw); short.hourly.temperature_2m.pop();
  assert.throws(() => parseEnsemble(short, 'ecmwf_ifs025'), /values/);
  const duplicateTime = structuredClone(raw); duplicateTime.hourly.time[1] = duplicateTime.hourly.time[0];
  assert.throws(() => parseEnsemble(duplicateTime, 'ecmwf_ifs025'), /UTC hours/);
});
test('sums within each member over preceding intervals, then counts complete outcomes', () => {
  const s = synthetic();
  s.members.precipitation!['0'] = [99, 0.1, 0.1, 0, 0, 0];
  s.members.precipitation!['1'] = [99, 0, 0, 0.2, 0, 0];
  s.members.precipitation!['4'] = [99, null, 0, 0, 0, 0];
  const e = buildEnsembleIndex([s]).event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(e.value, 0.5); assert.equal(e.usable, 4); assert.equal(e.status, 'partial');
  assert.ok(Math.abs(e.expectedAmount! - 0.1) < 1e-12);
  assert.equal(e.conditionalAmount, 0.2);
  s.members.precipitation!['3'][1] = null;
  const unavailable = buildEnsembleIndex([s]).event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(unavailable.value, null); assert.equal(unavailable.expectedAmount, null); assert.equal(unavailable.conditionalAmount, null);
});
test('eligible all-dry outcomes give zero probability and no conditional wet amount; empty remains unknown', () => {
  const dry = buildEnsembleIndex([synthetic()]).event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(dry.value, 0); assert.equal(dry.expectedAmount, 0); assert.equal(dry.conditionalAmount, null);
  const empty = buildEnsembleIndex([]).event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(empty.value, null); assert.equal(empty.expectedAmount, null);
});
test('systems receive equal total weight despite different member counts, including conditional amounts', () => {
  const big = synthetic('ecmwf_ifs025', 51); const small = synthetic('ukmo_global_ensemble_20km', 18);
  for (const a of Object.values(big.members.precipitation!)) a[1] = 1;
  const e = buildEnsembleIndex([big, small]).event(PRECIP_3H, start, start + 3 * HOUR);
  assert.equal(e.value, 0.5); assert.equal(e.expectedAmount, 0.5); assert.equal(e.conditionalAmount, 1);
  for (const a of Object.values(small.members.precipitation!)) a[1] = 3;
  assert.equal(buildEnsembleIndex([big, small]).event(PRECIP_3H, start, start + 3 * HOUR).conditionalAmount, 2);
  assert.equal(weightedMedian([{ value: 1, weight: 1 }, { value: 3, weight: 1 }]), 2);
});
test('gust maximum, temperature minimum and snowfall sum are computed within each member', () => {
  const s = synthetic();
  s.members.wind_gusts_10m = Object.fromEntries(Object.keys(s.members.precipitation!).map(id => [id, [0, 1, 20, 1, 0, 0]]));
  s.members.temperature_2m = Object.fromEntries(Object.keys(s.members.precipitation!).map(id => [id, [2, 1, -0.1, 3, 4, 5]]));
  s.members.snowfall = Object.fromEntries(Object.keys(s.members.precipitation!).map(id => [id, [5, 0.2, 0.3, 0, 0, 0]]));
  const index = buildEnsembleIndex([s]);
  assert.equal(index.event(GUST, start, start + 3 * HOUR).value, 1);
  assert.equal(index.event(FROST, start, start + 3 * HOUR).value, 1);
  assert.equal(index.event(SNOW, start, start + 3 * HOUR).value, 1);
});
test('repeat downloads retain previous distinct snapshot and original first-seen age', () => {
  const a = synthetic(); const b = { ...synthetic(), identity: 'second', fetchedAt: start + HOUR };
  const pair = rotateSnapshot(rotateSnapshot(null, a), b);
  const again = rotateSnapshot(pair, { ...b, fetchedAt: start + 2 * HOUR });
  assert.equal(again.previous?.identity, a.identity); assert.equal(again.current.firstSeenAt, b.fetchedAt);
});

test('clock views reuse an indexed snapshot but exclude stale/unknown run recency', () => {
  const snapshot = synthetic();
  const index = buildEnsembleIndex([snapshot]);
  assert.equal(index.atTime(start + HOUR).event(PRECIP_3H, start, start + 3 * HOUR).value, 0);
  assert.equal(index.atTime(start + 7 * HOUR).event(PRECIP_3H, start, start + 3 * HOUR).value, null);
});

test('BST daily rain/gust include all native systems with recorded one-hour shifts; GMT and slots stay aligned', async () => {
  const { PRECIP_DAY, nativeWindow } = await import('../src/forecast/events.ts');
  for (const spec of [PRECIP_DAY, GUST]) {
    const snapshots = await Promise.all(ENSEMBLE_MODELS.map(async model => parseEnsemble(await fixture(`ensemble-${model.id}-${spec.variable}`), model.id, start)));
    const index = buildEnsembleIndex(snapshots);
    const bst = Date.parse('2026-10-23T23:00Z');
    const shifted = index.event(spec, bst, bst + 24 * HOUR);
    assert.deepEqual(shifted.systems, ENSEMBLE_MODELS.map(m => m.id));
    assert.equal(shifted.alignedWindows?.length, 2);
    assert.ok(shifted.alignedWindows!.every(w => w.shiftHours === 1 && w.end - w.start === 24 * HOUR));
    assert.ok(shifted.provenance.filter(p => /shifted/.test(p.coverage)).length === 2);
    const gmt = index.event(spec, bst + HOUR, bst + 25 * HOUR);
    assert.deepEqual(gmt.alignedWindows, []);
    assert.equal(nativeWindow(spec, bst, bst + 3 * HOUR, 3), null);
    assert.equal(nativeWindow(spec, bst - HOUR, bst + 23 * HOUR, 6), null);
    const slot = index.event(spec, bst + HOUR, bst + 4 * HOUR);
    assert.deepEqual(slot.alignedWindows, []);
    // MOGREPS is hourly; coarse systems now evaluate the exact GMT window.
    for (const id of ['ecmwf_ifs025', 'gfs025']) assert.equal(shifted.components!.find(c => c.modelId === id)!.value, gmt.components!.find(c => c.modelId === id)!.value);
  }
});
