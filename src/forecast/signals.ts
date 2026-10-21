import type { CachedRun } from '../types.ts';
import { DETERMINISTIC_MODELS } from '../config/models.ts';
import type { VariableId } from '../config/models.ts';
import { finite, HOUR, utc, provenanceOf } from '../data/contracts.ts';
import type { Family, EventEstimate, Provenance } from '../data/contracts.ts';
import { aggregateEvent, eventTimes, meets, weightedMedian } from './events.ts';
import type { EventSpec, EnsembleIndex } from './events.ts';

export interface ModelValue extends Provenance { family: Family; value: number; runTime: number; validTime: number; gapFilled: boolean; stale: boolean; contributions?: Provenance[] }
const unit = (variable: string) => /^wind_/.test(variable) ? 'm/s' : variable === 'cloud_cover' ? 'fraction' : variable === 'temperature_2m' ? '°C' : variable === 'snowfall' ? 'cm' : variable === 'precipitation' ? 'mm' : variable === 'pressure_msl' ? 'hPa' : 'code';
export function familyWeights<T extends { family: Family; modelId: string }>(values: T[]): { source: T; weight: number }[] {
  const families = new Map<Family, Map<string, T[]>>();
  for (const value of values) {
    if (!families.has(value.family)) families.set(value.family, new Map());
    const models = families.get(value.family)!;
    if (!models.has(value.modelId)) models.set(value.modelId, []);
    models.get(value.modelId)!.push(value);
  }
  return [...families.values()].flatMap(models => [...models.values()].flatMap(list => list.map(source => ({ source, weight: 1 / families.size / models.size / list.length }))));
}
export const familyMean = <T extends { family: Family; modelId: string; value: number }>(values: T[]) => values.length ? familyWeights(values).reduce((s, v) => s + v.source.value * v.weight, 0) : null;
interface RunLookup { groups: Map<string, CachedRun[]>; raw: Map<CachedRun, Map<number, number>>; latest: Map<string, Map<number, ModelValue>> }
// WeatherData publishes a new immutable array for each load. Clock ticks reuse these
// indexed arrays; freshness is evaluated by the lightweight methods below.
const lookupCache = new WeakMap<CachedRun[], RunLookup>();
export function buildForecastSignals(runs: CachedRun[], now = Date.now()) {
  const cached = lookupCache.get(runs);
  const groups = cached?.groups ?? new Map<string, CachedRun[]>();
  const raw = cached?.raw ?? new Map<CachedRun, Map<number, number>>();
  const latest = cached?.latest ?? new Map<string, Map<number, ModelValue>>();
  const models = new Map(DETERMINISTIC_MODELS.map(m => [m.id, m]));
  if (!cached) {
    for (const run of runs) {
      if (run.unitState === 'unknown-legacy') continue;
      if (!models.has(run.modelId)) continue;
      const key = `${run.modelId}:${run.variable}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(run);
      const lookup = new Map<number, number>();
      run.times.forEach((time, i) => {
        const v = run.values[i];
        if (finite(v) && (run.variable === 'temperature_2m' || v >= 0) && (run.variable !== 'cloud_cover' || v <= 100)) lookup.set(utc(time), run.variable === 'cloud_cover' ? v / 100 : v);
      });
      raw.set(run, lookup);
    }
    for (const [key, list] of groups) {
      list.sort((a, b) => utc(b.runTime) - utc(a.runTime));
      // Forecast-only policy: up to three previous distinct runs fill publishing/past-hour
      // gaps, retaining their real provenance. This keeps whole-today cohorts possible
      // after newer runs start later in the day. The public LatestIndex stays unchanged.
      const distinct = [...new Map(list.map(r => [r.runTime, r])).values()];
      groups.set(key, distinct);
      const lookup = new Map<number, ModelValue>();
      for (const run of distinct.slice(0, 4).reverse()) for (const [time, value] of raw.get(run)!) {
        const runTime = utc(run.runTime);
        lookup.set(time, { provider: 'Open-Meteo Single Runs', modelId: run.modelId, family: models.get(run.modelId)!.family, value, runTime, issuedAt: runTime, sourceTime: null, fetchedAt: run.fetchedAt, validFrom: time, validTo: time + HOUR, units: { [run.variable]: unit(run.variable) }, coverage: run !== distinct[0] ? 'Previous distinct run gap fill' : 'Newest available run', validTime: time, gapFilled: run !== distinct[0], stale: now - runTime > 36 * HOUR });
      }
      latest.set(key, lookup);
    }
    lookupCache.set(runs, { groups, raw, latest });
  }
  const samples = (variable: VariableId, time: number, freshOnly = false): ModelValue[] => DETERMINISTIC_MODELS.flatMap(model => {
    const indexed = latest.get(`${model.id}:${variable}`)?.get(time);
    const value = indexed ? { ...indexed, stale: now - indexed.runTime > 36 * HOUR } : undefined;
    return value && (!freshOnly || !value.stale) ? [value] : [];
  });
  const modelAggregate = (modelId: string, variable: VariableId, times: number[], operation: EventSpec['operation'], freshOnly = false): ModelValue | null => {
    const lookup = latest.get(`${modelId}:${variable}`);
    const data = times.map(t => { const v = lookup?.get(t); return v ? { ...v, stale: now - v.runTime > 36 * HOUR } : undefined; });
    if (freshOnly && data.some(v => v?.stale)) return null;
    const value = aggregateEvent(data.map(v => v?.value ?? null), operation);
    if (value === null || !data[0]) return null;
    const contributions = [...new Map(data.map(v => [`${v!.modelId}:${v!.runTime}`, provenanceOf(v!)] as const)).values()];
    return { ...data[0], value, stale: data.some(v => v?.stale), issuedAt: contributions.length === 1 ? contributions[0].issuedAt : null, runTime: Math.min(...data.map(v => v!.runTime)), validFrom: times[0], validTo: times.at(-1)! + HOUR, contributions };
  };
  const aggregate = (variable: VariableId, times: number[], operation: EventSpec['operation'], freshOnly = false) => DETERMINISTIC_MODELS.flatMap(model => {
    const value = modelAggregate(model.id, variable, times, operation, freshOnly); return value ? [value] : [];
  });
  const agreement = (spec: EventSpec, start: number, end: number): EventEstimate => {
    const values = aggregate(spec.variable, eventTimes(spec, start, end), spec.operation, true);
    const weights = familyWeights(values);
    return { basis: 'deterministic-agreement', value: values.length ? weights.reduce((s, v) => s + (meets(v.source.value, spec) ? v.weight : 0), 0) : null,
      start, end, threshold: spec.label, usable: values.length, expected: DETERMINISTIC_MODELS.length, systems: values.map(v => v.modelId), status: !values.length ? 'unavailable' : values.length < DETERMINISTIC_MODELS.length ? 'partial' : 'ok',
      expectedAmount: familyMean(values), conditionalAmount: weightedMedian(weights.filter(v => meets(v.source.value, spec)).map(v => ({ value: v.source.value, weight: v.weight }))), provenance: values.flatMap(v => v.contributions ?? [provenanceOf(v)]) };
  };
  const support = (spec: EventSpec, start: number, end: number): EventEstimate => {
    const required = eventTimes(spec, start, end);
    const byModel: { modelId: string; family: Family; value: number }[] = [];
    let usable = 0;
    const provenance: Provenance[] = [];
    for (const model of DETERMINISTIC_MODELS) {
      const recent = (groups.get(`${model.id}:${spec.variable}`) ?? []).filter(r => now - utc(r.runTime) <= 36 * HOUR).slice(0, 4);
      const values = recent.flatMap(run => {
        const value = aggregateEvent(required.map(t => raw.get(run)?.get(t) ?? null), spec.operation);
        if (value === null) return [];
        provenance.push({ provider: 'Open-Meteo Single Runs', modelId: model.id, family: model.family, issuedAt: utc(run.runTime), sourceTime: null, fetchedAt: run.fetchedAt, validFrom: start, validTo: end, units: { [spec.variable]: unit(spec.variable) }, coverage: 'Complete raw run window; no gap-fill duplication' });
        return [{ value, weight: 2 ** (-(now - utc(run.runTime)) / (12 * HOUR)) }];
      });
      if (!values.length) continue;
      usable += values.length;
      const total = values.reduce((s, v) => s + v.weight, 0);
      byModel.push({ modelId: model.id, family: model.family, value: values.reduce((s, v) => s + (meets(v.value, spec) ? v.weight : 0), 0) / total });
    }
    return { basis: 'recent-run-support', value: familyMean(byModel), start, end, threshold: spec.label, usable, expected: DETERMINISTIC_MODELS.length * 4, systems: byModel.map(v => v.modelId), status: byModel.length ? 'partial' : 'unavailable', expectedAmount: null, conditionalAmount: null, provenance };
  };
  return { samples, aggregate, modelAggregate, agreement, support, raw, groups,
    mean: (variable: VariableId, time: number, freshOnly = false) => {
      const values = samples(variable, time, freshOnly);
      return familyMean(values.some(v => !v.stale) ? values.filter(v => !v.stale) : values);
    },
    event(spec: EventSpec, start: number, end: number, ensembles?: EnsembleIndex): EventEstimate {
      const probability = ensembles?.event(spec, start, end);
      return probability?.value !== null && probability?.value !== undefined ? probability : agreement(spec, start, end);
    },
    supporting(spec: EventSpec, start: number, end: number) {
      const values = aggregate(spec.variable, eventTimes(spec, start, end), spec.operation, true).filter(v => meets(v.value, spec));
      return { models: values.length, families: new Set(values.map(v => v.family)).size, sources: values };
    },
  };
}
export type ForecastSignals = ReturnType<typeof buildForecastSignals>;
