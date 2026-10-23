import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { DETERMINISTIC_MODELS, LOCATION } from '../../src/config/models.ts';
import { finite, HOUR, utc } from '../../src/data/contracts.ts';
import { parseModelUpdate, latestRunCandidates } from '../../src/api/modelUpdates.ts';
import type { ModelUpdates } from '../../src/api/modelUpdates.ts';
import { operationalUrl, parseOperational } from '../../src/api/operational.ts';
import type { OperationalForecast } from '../../src/api/operational.ts';
import { FORECAST_VARIABLES, parseRun, runUrl } from '../../src/api/runSource.ts';
import type { CachedRun } from '../../src/types.ts';
import { buildForecastSignals } from '../../src/forecast/signals.ts';
import type { ForecastContext } from '../../src/forecast/signals.ts';
import { buildEnsembleIndex, PRECIP_3H } from '../../src/forecast/events.ts';
import { ENSEMBLE_MODELS, parseEnsemble } from '../../src/forecast/ensembles.ts';
import type { EnsembleSnapshot } from '../../src/forecast/ensembles.ts';
import { DEFAULT_VERSION, MODEL_VERSION, familyMean, policyRule, validatePolicy } from '../../src/forecast/policy.ts';
import { validateMetOffice, distanceKm, DIAGNOSTIC_THRESHOLDS } from '../../src/forecast/metOffice.ts';
import { newLearningState, evaluateLearning, predictCase, matchLearning, validateLearningState, weekStart, DAY } from '../../src/verification/learning.ts';
import type { LearningState, LearningCase, LearningObservation } from '../../src/verification/learning.ts';
import type { Observation } from '../../src/verification/verification.ts';
import { TEMPERATURE_DEFINITION, RAIN_DEFINITION, GUST_DEFINITION, metarLearningObservations, parseGaugeReadings, gaugeObservations } from '../../src/verification/observations.ts';
import type { RainGauge, GaugeReading } from '../../src/verification/observations.ts';
import { collectMetOffice } from './metOfficeCollector.ts';
import { budgetedCollectorJson } from './collectorBudget.ts';
import type { CollectorStore } from './metOfficeCollector.ts';

export function forecastStore(root: URL): CollectorStore {
  return {
    async read<T>(path: string, fallback: T): Promise<T> {
      try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
    },
    async save(path: string, data: unknown) {
      const file = new URL(path, root); await mkdir(new URL('./', file), { recursive: true });
      const text = JSON.stringify(data) + '\n';
      try { if (await readFile(file, 'utf8') === text) return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const temp = new URL(`${path}.tmp`, root); await writeFile(temp, text); await rename(temp, file);
    },
  };
}
interface SiteConfig { id: string; latitude: number; longitude: number; elevation?: number }
interface SavedSite { location: SiteConfig; runs: CachedRun[]; ensembles: EnsembleSnapshot[]; operational?: OperationalForecast; checkedAt: number }
export interface Generation { schema: 1; generatedAt: number; modelVersion: string; policyVersion: string; context: ForecastContext; sites: SavedSite[]; cases: LearningCase[]; candidateRules: LearningState['candidates'] }
interface StoredGeneration extends Omit<Generation, 'sites' | 'context'> { inputs: { path: string; fetchedAt: number }[]; contextPath: string }
async function collectRain(store: CollectorStore, now: number, failures: string[], fetchJson: ReturnType<typeof budgetedCollectorJson>): Promise<{ gauge?: RainGauge; observations: LearningObservation[] }> {
  let discovery = await store.read<{ checkedAt: number; gauge?: RainGauge }>('obs/rain-gauge.json', { checkedAt: 0 });
  if (now - discovery.checkedAt > 30 * DAY || !discovery.gauge) {
    try {
      const data = await fetchJson(`https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=rainfall&lat=${LOCATION.latitude}&long=${LOCATION.longitude}&dist=15`);
      if (!Array.isArray(data.items)) throw new RangeError('Invalid rainfall station catalogue');
      const stations = data.items.filter((s: Record<string, unknown>) => finite(s.lat) && finite(s.long) && typeof s.stationReference === 'string').sort((a: Record<string, number>, b: Record<string, number>) => distanceKm(LOCATION, { latitude: a.lat, longitude: a.long }) - distanceKm(LOCATION, { latitude: b.lat, longitude: b.long }));
      for (const station of stations.slice(0, 3)) {
        const measure = station.measures?.find((m: Record<string, unknown>) => m.parameter === 'rainfall' && m.period === 900 && m.unitName === 'mm');
        if (!measure?.['@id']) continue;
        const info = await fetchJson(measure['@id'].replace('http:', 'https:'));
        if (info.items?.valueType !== 'total') continue;
        // This API documents totals and cadence but not whether dateTime denotes
        // interval start or end. Collect telemetry; never invent verification intervals.
        discovery = { checkedAt: now, gauge: { id: `EA:${station.stationReference}`, latitude: station.lat, longitude: station.long, measure: measure['@id'].replace('http:', 'https:'), unit: 'mm', valueType: 'total', period: 900, timestampConvention: 'unknown' } };
        await store.save('obs/rain-gauge.json', discovery); break;
      }
    } catch (error) { failures.push(`Rain gauge discovery: ${String(error)}`); }
  }
  const gauge = discovery.gauge;
  if (!gauge) return { observations: [] };
  const previous = await store.read<{ checkedAt: number; readings: GaugeReading[] }>('obs/rain-readings.json', { checkedAt: 0, readings: [] });
  let readings = previous.readings;
  if (now - previous.checkedAt >= 6 * HOUR) {
    try {
      const begin = new Date(now - 7 * DAY).toISOString().slice(0, 10);
      const raw = await fetchJson(`${gauge.measure}/readings?startdate=${begin}&_limit=10000`);
      const next = parseGaugeReadings(raw, gauge, now);
      readings = [...new Map([...readings, ...next].filter(r => r.time >= now - 120 * DAY).map(r => [r.time, r])).values()].sort((a, b) => a.time - b.time);
      await store.save('obs/rain-readings.json', { checkedAt: now, gauge, readings, note: 'Measured 15-minute rainfall amounts. Unconfirmed interval timestamp convention: excluded from learning until compatible metadata is supplied automatically.' });
    } catch (error) { failures.push(`Rainfall collection: ${String(error)}`); }
  }
  return { gauge, observations: gaugeObservations(gauge, readings, now) };
}
async function collectSite(site: SiteConfig, previous: SavedSite | undefined, updates: ModelUpdates, now: number, failures: string[], fetchJson: ReturnType<typeof budgetedCollectorJson>): Promise<SavedSite> {
  const records = new Map((previous?.runs ?? []).filter(r => utc(r.runTime) >= now - 2 * DAY).map(r => [r.key, r]));
  for (const model of DETERMINISTIC_MODELS) {
    for (const runTime of latestRunCandidates(model.id, updates[model.id], now)) {
      const saved = [...records.values()].filter(r => r.modelId === model.id && r.runTime === runTime);
      if (saved.length && now - Math.max(...saved.map(r => r.fetchedAt)) < HOUR) break;
      try {
        let raw;
        try { raw = await fetchJson(runUrl(model.id, runTime, FORECAST_VARIABLES, site)); }
        catch { raw = await fetchJson(runUrl(model.id, runTime, ['temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m'], site)); }
        const next = parseRun(raw, model.id, runTime, FORECAST_VARIABLES, now, updates[model.id]);
        if (!next.length) continue;
        next.forEach(r => records.set(r.key, r)); break;
      } catch (error) { failures.push(`${site.id}/${model.id}/${runTime}: ${String(error)}`); }
    }
  }
  let operational = previous?.operational;
  const ukvUpdate = updates.ukmo_uk_deterministic_2km;
  if (ukvUpdate && now >= ukvUpdate.availableAt + 10 * 60_000) {
    try { operational = await parseOperational(await fetchJson(operationalUrl(site)), ukvUpdate, operational, now, site); }
    catch (error) { failures.push(`${site.id} latest UKV: ${String(error)}`); }
  }
  const ensembles: EnsembleSnapshot[] = [];
  for (const model of ENSEMBLE_MODELS) {
    const saved = previous?.ensembles.find(s => s.modelId === model.id);
    if (saved && now - saved.fetchedAt < 6 * HOUR) { ensembles.push(saved); continue; }
    try {
      const params = new URLSearchParams({ latitude: String(site.latitude), longitude: String(site.longitude), models: model.id, hourly: 'temperature_2m,precipitation,wind_gusts_10m,cloud_cover,snowfall', forecast_days: '7', timezone: 'GMT', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' });
      const parsed = parseEnsemble(await fetchJson(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`), model.id, now);
      // Without genuine issue metadata, recency is bounded by the first distinct
      // content, not reset by a successful fetch of the same forecast.
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(parsed.members)));
      const identity = Buffer.from(hash).toString('hex');
      ensembles.push({ ...parsed, identity, firstSeenAt: saved?.identity === identity ? saved.firstSeenAt ?? saved.fetchedAt : now });
    } catch (error) { failures.push(`${site.id}/${model.id} ensemble: ${String(error)}`); if (saved) ensembles.push(saved); }
  }
  const newest = new Map<string, string[]>();
  for (const r of records.values()) { const list = newest.get(r.modelId) ?? []; if (!list.includes(r.runTime)) list.push(r.runTime); newest.set(r.modelId, list.sort().slice(-2)); }
  return { location: site, runs: [...records.values()].filter(r => newest.get(r.modelId)?.includes(r.runTime)), ensembles, operational, checkedAt: now };
}
export function generateCases(site: SavedSite, context: ForecastContext, state: LearningState, now: number): LearningCase[] {
  const localContext = { ...context, location: site.location.id, coordinates: site.location, operational: site.operational, metOffice: site.location.id === 'peterborough' ? context.metOffice : undefined };
  const baseline = buildForecastSignals(site.runs, now, { ...localContext, policy: undefined });
  const active = buildForecastSignals(site.runs, now, localContext);
  const ensembles = buildEnsembleIndex(site.ensembles).atTime(now);
  const cases: LearningCase[] = [];
  for (let time = Math.ceil(now / HOUR) * HOUR; time < now + 168 * HOUR; time += HOUR) {
    for (const variable of ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover', 'precipitation'] as const) {
      const period = variable === 'precipitation' ? 3 * HOUR : variable === 'wind_gusts_10m' ? HOUR : 0;
      if (variable === 'precipitation' && time % (3 * HOUR)) continue;
      const end = time + period;
      const samples = variable === 'precipitation' ? baseline.aggregate(variable, [time + HOUR, time + 2 * HOUR, end], 'sum', true).filter(s => (s.nativeHours ?? 1) <= 3 && time % ((s.nativeHours ?? 1) * HOUR) === 0) : baseline.samples(variable, end, true);
      const sources = samples.map(s => ({ family: s.family, modelId: s.modelId, value: s.value }));
      // Rainfall median/conditional amounts never enter an expected-amount blend.
      const mo = variable === 'precipitation' ? undefined : baseline.processed(variable, time, end);
      if (mo) sources.push({ family: 'UKMO', modelId: 'metoffice_blended', value: mo.value });
      if (!sources.length) continue;
      const row: LearningCase = { id: `${site.location.id}:${now}:${variable}:${time}`, generatedAt: now, location: site.location.id, latitude: site.location.latitude, longitude: site.location.longitude, start: time, end, leadHours: (time - now) / HOUR, variable, unit: variable === 'temperature_2m' ? '°C' : variable === 'precipitation' ? 'mm' : variable === 'cloud_cover' ? 'fraction' : 'm/s', definition: variable === 'temperature_2m' ? TEMPERATURE_DEFINITION : variable === 'precipitation' ? RAIN_DEFINITION : variable === 'cloud_cover' ? 'total-cloud-fraction-point-v1' : variable === 'wind_speed_10m' ? '10m-sustained-wind-point-ms-v1' : GUST_DEFINITION, modelVersion: MODEL_VERSION, defaultVersion: DEFAULT_VERSION, policyVersion: context.policy?.version ?? DEFAULT_VERSION, sources, sourceVersions: samples.map(s => `${s.modelId}@${s.issuedAt}:${s.sourceTime}:${s.fetchedAt}`), defaultValue: 0, activeValue: 0, candidates: {} };
      row.unadjustedValue = familyMean(row.sources.filter(s => s.modelId !== 'metoffice_blended'));
      if (mo) { row.metOfficeValue = mo.value; if (row.unadjustedValue !== null) { const difference = mo.value - row.unadjustedValue; row.disagreement = { difference, flagged: Math.abs(difference) >= (variable === 'temperature_2m' ? DIAGNOSTIC_THRESHOLDS.temperatureC : variable === 'wind_gusts_10m' ? DIAGNOSTIC_THRESHOLDS.gustMph / 2.23694 : Infinity) }; } }
      row.defaultValue = predictCase(row);
      row.activeValue = predictCase(row, policyRule(context.policy, variable, row.leadHours, row.location, now));
      for (const candidate of state.candidates.filter(c => c.state === 'pending' && c.rule.location === row.location && c.rule.variable === row.variable && (c.rule.band === -1 || candidateBand(row.leadHours) === c.rule.band))) row.candidates[candidate.id] = predictCase(row, candidate.rule);
      cases.push(row);
      if (variable === 'precipitation') {
        const event = baseline.event(PRECIP_3H, time, end, ensembles);
        const activeEvent = active.event(PRECIP_3H, time, end, ensembles);
        if (event.basis === 'ensemble-probability' && event.value !== null && activeEvent.value !== null && event.components?.length) {
          const p: LearningCase = { ...row, id: row.id + ':probability', variable: 'precipitation_probability', unit: 'fraction', definition: `${RAIN_DEFINITION}:>=0.2`, probabilityBasis: 'ensemble-probability', sources: [...event.components], defaultValue: event.value, activeValue: activeEvent.value, candidates: {} };
          const processed = baseline.processed('precipitation_probability', time, end, 'probability', 0.2);
          p.unadjustedValue = familyMean(event.components);
          delete p.metOfficeValue; delete p.disagreement;
          if (processed) { p.sources.push({ modelId: 'metoffice_blended', family: 'UKMO', value: processed.value }); p.metOfficeValue = processed.value; const difference = processed.value - p.unadjustedValue!; p.disagreement = { difference, flagged: Math.abs(difference) >= DIAGNOSTIC_THRESHOLDS.precipitationProbability }; }
          p.defaultValue = predictCase(p);
          for (const candidate of state.candidates.filter(c => c.state === 'pending' && c.rule.location === p.location && c.rule.variable === p.variable && (c.rule.band === -1 || candidateBand(p.leadHours) === c.rule.band))) p.candidates[candidate.id] = predictCase(p, candidate.rule);
          cases.push(p);
        }
      }
    }
  }
  return cases;
}
import { leadBand as candidateBand } from '../../src/forecast/policy.ts';
export async function collectForecastUpgrade(root: URL, apiKey: string | undefined, now = Date.now()) {
  const store = forecastStore(root);
  const fetchJson = budgetedCollectorJson(store, fetch, now);
  await mkdir(new URL('forecast/archive/', root), { recursive: true });
  const failures: string[] = [];
  try { await collectMetOffice(store, apiKey, now); } catch (error) { failures.push(`Optional Met Office cache/budget: ${String(error)}`); }
  let previous: { sites: SavedSite[]; generatedAt: number } = { sites: [], generatedAt: 0 };
  try { previous = await store.read('forecast/collector-cache.json', previous); if (!Array.isArray(previous.sites) || !finite(previous.generatedAt)) throw new Error('Invalid collector cache'); } catch (error) { previous = { sites: [], generatedAt: 0 }; failures.push(`Collector cache rejected: ${String(error)}`); }
  if (now - previous.generatedAt < 45 * 60_000) return;
  let state: LearningState;
  try { state = validateLearningState(await store.read<LearningState>('forecast/learning-state.json', newLearningState()), now); } catch (error) { state = newLearningState(); failures.push(`Corrupt learning state rejected: ${String(error)}`); }
  if (state.active) { try { validatePolicy(state.active, now); } catch { delete state.active; } }
  let observations: { observations: Observation[]; station?: Observation['station'] } = { observations: [] };
  try { observations = await store.read('obs/egxt.json', observations); if (!Array.isArray(observations.observations)) throw new Error('Invalid observation archive'); } catch (error) { observations = { observations: [] }; failures.push(`Observation archive rejected: ${String(error)}`); }
  let rainfall: { gauge?: RainGauge; observations: LearningObservation[] } = { observations: [] };
  try { rainfall = await collectRain(store, now, failures, fetchJson); } catch (error) { failures.push(`Optional rainfall cache: ${String(error)}`); }
  const sites: SiteConfig[] = [{ id: 'peterborough', ...LOCATION }, ...(observations.station ? [{ ...observations.station }] : []), ...(rainfall.gauge ? [{ id: rainfall.gauge.id, latitude: rainfall.gauge.latitude, longitude: rainfall.gauge.longitude }] : [])];
  const updates: ModelUpdates = {};
  for (const model of DETERMINISTIC_MODELS) {
    try { updates[model.id] = parseModelUpdate(await fetchJson(`https://api.open-meteo.com/data/${model.id}/static/meta.json`), now); }
    catch (error) { failures.push(`${model.id} publication metadata: ${String(error)}`); }
  }
  const context: ForecastContext = { updates, policy: state.active };
  try { context.metOffice = validateMetOffice(await store.read('forecast/metoffice.json', null)); } catch { /* optional feed */ }
  const collected: SavedSite[] = [];
  for (const site of sites) collected.push(await collectSite(site, previous.sites.find(s => s.location.id === site.id), updates, now, failures, fetchJson));
  const cases = collected.flatMap(site => generateCases(site, context, state, now));
  if (!cases.length) throw new Error('No forecast cases; previous forecast/learning publications retained');
  const generation: Generation = { schema: 1, generatedAt: now, modelVersion: MODEL_VERSION, policyVersion: state.active?.version ?? DEFAULT_VERSION, context, sites: collected, cases, candidateRules: state.candidates.filter(c => c.state === 'pending') };
  const day = new Date(now).toISOString().slice(0, 10);
  const archiveFile = new URL(`forecast/archive/${day}.json.gz`, root);
  let today: StoredGeneration[] = [];
  try { today = JSON.parse(gunzipSync(await readFile(archiveFile)).toString()); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const sourceDirectory = new URL('forecast/inputs/', root);
  await mkdir(sourceDirectory, { recursive: true });
  const archiveInput = async (data: unknown): Promise<string> => {
    const text = JSON.stringify(data);
    const hash = createHash('sha256').update(text).digest('hex');
    const path = `forecast/inputs/${hash}.json.gz`;
    try { await writeFile(new URL(path, root), gzipSync(text), { flag: 'wx' }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    return path;
  };
  const inputs: StoredGeneration['inputs'] = [];
  for (const site of collected) {
    // Deduplicate immutable source inputs across every generation and collection
    // site. Per-generation check/fetch times remain in the references and cases.
    for (const run of site.runs) {
      const { fetchedAt, checkedAt: _checked, ...input } = run;
      inputs.push({ path: await archiveInput({ location: site.location, run: input }), fetchedAt });
    }
    if (site.operational) inputs.push({ path: await archiveInput({ location: site.location, operational: site.operational }), fetchedAt: site.operational.checkedAt });
    for (const ensemble of site.ensembles) {
      const { fetchedAt, ...input } = ensemble;
      inputs.push({ path: await archiveInput({ location: site.location, ensemble: input }), fetchedAt });
    }
  }
  const contextPath = await archiveInput(context);
  if (!today.some(g => Math.floor(g.generatedAt / HOUR) === Math.floor(now / HOUR))) today.push({ schema: generation.schema, generatedAt: now, modelVersion: generation.modelVersion, policyVersion: generation.policyVersion, cases, candidateRules: generation.candidateRules, inputs, contextPath });
  const temp = new URL(`forecast/archive/${day}.json.gz.tmp`, root); await writeFile(temp, gzipSync(JSON.stringify(today))); await rename(temp, archiveFile);
  const matchedObservations = [...metarLearningObservations(observations.observations), ...rainfall.observations];
  await store.save('forecast/observations.json', matchedObservations);
  const historyMap = new Map<string, LearningCase>();
  const due = state.evaluatedAt < weekStart(now - 2 * DAY);
  const liveInputs = new Set<string>();
  if (due) for (const name of (await readdir(new URL('forecast/archive/', root))).filter(n => /^\d{4}-\d{2}-\d{2}\.json\.gz$/.test(n)).sort()) {
    if (Date.parse(name.slice(0, 10)) < now - 120 * DAY) { await unlink(new URL(`forecast/archive/${name}`, root)); continue; }
    const records: StoredGeneration[] = JSON.parse(gunzipSync(await readFile(new URL(`forecast/archive/${name}`, root))).toString());
    for (const row of matchLearning(records.flatMap(g => g.cases).filter(c => c.start <= now && c.start >= now - 100 * DAY), matchedObservations)) {
      const key = `${row.location}:${row.variable}:${row.start}:${candidateBand(row.leadHours)}:${weekStart(row.generatedAt)}:${row.policyVersion}:${Object.keys(row.candidates).sort().join(',')}`;
      if (!historyMap.has(key) || historyMap.get(key)!.generatedAt > row.generatedAt) historyMap.set(key, row);
    }
    for (const record of records) { if (record.contextPath) liveInputs.add(record.contextPath); for (const input of record.inputs ?? []) liveInputs.add(input.path); }
  }
  // Remove only unreferenced generated inputs after the 120-day archive retention.
  if (due) for (const file of (await readdir(sourceDirectory)).filter(n => /^[a-f0-9]{64}\.json\.gz$/.test(n))) if (!liveInputs.has(`forecast/inputs/${file}`)) await unlink(new URL(file, sourceDirectory));
  state = evaluateLearning(state, [...historyMap.values()], matchedObservations, now);
  await store.save('forecast/learning-state.json', state);
  await store.save('forecast/policy.json', { schema: 1, publishedAt: now, revision: state.active?.version ?? `default-${state.evaluatedAt}`, policy: state.active ?? null, reason: state.active ? 'Automatically promoted using subsequent observations; monitored weekly' : 'Conservative default; no active policy has passed observation gates' });
  const peterborough = collected.find(s => s.location.id === 'peterborough')!;
  await store.save('forecast/latest.json', { schema: 1, generatedAt: now, location: 'peterborough', runs: peterborough.runs, updates, operational: peterborough.operational });
  await store.save('forecast/collector-cache.json', { generatedAt: now, sites: collected });
  await store.save('forecast/diagnostics.json', { generatedAt: now, defaultVersion: DEFAULT_VERSION, activeVersion: state.active?.version ?? DEFAULT_VERSION, evaluationCaseCount: historyMap.size, matchedObservationCount: matchedObservations.length, disagreements: cases.filter(c => c.disagreement?.flagged).map(c => ({ location: c.location, variable: c.variable, start: c.start, end: c.end, original: c.unadjustedValue, metOffice: c.metOfficeValue, ...c.disagreement })), candidates: state.candidates.map(c => ({ id: c.id, state: c.state, trainingCases: c.trainingCases, trainingDates: c.trainingDates, blocks: c.blocks })), changes: state.changes, failures, limitations: ['No validated numerical radar nowcast is connected; immediate outlook uses fresh model data.', 'Wittering temperature verification is station-specific; no temperature correction or weight policy is transferred to central Peterborough.', 'METAR gust periods are incompatible with preceding-hour maximum gusts; gust learning is disabled without matching observations.', ...(rainfall.gauge?.timestampConvention === 'unknown' ? ['EA measured rainfall is archived provisionally; its unconfirmed interval timestamp convention prevents rainfall learning.'] : []), 'No measured improvement is claimed before observation-based promotion gates pass.'] });
  console.log(`Forecast upgrade: ${cases.length} new cases; ${state.candidates.filter(c => c.state === 'pending').length} pending automatic candidates; active ${state.active?.version ?? DEFAULT_VERSION}; ${failures.length} source failures retained as diagnostics`);
}
