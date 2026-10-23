import { DETERMINISTIC_MODELS, VARIABLES, RUN_LOOKBACK_HOURS, MS_PER_HOUR } from '../config/models.ts';
import type { VariableId } from '../config/models.ts';
import type { CachedRun } from '../types.ts';
import { latestRunCandidates, PUBLICATION_BUFFER } from './modelUpdates.ts';
import type { ModelUpdates } from './modelUpdates.ts';

// Runs fetched this soon after their cycle time may still be publishing.
const PROVISIONAL_HOURS = 9;
// Avoid immediately retrying missing or still-publishing variables on every refresh.
const RECHECK_MS = 30 * 60_000;
export const BASE_VARIABLES: VariableId[] = VARIABLES.map((v) => v.id);
const EXTRA_VARIABLES: VariableId[] = ['snowfall', 'weather_code', 'is_day', 'cloud_cover'];
const EXTRA_RUNS = 4;

export function makeRunKey(modelId: string, runTime: string, variable: VariableId): string {
  return `${modelId}__${runTime}__${variable}`;
}

function generateRunTimes(cycles: number[], now: number): string[] {
  const cutoff = now - RUN_LOOKBACK_HOURS * MS_PER_HOUR;
  const times: string[] = [];
  const nowDate = new Date(now);
  const todayUTC = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());

  for (let dayOffset = 0; dayOffset <= Math.ceil(RUN_LOOKBACK_HOURS / 24) + 1; dayOffset++) {
    for (const cycle of cycles) {
      const runMs = todayUTC - dayOffset * 24 * MS_PER_HOUR + cycle * MS_PER_HOUR;
      if (runMs <= now && runMs >= cutoff) times.push(new Date(runMs).toISOString().slice(0, 16));
    }
  }
  return [...new Set(times)].sort();
}

/** Plan requests from the cache, retrying incomplete runs after the recheck interval. */
export function getRunTasks(cached: CachedRun[], now = Date.now(), updates?: ModelUpdates) {
  const fetchedAt = new Map(cached.filter(run => run.unitState !== 'unknown-legacy').map((run) => [run.key, run.fetchedAt]));
  const tasks: { modelId: string; runTime: string; variables: VariableId[] }[] = [];

  for (const model of DETERMINISTIC_MODELS) {
    const candidates = updates ? latestRunCandidates(model.id, updates[model.id], now) : [];
    const runTimes = [...new Set([...generateRunTimes(model.runCycles, now), ...candidates])].filter(t => !updates || !updates[model.id] || Date.parse(`${t}Z`) <= Date.parse(`${candidates[0]}Z`)).sort();
    const recent = new Set(runTimes.slice(-EXTRA_RUNS));
    for (const runTime of runTimes) {
      const wantsExtras = recent.has(runTime);
      const variables = wantsExtras ? [...BASE_VARIABLES, ...EXTRA_VARIABLES] : BASE_VARIABLES;
      const anchor = fetchedAt.get(makeRunKey(model.id, runTime, 'temperature_2m'));
      const recentlyChecked = anchor !== undefined && now - anchor < RECHECK_MS;
      const update = updates?.[model.id];
      const provisional = anchor !== undefined && (update && update.initialisedAt === Date.parse(`${runTime}Z`)
        ? anchor < update.availableAt + PUBLICATION_BUFFER
        : !update && anchor - Date.parse(`${runTime}Z`) < PROVISIONAL_HOURS * MS_PER_HOUR);
      // A temperature record alone does not guarantee the other variables were saved.
      const missingVariables = variables.some((variable) => !fetchedAt.has(makeRunKey(model.id, runTime, variable)));

      if (anchor === undefined || ((provisional || missingVariables) && !recentlyChecked)) {
        tasks.push({ modelId: model.id, runTime, variables });
      }
    }
  }
  return tasks;
}
