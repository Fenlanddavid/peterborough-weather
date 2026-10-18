import { DETERMINISTIC_MODELS, ENSEMBLE_MODELS, VARIABLES, LOCATION, RUN_LOOKBACK_HOURS, MS_PER_HOUR } from '../config/models';
import type { VariableId } from '../config/models';
import type { CachedRun, EnsembleData } from '../types';
import { getCachedRun, putCachedRun, pruneOldRuns, putEnsemble } from './db';

const SINGLE_RUNS_BASE = 'https://single-runs-api.open-meteo.com/v1/forecast';
const ENSEMBLE_BASE = 'https://ensemble-api.open-meteo.com/v1/forecast';

function makeRunKey(modelId: string, runTime: string, variable: VariableId): string {
  return `${modelId}__${runTime}__${variable}`;
}

/** Generate all run times for a model within the lookback window */
function generateRunTimes(cycles: number[], lookbackHours: number): string[] {
  const now = Date.now();
  const cutoff = now - lookbackHours * MS_PER_HOUR;
  const times: string[] = [];

  // Start from the most recent cycle and go back
  const nowDate = new Date(now);
  const todayUTC = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate()));

  for (let dayOffset = 0; dayOffset <= Math.ceil(lookbackHours / 24) + 1; dayOffset++) {
    const day = new Date(todayUTC.getTime() - dayOffset * 24 * MS_PER_HOUR);
    for (const cycle of cycles) {
      const runDate = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), cycle));
      const runMs = runDate.getTime();
      if (runMs <= now && runMs >= cutoff) {
        const iso = runDate.toISOString().slice(0, 16); // "2026-10-17T00:00"
        times.push(iso);
      }
    }
  }

  return [...new Set(times)].sort();
}

/** Fetch a single run for one model/variable. Returns null if the run isn't available yet. */
async function fetchSingleRun(modelId: string, runTime: string, variable: VariableId): Promise<CachedRun | null> {
  const params = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    hourly: variable,
    models: modelId,
    run: runTime,
    forecast_days: '7',
    timezone: 'UTC',
  });

  try {
    const res = await fetch(`${SINGLE_RUNS_BASE}?${params}`);
    if (!res.ok) return null;

    const data = await res.json();
    const hourly = data.hourly;
    if (!hourly || !hourly.time || !hourly[variable]) return null;

    const key = makeRunKey(modelId, runTime, variable);
    const run: CachedRun = {
      key,
      modelId,
      runTime,
      variable,
      times: hourly.time,
      values: hourly[variable],
      fetchedAt: Date.now(),
    };

    await putCachedRun(run);
    return run;
  } catch {
    return null; // Network error, skip silently
  }
}

/** Fetch all missing runs for all deterministic models and variables */
export async function fetchAllDeterministicRuns(
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  await pruneOldRuns();

  const tasks: { modelId: string; runTime: string; variable: VariableId }[] = [];

  for (const model of DETERMINISTIC_MODELS) {
    const runTimes = generateRunTimes(model.runCycles, RUN_LOOKBACK_HOURS);
    for (const runTime of runTimes) {
      for (const v of VARIABLES) {
        const key = makeRunKey(model.id, runTime, v.id);
        const cached = await getCachedRun(key);
        if (!cached) {
          tasks.push({ modelId: model.id, runTime, variable: v.id });
        }
      }
    }
  }

  let done = 0;
  const total = tasks.length;
  onProgress?.(0, total);

  // Fetch in batches to respect rate limits (600/min ≈ 10/sec)
  const BATCH_SIZE = 8;
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (t) => {
        await fetchSingleRun(t.modelId, t.runTime, t.variable);
        done++;
        onProgress?.(done, total);
      })
    );
    // Small delay between batches
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}

/** Fetch current ensemble snapshot for all ensemble models and variables */
export async function fetchEnsembles(
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const tasks: { modelId: string; variable: VariableId; label: string }[] = [];
  for (const model of ENSEMBLE_MODELS) {
    for (const v of VARIABLES) {
      tasks.push({ modelId: model.id, variable: v.id, label: model.label });
    }
  }

  let done = 0;
  onProgress?.(0, tasks.length);

  for (const t of tasks) {
    try {
      const params = new URLSearchParams({
        latitude: String(LOCATION.latitude),
        longitude: String(LOCATION.longitude),
        hourly: t.variable,
        models: t.modelId,
        forecast_days: '7',
        timezone: 'UTC',
      });

      const res = await fetch(`${ENSEMBLE_BASE}?${params}`);
      if (res.ok) {
        const data = await res.json();
        const hourly = data.hourly;
        if (hourly && hourly.time) {
          // Extract member data — keys like temperature_2m_member01
          const memberKeys = Object.keys(hourly)
            .filter((k) => k.startsWith(t.variable + '_member'))
            .sort();

          if (memberKeys.length > 0) {
            const members = memberKeys.map((k) => hourly[k] as (number | null)[]);
            const ensemble: EnsembleData = {
              modelId: t.modelId,
              variable: t.variable,
              times: hourly.time,
              members,
              fetchedAt: Date.now(),
            };
            await putEnsemble(ensemble);
          }
        }
      }
    } catch {
      // Skip silently
    }
    done++;
    onProgress?.(done, tasks.length);
  }
}

export { makeRunKey };
