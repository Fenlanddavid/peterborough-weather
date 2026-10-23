import { DETERMINISTIC_MODELS } from '../config/models.ts';
import type { VariableId } from '../config/models.ts';
import type { CachedRun } from '../types.ts';
import { getAllCachedRuns, putCachedRuns, pruneOldRuns, readStore, writeStore } from './db.ts';
import { BASE_VARIABLES, getRunTasks, makeRunKey } from './runSchedule.ts';
import { scheduledFetch, HttpError } from '../data/scheduler.ts';
import { parseModelUpdate, latestRunCandidates } from './modelUpdates.ts';
import type { ModelUpdates, ModelUpdate } from './modelUpdates.ts';
import { operationalUrl, parseOperational } from './operational.ts';
import type { OperationalForecast } from './operational.ts';
import { LOCATION } from '../config/models.ts';
import { FORECAST_VARIABLES, parseRun, runUrl } from './runSource.ts';

type FetchResult = 'ok' | 'unavailable' | 'network' | 'deferred';
const attempts = new Map<string, { failures: number; retryAt: number }>();
export async function fetchUpdates(): Promise<ModelUpdates> {
  const entries = await Promise.all(DETERMINISTIC_MODELS.map(async model => {
    try {
      const raw = await (await scheduledFetch(`https://api.open-meteo.com/data/${model.id}/static/meta.json`, { retries: 0 })).json();
      return [model.id, parseModelUpdate(raw)] as const;
    } catch { return null; }
  }));
  return Object.fromEntries(entries.filter(e => e !== null));
}
async function fetchModelRun(modelId: string, runTime: string, variables: VariableId[], update?: ModelUpdate): Promise<FetchResult> {
  const key = `${modelId}:${runTime}`;
  const attempt = attempts.get(key);
  if (attempt && Date.now() < attempt.retryAt) return 'deferred';
  try {
    let response: Response;
    try { response = await scheduledFetch(runUrl(modelId, runTime, variables), { retries: 0 }); }
    catch (error) {
      // A rejected optional diagnostic must not cost the core forecast. A genuine
      // unavailable run/429/server failure gets backoff rather than a second request.
      if (!(error instanceof HttpError) || error.status !== 400 || variables.length <= BASE_VARIABLES.length) throw error;
      response = await scheduledFetch(runUrl(modelId, runTime, BASE_VARIABLES), { retries: 0 });
    }
    const records = parseRun(await response.json(), modelId, runTime, variables, Date.now(), update);
    if (!records.length) throw new RangeError('Run not published');
    await putCachedRuns(records);
    const complete = records.length === variables.length && records.every(r => !r.values.includes(null));
    if (complete) attempts.delete(key);
    else { const failures = (attempt?.failures ?? 0) + 1; attempts.set(key, { failures, retryAt: Date.now() + Math.min(120, 15 * 2 ** (failures - 1)) * 60_000 }); }
    return 'ok';
  } catch (error) {
    const failures = (attempt?.failures ?? 0) + 1;
    attempts.set(key, { failures, retryAt: Date.now() + Math.min(120, 15 * 2 ** (failures - 1)) * 60_000 });
    return error instanceof HttpError && error.status < 500 && error.status !== 429 ? 'unavailable' : 'network';
  }
}

export interface FetchSummary {
  requested: number;
  ok: number;
  unavailable: number;
  failed: number;
  updates: ModelUpdates;
  operational?: OperationalForecast;
}

/** Fetch new or still-publishing runs for all deterministic models. */
export async function fetchAllDeterministicRuns(
  cached: CachedRun[],
  onProgress?: (done: number, total: number) => void,
  onLatest?: (updates: ModelUpdates, operational?: OperationalForecast) => Promise<void>
): Promise<FetchSummary> {
  await pruneOldRuns();
  const updates = await fetchUpdates();
  const summary: FetchSummary = { requested: 0, ok: 0, unavailable: 0, failed: 0, updates };
  try {
    const update = updates.ukmo_uk_deterministic_2km;
    if (update && Date.now() >= update.availableAt + 10 * 60_000) {
      const previous = await readStore<OperationalForecast>('datasets', 'ukv-operational');
      if (previous && (Date.now() - previous.checkedAt < 15 * 60_000 || previous.metadata.initialisedAt === update.initialisedAt && Date.now() - previous.checkedAt < 60 * 60_000)) summary.operational = previous;
      else { summary.operational = await parseOperational(await (await scheduledFetch(operationalUrl(LOCATION), { retries: 0 })).json(), update, previous ?? undefined); await writeStore('datasets', 'ukv-operational', summary.operational); }
    }
  } catch { /* single-run data remains available */ }
  const tried = new Set<string>();
  const count = (result: FetchResult) => { if (result === 'deferred') return; summary.requested++; if (result === 'ok') summary.ok++; else if (result === 'unavailable') summary.unavailable++; else summary.failed++; };
  // Complete the newest usable forecast for every model before comparison backfill.
  await Promise.all(DETERMINISTIC_MODELS.map(async model => {
    for (const runTime of latestRunCandidates(model.id, updates[model.id], Date.now())) {
      if (typeof document !== 'undefined' && document.hidden) return;
      const existing = cached.filter(r => r.modelId === model.id && r.runTime === runTime);
      if (existing.length >= FORECAST_VARIABLES.length && existing.every(r => !r.values.includes(null))) break;
      tried.add(`${model.id}:${runTime}`);
      const result = await fetchModelRun(model.id, runTime, FORECAST_VARIABLES, updates[model.id]);
      count(result);
      if (result === 'ok') break;
    }
  }));
  await onLatest?.(updates, summary.operational);
  const tasks = getRunTasks(await getAllCachedRuns(), Date.now(), updates).filter(t => !tried.has(`${t.modelId}:${t.runTime}`)).sort((a, b) => b.runTime.localeCompare(a.runTime));
  let done = 0;
  onProgress?.(0, tasks.length);
  const BATCH_SIZE = 6;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    if (typeof document !== 'undefined' && document.hidden) break;
    await Promise.all(tasks.slice(i, i + BATCH_SIZE).map(async t => {
      const result = await fetchModelRun(t.modelId, t.runTime, t.variables, updates[t.modelId]);
      count(result);
      onProgress?.(++done, tasks.length);
    }));
    if (i + BATCH_SIZE < tasks.length) await new Promise(r => setTimeout(r, 200));
  }
  return summary;
}

export { makeRunKey };
