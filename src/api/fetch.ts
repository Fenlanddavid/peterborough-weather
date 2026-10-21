import { LOCATION } from '../config/models';
import type { VariableId } from '../config/models';
import type { CachedRun } from '../types';
import { putCachedRuns, pruneOldRuns } from './db';
import { BASE_VARIABLES, getRunTasks, makeRunKey } from './runSchedule';
import { scheduledFetch } from '../data/scheduler';

const SINGLE_RUNS_BASE = 'https://single-runs-api.open-meteo.com/v1/forecast';

type FetchResult = 'ok' | 'unavailable' | 'network';

/**
 * Fetch every variable for one model run in a single request (Open-Meteo counts a request
 * with up to 10 variables and 7 days as one call), then store one record per variable.
 */
async function fetchModelRun(modelId: string, runTime: string, variables: VariableId[]): Promise<FetchResult> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    hourly: variables.join(','),
    models: modelId,
    run: runTime,
    forecast_days: '7',
    timezone: 'UTC',
    wind_speed_unit: 'ms',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  });

  let res: Response;
  try {
    res = await scheduledFetch(`${SINGLE_RUNS_BASE}?${params}`);
  } catch {
    return 'network';
  }
  if (res.status === 429 || res.status >= 500) return 'network';
  if (!res.ok) return 'unavailable'; // run not published yet, or not offered for this model

  try {
    const data = await res.json();
    const hourly = data?.hourly;
    if (!hourly || !Array.isArray(hourly.time) || data.utc_offset_seconds !== 0) return 'unavailable';
    const units: Record<string, string> = { temperature_2m: '°C', precipitation: 'mm', snowfall: 'cm', wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', pressure_msl: 'hPa', cloud_cover: '%', is_day: '', weather_code: 'wmo code' };
    if (hourly.time.some((t: unknown, i: number) => typeof t !== 'string' || !Number.isFinite(Date.parse(`${t}Z`)) || (i > 0 && t <= hourly.time[i - 1]))) return 'unavailable';
    const fetchedAt = Date.now();
    const records: CachedRun[] = variables
      .filter((variable) => data.hourly_units?.[variable] === units[variable] && Array.isArray(hourly[variable]) && hourly[variable].length === hourly.time.length && hourly[variable].every((v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v)) && hourly[variable].some((v: unknown) => typeof v === 'number'))
      .map((variable) => ({
        key: makeRunKey(modelId, runTime, variable),
        modelId, runTime, variable,
        times: hourly.time,
        values: hourly[variable],
        fetchedAt,
      }));
    if (!records.length) return 'unavailable';
    await putCachedRuns(records);
    return 'ok';
  } catch {
    return 'network';
  }
}

export interface FetchSummary {
  requested: number;
  ok: number;
  unavailable: number;
  failed: number;
}

/** Fetch new or still-publishing runs for all deterministic models. */
export async function fetchAllDeterministicRuns(
  cached: CachedRun[],
  onProgress?: (done: number, total: number) => void
): Promise<FetchSummary> {
  await pruneOldRuns();

  const tasks = getRunTasks(cached).sort((a, b) => b.runTime.localeCompare(a.runTime));

  const summary: FetchSummary = { requested: tasks.length, ok: 0, unavailable: 0, failed: 0 };
  let done = 0;
  onProgress?.(0, tasks.length);

  // ~120 requests on a cold start, a handful afterwards; stay well under 600/min.
  const BATCH_SIZE = 6;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    if (typeof document !== 'undefined' && document.hidden) break;
    const batch = tasks.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (t) => {
      let result = await fetchModelRun(t.modelId, t.runTime, t.variables);
      // If a model rejects one of the optional variables, don't lose its core data.
      if (result === 'unavailable' && t.variables.length > BASE_VARIABLES.length) {
        result = await fetchModelRun(t.modelId, t.runTime, BASE_VARIABLES);
      }
      if (result === 'ok') summary.ok++;
      else if (result === 'unavailable') summary.unavailable++;
      else summary.failed++;
      onProgress?.(++done, tasks.length);
    }));
    if (i + BATCH_SIZE < tasks.length) await new Promise((r) => setTimeout(r, 200));
  }
  return summary;
}

export { makeRunKey };
