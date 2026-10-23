import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCATION } from '../src/config/models.ts';
import { HOUR, utc } from '../src/data/contracts.ts';
import type { CachedRun } from '../src/types.ts';
import { expectedAge, latestRunCandidates, parseModelUpdate, PUBLICATION_BUFFER, runIsStale } from '../src/api/modelUpdates.ts';
import { getRunTasks } from '../src/api/runSchedule.ts';
import { parseOperational } from '../src/api/operational.ts';
import { blendValue, blendWeights, DEFAULT_VERSION, familyMean, MODEL_VERSION, validatePolicy } from '../src/forecast/policy.ts';
import type { BlendPolicy, PolicyRule } from '../src/forecast/policy.ts';
import { parseMetOffice, usableMetOffice } from '../src/forecast/metOffice.ts';
import { buildForecastSignals } from '../src/forecast/signals.ts';
import { buildEnsembleIndex, GUST, PRECIP_3H } from '../src/forecast/events.ts';
import type { EnsembleSnapshot } from '../src/forecast/ensembles.ts';
import { buildHourlySlot } from '../src/metrics/hourlySlot.ts';
import { buildForecastBriefing } from '../src/metrics/forecastSummary.ts';
import { getHourlyCondition, weightedWeatherCodes } from '../src/metrics/hourlyWeather.ts';
import { evaluateLearning, evaluateBlock, fitRule, matchLearning, newLearningState, predictCase, DAY, WEEK, weekStart } from '../src/verification/learning.ts';
import type { LearningCase, LearningObservation } from '../src/verification/learning.ts';
import { gaugeObservations, parseGaugeReadings, RAIN_DEFINITION, TEMPERATURE_DEFINITION } from '../src/verification/observations.ts';
import type { RainGauge } from '../src/verification/observations.ts';
import { validatePolicyProduct } from '../src/forecast/product.ts';
import { skyHourlyPresentation } from '../src/sky/hourlyPresentation.ts';
import { canRequestMetOffice, collectMetOffice } from '../scripts/lib/metOfficeCollector.ts';
import { collectorBudgetAllows, budgetedCollectorJson } from '../scripts/lib/collectorBudget.ts';
import { forecastStore } from '../scripts/lib/forecastCollector.ts';

const now = utc('2026-10-23T19:00');
const ukv = 'ukmo_uk_deterministic_2km';
const update = parseModelUpdate({ last_run_initialisation_time: (now - 5 * HOUR) / 1000, last_run_availability_time: (now - HOUR) / 1000, update_interval_seconds: 3600, temporal_resolution_seconds: 3600 }, now);
function run(modelId: string, variable: CachedRun['variable'], value: number, age = 6): CachedRun {
  const runTime = new Date(now - age * HOUR).toISOString().slice(0, 16);
  return { key: `${modelId}__${runTime}__${variable}`, modelId, variable, runTime, fetchedAt: now, times: Array.from({ length: 170 }, (_, i) => new Date(now + i * HOUR).toISOString().slice(0, 16)), values: Array(170).fill(value) };
}
function coverage(parameter: string, unit: string, start = now, end = now, values = [283.15, 293.15], axisName = 'percentile', axisValues: (string | number)[] = [50, 90]) {
  return { domain: { axes: { x: { values: [LOCATION.longitude] }, y: { values: [LOCATION.latitude] }, z: { values: [12] }, locationId: { values: ['peterborough-site'] }, t: { values: [new Date(end).toISOString()], ...(start === end ? {} : { bounds: [new Date(start).toISOString(), new Date(end).toISOString()] }) }, [axisName]: { values: axisValues } } }, parameters: { [parameter]: { unit: { symbol: unit } } }, ranges: { [parameter]: { axisNames: ['t', axisName], shape: [1, axisValues.length], values } } };
}
const product = (coverages = [coverage('airTemperature1p5m', 'K')]) => parseMetOffice({ coverages }, LOCATION, now - HOUR, now);
const rule = (): PolicyRule => ({ variable: 'temperature_2m', location: 'peterborough', band: -1, familyFactors: {}, modelFactors: {}, metOfficeShare: 0.5, temperatureCorrection: 0, occurrenceSlope: 1, occurrenceIntercept: 0 });
const policy = (): BlendPolicy => ({ schema: 1, version: 'test-observed-v1', modelVersion: MODEL_VERSION, createdAt: now - HOUR, expiresAt: now + 7 * DAY, rules: [rule()], evidence: { observationThrough: now - DAY, trainingCases: 200, trainingDates: 20, heldOutDates: 14, successfulBlocks: 2 } });

test('latest UKV selection uses actual metadata, a publication buffer and only three hourly probes', () => {
  assert.deepEqual(latestRunCandidates(ukv, update, now), ['2026-10-23T14:00', '2026-10-23T13:00', '2026-10-23T12:00']);
  assert.equal(latestRunCandidates(ukv, update, update.availableAt + PUBLICATION_BUFFER - 1)[0], '2026-10-23T13:00');
  assert.deepEqual(latestRunCandidates(ukv, { ...update, initialisedAt: now - 2 * HOUR }, now), ['2026-10-23T17:00', '2026-10-23T16:00', '2026-10-23T15:00', '2026-10-23T12:00'], 'an operational update must not displace the newest cycle actually offered by Single Runs');
  const tasks = getRunTasks([], now, { [ukv]: update }).filter(t => t.modelId === ukv);
  assert.ok(tasks.length <= 23, 'five-day backfill stays sparse, plus at most three recent probes');
  assert.equal(tasks.filter(t => ![0, 6, 12, 18].includes(new Date(t.runTime + 'Z').getUTCHours())).length, 2);
  assert.throws(() => parseModelUpdate({ last_run_initialisation_time: Infinity }, now));
});

test('freshness uses cadence/publication delay and never a successful fetch timestamp', () => {
  assert.ok(expectedAge(ukv, update) < expectedAge('gfs_global'));
  const old = run('gfs_global', 'temperature_2m', 10, 25);
  assert.equal(runIsStale(old.modelId, utc(old.runTime), now), true);
  assert.equal(buildForecastSignals([old], now).samples('temperature_2m', now)[0].stale, true);
  assert.equal(buildForecastSignals([old], now).mean('temperature_2m', now), 10);
  assert.equal(buildForecastSignals([old], now).samples('temperature_2m', now, true).length, 0);
});

test('latest forecast issue stays unknown, unchanged content retains first-seen age, and comparisons stay raw', async () => {
  const raw = { utc_offset_seconds: 0, hourly_units: { temperature_2m: '°C' }, hourly: { time: [new Date(now).toISOString()], temperature_2m: [20] } };
  const first = await parseOperational(raw, update, undefined, now);
  const second = await parseOperational(raw, { ...update, initialisedAt: update.initialisedAt + HOUR }, first, now + HOUR);
  assert.equal(second.firstSeenAt, first.firstSeenAt);
  assert.equal(second.issueTime, null);
  const archived = [run(ukv, 'temperature_2m', 10, 7)];
  const signals = buildForecastSignals(archived, now, { operational: first });
  assert.equal(signals.mean('temperature_2m', now), 20);
  assert.equal(signals.samples('temperature_2m', now)[0].issuedAt, null);
  assert.equal(archived.length, 1); assert.equal(archived[0].values[0], 10);
  assert.equal(buildForecastSignals(archived, now + 7 * HOUR, { operational: second }).mean('temperature_2m', now), 10);
  assert.equal(buildForecastSignals(archived, now, { operational: first, coordinates: { latitude: 0, longitude: 0 } }).mean('temperature_2m', now), 10);
});

test('Met Office central contribution splits UKMO 50/50 and missing feed recovers the original blend exactly', () => {
  const sources = [run('ecmwf_ifs025', 'temperature_2m', 0), run('gfs_global', 'temperature_2m', 6), run('ukmo_global_deterministic_10km', 'temperature_2m', 12), run(ukv, 'temperature_2m', 18)];
  const baseline = buildForecastSignals(sources, now);
  const mo = product([coverage('airTemperature1p5m', 'K', now, now, [303.15, 313.15])]);
  const signals = buildForecastSignals(sources, now, { metOffice: mo });
  assert.ok(Math.abs(signals.mean('temperature_2m', now)! - 9.5) < 1e-10);
  const weights = blendWeights([...baseline.samples('temperature_2m', now), { family: 'UKMO' as const, modelId: 'metoffice_blended', value: 30 }]);
  assert.ok(Math.abs(weights.find(v => v.source.modelId === 'metoffice_blended')!.weight - 1 / 6) < 1e-12);
  assert.equal(weights.filter(v => v.source.family === 'UKMO').reduce((s, v) => s + v.weight, 0), 1 / 3);
  assert.equal(signals.disagreements[0].flagged, true);
  for (const invalid of [undefined, { ...mo, fetchedAt: now - 7 * HOUR }, { ...mo, site: { ...mo.site, distanceKm: 100 } }]) assert.ok(Object.is(buildForecastSignals(sources, now, { metOffice: invalid }).mean('temperature_2m', now), baseline.mean('temperature_2m', now)));
  assert.ok(Object.is(blendValue(baseline.samples('temperature_2m', now)), familyMean(baseline.samples('temperature_2m', now))));
  assert.equal(blendValue([{ family: 'UKMO', modelId: 'metoffice_blended', value: 10 }]), 10);
});

test('only matching quantities/intervals enter weighting; rainfall medians stay out of expected amounts', () => {
  const runs = [run('gfs_global', 'precipitation', 2), run(ukv, 'wind_gusts_10m', 20)];
  const mo = product([coverage('lweThicknessOfPrecipitationAmountSumPt01h', 'm', now, now + HOUR, [0.1, 0.2]), coverage('windSpeedOfGust10mMaximumPt03h', 'm s-1', now, now + 3 * HOUR, [40, 50])]);
  const signals = buildForecastSignals(runs, now, { metOffice: mo });
  assert.equal(signals.mean('precipitation', now + HOUR), 2);
  assert.equal(signals.mean('wind_gusts_10m', now + HOUR), 20, '3-hour maxima cannot adjust a 1-hour maximum');
  const wet = product([coverage('probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt03h', '1', now, now + 3 * HOUR, [0.9], 'probabilityThreshold', ['>=0.0002'])]);
  const event = buildForecastSignals(runs, now, { metOffice: wet }).event(PRECIP_3H, now, now + 3 * HOUR);
  assert.equal(event.basis, 'deterministic-agreement'); assert.equal(event.value, 1);
  assert.equal(event.metOfficeProbability, 0.9, 'agreement keeps its label, supplied probability is separate');
  const wrongThreshold = product([coverage('probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt03h', '1', now, now + 3 * HOUR, [0.9], 'probabilityThreshold', ['>=0.001'])]);
  assert.equal(buildForecastSignals(runs, now, { metOffice: wrongThreshold }).event(PRECIP_3H, now, now + 3 * HOUR).metOfficeProbability, undefined);
  assert.equal(usableMetOffice({ ...wet, requested: { latitude: 0, longitude: 0 } }, LOCATION, now), false);
  assert.throws(() => product([coverage('airTemperature1p5m', '°F')]));
  const missingBounds = coverage('windSpeedOfGust10mMaximumPt01h', 'm/s', now, now + HOUR, [20, 30]);
  delete missingBounds.domain.axes.t.bounds;
  assert.throws(() => product([missingBounds]));
});

test('six-hour native rainfall does not imply hourly or three-hour timing', () => {
  const coarse = { ...run('ecmwf_aifs025_single', 'precipitation', 1), nativeHours: 6 };
  const signals = buildForecastSignals([coarse], now);
  const slot = buildHourlySlot(signals, new Date(now).toISOString());
  assert.equal(slot.display.precipitation, 'See 6h window');
  assert.equal(slot.rainWindow.end - slot.rainWindow.start, 6 * HOUR);
  assert.equal(signals.agreement(PRECIP_3H, now, now + 3 * HOUR).value, null);
  const aggregate = signals.aggregate('precipitation', [now + HOUR, now + 2 * HOUR, now + 3 * HOUR], 'sum')[0];
  assert.equal(aggregate.validFrom, now); assert.equal(aggregate.validTo, now + 3 * HOUR);
});

test('gust upper percentile is calculated from the family mixture, not averaged source percentiles', () => {
  const start = Math.floor(now / (3 * HOUR)) * 3 * HOUR;
  const snapshot = (modelId: string, family: 'ECMWF' | 'NOAA', value: number): EnsembleSnapshot => ({ provider: 'fixture', modelId, family, identity: modelId, issuedAt: null, sourceTime: null, fetchedAt: now, validFrom: start, validTo: start + 4 * HOUR, units: { wind_gusts_10m: 'm/s' }, coverage: 'fixture', expected: 5, nativeHours: 3, warnings: [], times: [start, start + HOUR, start + 2 * HOUR, start + 3 * HOUR], members: { wind_gusts_10m: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i), [0, value, value, value]])) } });
  const index = buildEnsembleIndex([snapshot('ecmwf_ifs025', 'ECMWF', 0), snapshot('gfs025', 'NOAA', 40)]);
  const event = index.event(GUST, start, start + 3 * HOUR);
  assert.equal(event.expectedAmount, 20); assert.equal(event.upperAmount, 40); assert.equal(event.value, 0.5);
  assert.equal(index.event(GUST, start, start + HOUR).value, null, 'coarser native output does not imply hourly maximum timing');
});

test('minority thunder/snow/freezing signals remain risks until family support reaches half', () => {
  const runs = [run('ecmwf_ifs025', 'weather_code', 2), run('gfs_global', 'weather_code', 2), run(ukv, 'weather_code', 95), run('gfs_global', 'is_day', 0), run('gfs_global', 'precipitation', 0)];
  const slot = buildHourlySlot(buildForecastSignals(runs, now), new Date(now).toISOString());
  assert.notEqual(slot.condition.icon, 'storm'); assert.equal(slot.condition.risks?.[0].label, 'Thunderstorm');
  const support = weightedWeatherCodes(buildForecastSignals(runs, now).samples('weather_code', now));
  assert.ok(Math.abs(support.find(v => v.code === 95)!.support - 1 / 3) < 1e-12);
  const plurality = getHourlyCondition({ codes: [95, 2, 3], support: [{ code: 95, support: 0.4 }, { code: 2, support: 0.3 }, { code: 3, support: 0.3 }], precipitation: null, snowfall: 0, cloud: 0.4, daylight: 0 });
  assert.notEqual(plurality.icon, 'storm'); assert.equal(plurality.risks?.length, 1);
  const majority = getHourlyCondition({ codes: [71, 73, 2], support: [{ code: 71, support: 1 / 3 }, { code: 73, support: 1 / 3 }, { code: 2, support: 1 / 3 }], precipitation: 0.1, snowfall: 0, cloud: 0.4, daylight: 0 });
  assert.equal(majority.icon, 'snow');
});

test('daily condition follows duration, with a brief hazard and gust interval retained separately', () => {
  const start = utc('2026-12-07T00:00');
  const times = Array.from({ length: 25 }, (_, i) => new Date(start + i * HOUR).toISOString().slice(0, 16));
  const rows = ['weather_code', 'is_day', 'precipitation', 'wind_gusts_10m'].map(variable => ({ ...run('gfs_global', variable as CachedRun['variable'], 0), runTime: '2026-12-07T00:00', times, values: times.map((_, i) => variable === 'weather_code' ? i === 3 ? 95 : 3 : variable === 'wind_gusts_10m' ? i === 8 ? 20 : 5 : 0) }));
  const day = buildForecastBriefing(rows, new Date(start)).days[0];
  assert.equal(day.condition.label, 'Cloudy'); assert.ok(day.hazardTiming.some(s => s.includes('Thunderstorm') && s.includes('03:00')));
  assert.equal(day.gustTime, '07:00–08:00');
  const flat = { ...rows.find(r => r.variable === 'wind_gusts_10m')!, modelId: 'ecmwf_ifs025', values: times.map(() => 5) };
  assert.equal(buildForecastBriefing([...rows, flat], new Date(start)).days[0].gustTime, '07:00–08:00', 'a flat source has no timed peak and does not widen the final peak to all day');
  const missing = buildForecastBriefing(rows.filter(r => r.variable !== 'precipitation'), new Date(start)).days[0];
  assert.equal(missing.rainMm, null); assert.match(missing.paragraphs.join(' '), /incomplete or unavailable/);
});

test('policies reject non-finite, out-of-bounds, incompatible, expired or insufficient-evidence files', () => {
  assert.equal(validatePolicy(policy(), now).version, 'test-observed-v1');
  for (const change of [ (p: BlendPolicy) => p.rules[0].modelFactors.gfs_global = -1, (p: BlendPolicy) => p.rules[0].temperatureCorrection = 2, (p: BlendPolicy) => p.rules[0].metOfficeShare = NaN, (p: BlendPolicy) => p.evidence.successfulBlocks = 1, (p: BlendPolicy) => p.modelVersion = 'old', (p: BlendPolicy) => p.expiresAt = now - 1 ]) {
    const p = policy(); change(p); assert.throws(() => validatePolicy(p, now));
  }
  assert.throws(() => validatePolicy({ ...policy(), rules: [null] }, now));
  assert.equal(validatePolicyProduct({ schema: 1, publishedAt: now, revision: 'rollback', policy: null, reason: 'Automatic rollback' }, now).policy, null);
  assert.throws(() => validatePolicyProduct({ policy: policy() }, now));
});

function syntheticCase(start: number, generatedAt = start - HOUR, value = 10): LearningCase {
  return { id: `${start}:${generatedAt}`, generatedAt, location: 'EGXT', latitude: 52.61, longitude: -0.47, start, end: start, leadHours: (start - generatedAt) / HOUR, variable: 'temperature_2m', unit: '°C', definition: TEMPERATURE_DEFINITION, modelVersion: MODEL_VERSION, policyVersion: DEFAULT_VERSION, sources: [{ family: 'NOAA', modelId: 'gfs_global', value }], sourceVersions: [`gfs_global:${generatedAt}`], defaultValue: value, activeValue: value, candidates: {} };
}
function observation(row: LearningCase, value = 9): LearningObservation {
  return { id: `obs:${row.start}`, location: row.location, latitude: row.latitude, longitude: row.longitude, start: row.start, end: row.end, variable: row.variable, unit: row.unit, definition: row.definition, value, quality: 'accepted', collectedAt: row.start + HOUR };
}
function history(begin: number, end: number) { return Array.from({ length: Math.floor((end - begin) / HOUR) }, (_, i) => syntheticCase(begin + i * HOUR)); }

test('matching protects location, measurement definition, unit, intervals and pre-observation generation', () => {
  const row = syntheticCase(now); const obs = observation(row);
  assert.equal(matchLearning([row], [obs]).length, 1);
  for (const wrong of [{ ...obs, latitude: obs.latitude + 0.1 }, { ...obs, location: 'peterborough' }, { ...obs, unit: 'K' }, { ...obs, end: obs.end + HOUR }, { ...obs, quality: 'provisional' }, { ...obs, definition: 'METAR-weather-code-rain' }]) assert.equal(matchLearning([row], [wrong as LearningObservation]).length, 0);
  assert.equal(matchLearning([{ ...row, generatedAt: now + 1 }], [obs]).length, 0);
  assert.equal(fitRule(matchLearning([row], [obs]), -1), null);
  const rain = { ...row, variable: 'precipitation_probability' as const, observed: 1, observationId: 'obs', probabilityBasis: 'ensemble-probability' as const };
  assert.equal(fitRule(Array.from({ length: 200 }, (_, i) => ({ ...rain, start: now - i * DAY })), -1), null, 'probability fitting requires both events and non-events');
});

test('frozen candidates require two subsequent non-overlapping weekly blocks and automatically roll back', () => {
  const created = utc('2026-08-10T12:00');
  const training = history(created - 40 * DAY, weekStart(created - 2 * DAY));
  let cases = [...training]; let observations = training.map(r => observation(r));
  let state = evaluateLearning(newLearningState(), cases, observations, created);
  const candidate = state.candidates.find(c => c.rule.band === 0)!;
  assert.ok(candidate); assert.equal(candidate.state, 'pending'); assert.equal(state.active, undefined);
  assert.ok(candidate.trainingEnd < candidate.createdAt); assert.ok(Math.abs(candidate.rule.temperatureCorrection) <= 1);
  const testStart = weekStart(created) + WEEK;
  const heldOut = history(testStart, testStart + 2 * WEEK).map(row => ({ ...row, candidates: { [candidate.id]: predictCase(row, candidate.rule) } }));
  cases.push(...heldOut); observations.push(...heldOut.map(r => observation(r)));
  state = evaluateLearning(state, cases, observations, testStart + WEEK + 2 * DAY + HOUR);
  assert.equal(state.active, undefined, 'one successful weekly block cannot promote');
  state = evaluateLearning(state, cases, observations, testStart + 2 * WEEK + 2 * DAY + HOUR);
  assert.ok(state.active); assert.equal(state.active!.rules[0].location, 'EGXT', 'station bias never transfers to Peterborough');
  assert.equal(state.candidates.find(c => c.id === candidate.id)!.blocks.length, 2);
  assert.ok(state.candidates.find(c => c.id === candidate.id)!.blocks.every(b => b.success && b.baseline!.n === b.candidate!.n));
  const promotedAt = state.active!.createdAt; const monitorStart = weekStart(promotedAt) + WEEK;
  const bad = history(monitorStart, monitorStart + 2 * WEEK).map(row => ({ ...row, policyVersion: state.active!.version, activeValue: 14 }));
  cases.push(...bad); observations.push(...bad.map(r => observation(r)));
  state = evaluateLearning(state, cases, observations, monitorStart + WEEK + 2 * DAY + HOUR);
  assert.ok(state.active, 'one bad block cannot roll back');
  state = evaluateLearning(state, cases, observations, monitorStart + 2 * WEEK + 2 * DAY + HOUR);
  assert.equal(state.active, undefined);
  assert.ok(state.changes.some(c => /automatic rollback/.test(c.reason)));
});

test('unarchived candidate outputs and insufficient held-out coverage cannot promote', () => {
  const created = utc('2026-08-10T12:00'); const training = history(created - 40 * DAY, weekStart(created - 2 * DAY));
  let state = evaluateLearning(newLearningState(), training, training.map(r => observation(r)), created);
  const start = weekStart(created) + WEEK; const testCases = history(start, start + 2 * WEEK);
  state = evaluateLearning(state, [...training, ...testCases], [...training, ...testCases].map(r => observation(r)), start + 2 * WEEK + 3 * DAY);
  assert.equal(state.active, undefined); assert.ok(state.candidates.some(c => c.state === 'rejected'));
});

test('one unusual date, unpaired coverage and probability event deterioration fail promotion gates', () => {
  const start = utc('2026-08-17T00:00');
  const rows = history(start, start + WEEK);
  const proposed = { ...rule(), location: 'EGXT', temperatureCorrection: -0.5 };
  const observations = rows.map(row => observation(row, row.start < start + DAY ? 0 : 10));
  const block = evaluateBlock(matchLearning(rows, observations), proposed, start, start + WEEK, 0);
  assert.equal(block.adequate, true); assert.equal(block.success, false, 'a gain carried by one unusual date is rejected');
  assert.equal(evaluateBlock(matchLearning(rows.slice(0, 30), observations), proposed, start, start + WEEK, 0).adequate, false);
  const rainRows = rows.map((row, i) => ({ ...row, end: row.start + HOUR, variable: 'precipitation_probability' as const, unit: 'fraction', definition: 'rain-event-fixture', sources: [{ family: 'NOAA' as const, modelId: 'gfs025', value: i % 3 === 0 ? 0.51 : 0.1 }], defaultValue: i % 3 === 0 ? 0.51 : 0.1, activeValue: 0, probabilityBasis: 'ensemble-probability' as const }));
  const rainObservations = rainRows.map((row, i) => observation(row, i % 3 === 0 ? 1 : 0));
  const rainRule = { ...proposed, variable: 'precipitation_probability' as const, temperatureCorrection: 0, occurrenceIntercept: -0.1 };
  const rain = evaluateBlock(matchLearning(rainRows, rainObservations), rainRule, start, start + WEEK, 0);
  assert.equal(rain.adequate, true); assert.equal(rain.success, false); assert.ok(rain.candidate!.misses! > rain.baseline!.misses!);
});

test('discovery and a batched v2 forecast work with the one server key, and unchanged products do not gain a new issue', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-mo-connected-'));
  try {
    const store = forecastStore(pathToFileURL(dir + '/')); let calls = 0;
    const request: typeof fetch = async (input, init) => {
      calls++; assert.equal(new Headers(init?.headers).get('apikey'), 'test-server-secret');
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/collections') ? { collections: [{ id: 'test', parameter_names: { airTemperature1p5m: {} } }] }
        : url.pathname.endsWith('/instances') ? { instances: [{ id: 'dynamic-latest' }] }
        : { coverages: [coverage('airTemperature1p5m', 'K')] };
      if (url.pathname.endsWith('/position')) assert.equal(url.searchParams.get('parameter-name'), 'airTemperature1p5m');
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    await collectMetOffice(store, 'test-server-secret', now, request); assert.equal(calls, 3);
    const first = await store.read<any>('forecast/metoffice.json', null); assert.ok(first); assert.equal(first.issuedAt, null);
    await collectMetOffice(store, 'test-server-secret', now + 3 * HOUR, request); assert.equal(calls, 4, 'cached discovery/instance uses one batched request');
    const second = await store.read<any>('forecast/metoffice.json', null); assert.equal(second.firstSeenAt, first.firstSeenAt);
    assert.equal(usableMetOffice(second, LOCATION, now + 7 * HOUR), false);
    assert.ok(!JSON.stringify(second).includes('test-server-secret'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Peterborough discovery prefers UK percentiles and probabilities over the global domain', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-mo-uk-discovery-'));
  try {
    const store = forecastStore(pathToFileURL(dir + '/')); const paths: string[] = [];
    const parameters = { airTemperature1p5m: {} };
    const probabilityKey = 'probabilityOfLweThicknessOfPrecipitationAmountAboveThresholdSumPt03h';
    const request: typeof fetch = async input => {
      const url = new URL(String(input)); paths.push(url.pathname);
      const body = url.pathname.endsWith('/collections') ? { collections: [
        { id: 'global-spot-percentiles', parameter_names: parameters },
        { id: 'uk-spot-percentiles', parameter_names: parameters },
        { id: 'global-spot-probabilities', parameter_names: { [probabilityKey]: {} } },
        { id: 'uk-spot-probabilities', parameter_names: { [probabilityKey]: {} } },
      ] } : url.pathname.endsWith('/instances') ? { instances: [{ id: 'blended' }] }
        : { coverages: [url.pathname.includes('probabilities') ? coverage(probabilityKey, '1', now, now + 3 * HOUR, [0.4], 'probabilityThreshold', ['>=0.0002']) : coverage('airTemperature1p5m', 'K')] };
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    };
    // An older discovery can be repaired immediately, without resetting its budget
    // or waiting for the normal three-hour forecast cadence.
    await store.save('forecast/metoffice-discovery.json', { checkedAt: now - HOUR, collections: [{ id: 'global-spot-percentiles', parameters: ['airTemperature1p5m'] }], instances: {} });
    await store.save('forecast/metoffice-budget.json', { date: new Date(now).toISOString().slice(0, 10), calls: 7, blockedUntil: 0, lastAttempt: now - HOUR });
    await collectMetOffice(store, 'fake-test-key', now, request);
    assert.equal(paths.length, 5); assert.ok(paths.every(path => !path.includes('/global-spot-')));
    const p = await store.read<any>('forecast/metoffice.json', null);
    assert.ok(p.values.some((v: any) => v.variable === 'temperature_2m'));
    assert.ok(p.values.some((v: any) => v.variable === 'precipitation_probability'));
    assert.equal((await store.read<any>('forecast/metoffice-budget.json', null)).calls, 12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rainfall telemetry requires complete matched accumulation windows and never substitutes missing amounts', () => {
  const gauge: RainGauge = { id: 'EA:test', latitude: 52.6, longitude: -0.2, measure: 'https://environment.data.gov.uk/measure', period: 900, unit: 'mm', valueType: 'total', timestampConvention: 'period-end' };
  const start = Math.floor(now / (3 * HOUR)) * 3 * HOUR - 3 * HOUR;
  const items = Array.from({ length: 12 }, (_, i) => ({ dateTime: new Date(start + (i + 1) * 15 * 60_000).toISOString(), value: i === 0 ? 0.2 : 0, measure: gauge.measure }));
  const readings = parseGaugeReadings({ items }, gauge, now);
  const observations = gaugeObservations(gauge, readings, now);
  assert.equal(observations[0].value, 0.2); assert.equal(observations[0].definition, RAIN_DEFINITION); assert.equal(observations[1].value, 1);
  assert.equal(gaugeObservations(gauge, readings.slice(1), now).length, 0);
  assert.equal(gaugeObservations({ ...gauge, timestampConvention: 'unknown' }, readings, now).length, 0);
  const conflict = parseGaugeReadings({ items: [...items, { ...items[0], value: 99 }] }, gauge, now);
  assert.equal(gaugeObservations(gauge, conflict, now).length, 0);
});

test('Met Office budget counts discovery, stops on quota exhaustion and retains the cached product on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pb-mo-upgrade-'));
  try {
    const store = forecastStore(pathToFileURL(dir + '/')); const mo = product(); await store.save('forecast/metoffice.json', mo);
    await store.save('forecast/metoffice-budget.json', { date: new Date(now).toISOString().slice(0, 10), calls: 48, blockedUntil: 0, lastAttempt: 0 });
    let calls = 0;
    const request: typeof fetch = async () => { calls++; return new Response('{}', { status: 429 }); };
    await collectMetOffice(store, 'fake-test-key', now, request); assert.equal(calls, 0);
    assert.deepEqual(await store.read('forecast/metoffice.json', null), JSON.parse(JSON.stringify(mo)));
    await store.save('forecast/metoffice-budget.json', { date: '', calls: 0, blockedUntil: 0, lastAttempt: 0 });
    await collectMetOffice(store, 'fake-test-key', now, request); assert.equal(calls, 1);
    assert.deepEqual(await store.read('forecast/metoffice.json', null), JSON.parse(JSON.stringify(mo)));
    const budget = await store.read<any>('forecast/metoffice-budget.json', null); assert.equal(budget.calls, 1); assert.ok(budget.blockedUntil > now);
    await collectMetOffice(store, undefined, now, request); assert.equal(calls, 1);
    assert.equal(canRequestMetOffice({ date: new Date(now).toISOString().slice(0, 10), calls: 48, blockedUntil: 0, lastAttempt: 0 }, now), false);
    assert.equal(collectorBudgetAllows({ date: new Date(now).toISOString().slice(0, 10), http: 100, weighted: 1500, blockedUntil: 0 }, 1, now), false);
    const fetchBudgeted = budgetedCollectorJson(store, request, now); await assert.rejects(fetchBudgeted('https://api.open-meteo.com/v1/forecast?hourly=temperature_2m'));
    assert.equal((await store.read<any>('forecast/openmeteo-budget.json', null)).weighted, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Night Sky glance symbols describe cloud independently of viewing quality or missing data', () => {
  assert.equal(skyHourlyPresentation(0.1, 10, 60).icon, 'stars');
  assert.equal(skyHourlyPresentation(0.1, 10, 60).suitability.label, 'Poor viewing');
  assert.equal(skyHourlyPresentation(0.4, 60, 60).icon, 'cloud-stars');
  assert.equal(skyHourlyPresentation(0.8, 10, 60).label, 'Mostly cloudy');
  assert.equal(skyHourlyPresentation(1, 0, 60).label, 'Overcast');
  assert.equal(skyHourlyPresentation(null, null, 60).label, 'Sky unknown');
  assert.equal(skyHourlyPresentation(0.1, null, 0).suitability.label, 'Twilight');
});
