import { writeFile } from 'node:fs/promises';
import { getRunTasks, makeRunKey, BASE_VARIABLES } from '../src/api/runSchedule.ts';
import type { CachedRun } from '../src/types.ts';
import { ENSEMBLE_MODELS } from '../src/forecast/ensembles.ts';
import { estimatedCost } from '../src/data/scheduler.ts';
import { HOUR } from '../src/data/contracts.ts';
const start = Date.parse('2026-10-21T00:00Z');
function corePlan(publishLagHours: number) {
  const cache = new Map<string, CachedRun>();
  let http = 0; let fallback = 0; const byHour: number[] = [];
  for (let i = 0; i < 24; i++) {
    const now = start + i * HOUR;
    const tasks = getRunTasks([...cache.values()], now);
    let count = 0;
    for (const task of tasks) {
      http++; count++;
      if (Date.parse(`${task.runTime}Z`) > now - publishLagHours * HOUR) {
        if (task.variables.length > BASE_VARIABLES.length) { http++; fallback++; count++; }
        continue;
      }
      for (const variable of task.variables) {
        const key = makeRunKey(task.modelId, task.runTime, variable);
        cache.set(key, { key, modelId: task.modelId, variable, runTime: task.runTime, fetchedAt: now, times: [], values: [] });
      }
    }
    byHour.push(count);
  }
  return { http, weightedReserved: http, optionalVariableFallbacks: fallback, byHour };
}
const ensembleCosts = ENSEMBLE_MODELS.map(m => ({ model: m.id, cost: estimatedCost(`https://ensemble-api.open-meteo.com/v1/ensemble?models=${m.id}&hourly=temperature_2m,precipitation,wind_gusts_10m,snowfall,cloud_cover&forecast_days=9`) }));
const ensembleUpdateCost = ensembleCosts.reduce((s, m) => s + m.cost, 0);
const scenarios = [0, 6, 9].map(lag => {
  const core = corePlan(lag);
  // Actual configured plans: sky 3 models × (10 core + 1/2 optional variables),
  // aerosol every 6h; EC46 monthly component + both Seasonal tab requests every 6h.
  const optional = { skyHttp: 72, skyWeighted: 72, airHttp: 2, airWeighted: 2, outlookHttp: 12, outlookWeighted: 12 };
  return { name: `24-hour cold start; deterministic publication lag ${lag}h`, assumptions: 'One visible browser installation, hourly core check for 24h, Night Sky visible for 12h, all supported variables, 4 distinct ensemble cycles; no transient retries. Plans are simulated with the real getRunTasks and endpoint cost function, not provider traffic measurements.', core, ensemble: { checksHttp: 24, forecastHttp: 12, weightedReserved: ensembleUpdateCost * 4 }, optional, plannedHttp: core.http + 24 + 12 + optional.skyHttp + optional.airHttp + optional.outlookHttp, plannedWeighted: core.http + ensembleUpdateCost * 4 + optional.skyWeighted + optional.airWeighted + optional.outlookWeighted };
});
const report = { recordedAt: new Date().toISOString(), ensembleCosts, scenarios, retryCost: 'Every retry/fallback is separately metered. A 429 can pause all requests; no retry bypasses the daily/minute guard.', limits: { optionalDefer: 1500, hardDaily: 2000, rollingMinute: 300 }, caveat: 'A request plan is not a claim about worst-case publication failures or shared-IP traffic. Repeated optional-variable rejection, extra refreshes and other devices can increase provider usage. Hard local limits stop the plan from running indefinitely.' };
await writeFile(new URL('../docs/request-budget.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
