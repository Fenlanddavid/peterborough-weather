/** Descriptive historical comparison only; never a promotion/test gate. */
import { readFile, writeFile } from 'node:fs/promises';
import { expandForecasts } from './lib/verificationArchive.ts';
import { matchForecasts, errorMetrics } from '../src/verification/verification.ts';
import type { MatchedPair } from '../src/verification/verification.ts';
import { blendValue, familyMean, DEFAULT_VERSION } from '../src/forecast/policy.ts';
const root = new URL('../public/data/', import.meta.url);
const forecasts = expandForecasts(JSON.parse(await readFile(new URL('verification/forecasts.json', root), 'utf8')));
const observations = JSON.parse(await readFile(new URL('obs/egxt.json', root), 'utf8')).observations;
const pairs = matchForecasts(forecasts, observations);
const cohorts = new Map<string, MatchedPair[]>();
for (const p of pairs) {
  const f = p.forecast;
  const key = `${f.station.id}:${f.variable}:${f.leadHours}:${f.validTime}`;
  if (!cohorts.has(key)) cohorts.set(key, []);
  cohorts.get(key)!.push(p);
}
const scores = [...cohorts.values()].map(cohort => {
  const first = cohort[0];
  const sources = cohort.map(p => ({ modelId: p.forecast.modelId, family: p.forecast.family, value: p.forecast.value }));
  return { forecast: first.forecast, observed: first.observed, old: familyMean(sources)!, prior: blendValue(sources, undefined, first.forecast.leadHours)! };
});
const report = {
  defaultVersion: DEFAULT_VERSION,
  matching: 'matchForecasts: nearest eligible METAR within ±30 min, one UTC-hour bucket; one score per valid time and lead, same sources/observations for both blends',
  range: [Math.min(...scores.map(p => p.forecast.validTime)), Math.max(...scores.map(p => p.forecast.validTime))].map(t => new Date(t).toISOString()),
  leads: [...new Set(scores.map(p => p.forecast.leadHours))].sort((a, b) => a - b).map(leadHours => {
    const rows = scores.filter(p => p.forecast.leadHours === leadHours);
    return { leadHours, equalFamily: errorMetrics(rows.map(p => ({ forecast: p.forecast, error: p.old - p.observed }))), defaultPrior: errorMetrics(rows.map(p => ({ forecast: p.forecast, error: p.prior - p.observed }))) };
  }),
  caveat: 'Small historical Wittering sample used to choose this heuristic, not an independent held-out optimum or proof of Peterborough improvement. Figures are descriptive, never a test gate.',
};
await writeFile(new URL('../docs/default-prior-rescore.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
