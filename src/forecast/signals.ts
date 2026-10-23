import type { CachedRun } from '../types.ts';
import { DETERMINISTIC_MODELS } from '../config/models.ts';
import type { VariableId } from '../config/models.ts';
import { finite, HOUR, utc, provenanceOf } from '../data/contracts.ts';
import type { Family, EventEstimate, Provenance } from '../data/contracts.ts';
import { aggregateEvent, eventTimes, meets, weightedMedian, nativeWindow, alignmentCoverage } from './events.ts';
import type { EventSpec, EnsembleIndex } from './events.ts';

export interface ModelValue extends Provenance { family: Family; value: number; runTime: number; validTime: number; gapFilled: boolean; stale: boolean; nativeHours?: number; contributions?: Provenance[] }
const unit = (variable: string) => /^wind_/.test(variable) ? 'm/s' : variable === 'cloud_cover' ? 'fraction' : variable === 'temperature_2m' ? '°C' : variable === 'snowfall' ? 'cm' : variable === 'precipitation' ? 'mm' : variable === 'pressure_msl' ? 'hPa' : 'code';
export { familyWeights, familyMean } from './policy.ts';
import { familyWeights, familyMean, blendValue, policyRule } from './policy.ts';
import type { BlendPolicy } from './policy.ts';
import { LOCATION } from '../config/models.ts';
import { runIsStale, nativeResolution } from '../api/modelUpdates.ts';
import type { ModelUpdates } from '../api/modelUpdates.ts';
import { usableMetOffice, DIAGNOSTIC_THRESHOLDS } from './metOffice.ts';
import type { MetOfficeProduct, MetOfficeValue } from './metOffice.ts';
import { withOperational } from '../api/operational.ts';
import type { OperationalForecast } from '../api/operational.ts';
export interface ForecastContext { policy?: BlendPolicy; metOffice?: MetOfficeProduct; operational?: OperationalForecast; updates?: ModelUpdates; location?: string; coordinates?: { latitude: number; longitude: number } }
export interface Disagreement { variable: string; start: number; end: number; original: number; metOffice: number; difference: number; flagged: boolean }
interface RunLookup { groups: Map<string, CachedRun[]>; raw: Map<CachedRun, Map<number, number>>; latest: Map<string, Map<number, ModelValue>> }
// WeatherData publishes a new immutable array for each load. Clock ticks reuse these
// indexed arrays; freshness is evaluated by the lightweight methods below.
const lookupCache = new WeakMap<CachedRun[], RunLookup>();
export function buildForecastSignals(runs: CachedRun[], now = Date.now(), context: ForecastContext = {}) {
  runs = withOperational(runs, context.operational, now, context.coordinates ?? LOCATION);
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
      list.sort((a, b) => utc(b.runTime) - utc(a.runTime) || Number(a.product === 'latest-forecast') - Number(b.product === 'latest-forecast'));
      // Forecast-only policy: up to three previous distinct runs fill publishing/past-hour
      // gaps, retaining their real provenance. This keeps whole-today cohorts possible
      // after newer runs start later in the day. The public LatestIndex stays unchanged.
      const distinct = [...new Map(list.map(r => [r.runTime, r])).values()];
      groups.set(key, distinct);
      const lookup = new Map<number, ModelValue>();
      for (const run of distinct.slice(0, 4).reverse()) for (const [time, value] of raw.get(run)!) {
        const runTime = utc(run.runTime);
        lookup.set(time, { provider: run.product === 'latest-forecast' ? 'Open-Meteo latest UKV (issue unconfirmed)' : 'Open-Meteo Single Runs', modelId: run.modelId, family: models.get(run.modelId)!.family, value, runTime, issuedAt: run.issueConfirmed === false ? null : runTime, sourceTime: run.availableAt ?? null, fetchedAt: run.fetchedAt, validFrom: ['precipitation', 'snowfall', 'wind_gusts_10m'].includes(run.variable) ? time - HOUR : time, validTo: ['precipitation', 'snowfall', 'wind_gusts_10m'].includes(run.variable) ? time : time + HOUR, units: { [run.variable]: unit(run.variable) }, coverage: run.issueConfirmed === false ? 'Latest provider product; metadata initialisation is a reference only, response issue unconfirmed' : run !== distinct[0] ? 'Previous distinct run gap fill' : 'Newest available run', validTime: time, gapFilled: run !== distinct[0], nativeHours: nativeResolution(run.modelId, runTime, time, run.nativeHours), stale: runIsStale(run.modelId, runTime, now, context.updates?.[run.modelId]) });
      }
      latest.set(key, lookup);
    }
    lookupCache.set(runs, { groups, raw, latest });
  }
  const samples = (variable: VariableId, time: number, freshOnly = false): ModelValue[] => DETERMINISTIC_MODELS.flatMap(model => {
    const indexed = latest.get(`${model.id}:${variable}`)?.get(time);
    const value = indexed ? { ...indexed, nativeHours: nativeResolution(indexed.modelId, indexed.runTime, time, context.updates?.[indexed.modelId]?.nativeHours ?? indexed.nativeHours), stale: runIsStale(indexed.modelId, indexed.runTime, now, context.updates?.[indexed.modelId]) } : undefined;
    return value && (!freshOnly || !value.stale) ? [value] : [];
  });
  const modelAggregate = (modelId: string, variable: VariableId, times: number[], operation: EventSpec['operation'], freshOnly = false): ModelValue | null => {
    const lookup = latest.get(`${modelId}:${variable}`);
    const data = times.map(t => { const v = lookup?.get(t); return v ? { ...v, nativeHours: nativeResolution(v.modelId, v.runTime, t, context.updates?.[v.modelId]?.nativeHours ?? v.nativeHours), stale: runIsStale(v.modelId, v.runTime, now, context.updates?.[v.modelId]) } : undefined; });
    if (freshOnly && data.some(v => v?.stale)) return null;
    const value = aggregateEvent(data.map(v => v?.value ?? null), operation);
    if (value === null || !data[0]) return null;
    const grouped = new Map<string, Provenance>();
    for (const cell of data) {
      const key = `${cell!.modelId}:${cell!.runTime}:${cell!.provider}`;
      const previous = grouped.get(key);
      grouped.set(key, { ...provenanceOf(cell!), validFrom: Math.min(previous?.validFrom ?? Infinity, cell!.validFrom), validTo: Math.max(previous?.validTo ?? -Infinity, cell!.validTo) });
    }
    const contributions = [...grouped.values()];
    const preceding = ['precipitation', 'snowfall', 'wind_gusts_10m'].includes(variable);
    return { ...data[0], value, nativeHours: Math.max(...data.map(v => v!.nativeHours ?? 1)), stale: data.some(v => v?.stale), issuedAt: contributions.length === 1 ? contributions[0].issuedAt : null, runTime: Math.min(...data.map(v => v!.runTime)), validFrom: times[0] - (preceding ? HOUR : 0), validTo: times.at(-1)! + (preceding ? 0 : HOUR), contributions };
  };
  const aggregate = (variable: VariableId, times: number[], operation: EventSpec['operation'], freshOnly = false) => DETERMINISTIC_MODELS.flatMap(model => {
    const value = modelAggregate(model.id, variable, times, operation, freshOnly); return value ? [value] : [];
  });
  const agreement = (spec: EventSpec, start: number, end: number): EventEstimate => {
    const alignedWindows: NonNullable<EventEstimate['alignedWindows']> = [];
    const required = eventTimes(spec, start, end);
    const values = DETERMINISTIC_MODELS.flatMap(model => {
      const native = Math.max(1, ...required.flatMap(t => samples(spec.variable, t, true).filter(v => v.modelId === model.id).map(v => v.nativeHours ?? 1)));
      const window = nativeWindow(spec, start, end, native);
      if (!window) return [];
      const value = modelAggregate(model.id, spec.variable, eventTimes(spec, window.start, window.end), spec.operation, true);
      if (!value) return [];
      const check = nativeWindow(spec, window.start, window.end, value.nativeHours ?? 1);
      if (!check || check.shiftHours) return [];
      if (window.shiftHours) alignedWindows.push({ modelId: model.id, ...window });
      return [{ ...value, contributions: (value.contributions ?? [provenanceOf(value)]).map(p => ({ ...p, coverage: alignmentCoverage(p.coverage, window) })) }];
    });
    const weights = familyWeights(values);
    return { basis: 'deterministic-agreement', value: values.length ? weights.reduce((s, v) => s + (meets(v.source.value, spec) ? v.weight : 0), 0) : null,
      start, end, alignedWindows, threshold: spec.label, usable: values.length, expected: DETERMINISTIC_MODELS.length, systems: values.map(v => v.modelId), status: !values.length ? 'unavailable' : values.length < DETERMINISTIC_MODELS.length ? 'partial' : 'ok',
      expectedAmount: familyMean(values), conditionalAmount: weightedMedian(weights.filter(v => meets(v.source.value, spec)).map(v => ({ value: v.source.value, weight: v.weight }))), provenance: values.flatMap(v => v.contributions ?? [provenanceOf(v)]) };
  };
  const support = (spec: EventSpec, start: number, end: number): EventEstimate => {
    const required = eventTimes(spec, start, end);
    const byModel: { modelId: string; family: Family; value: number }[] = [];
    let usable = 0;
    const provenance: Provenance[] = [];
    for (const model of DETERMINISTIC_MODELS) {
      const recent = (groups.get(`${model.id}:${spec.variable}`) ?? []).filter(r => !runIsStale(r.modelId, utc(r.runTime), now, context.updates?.[r.modelId])).slice(0, 4);
      const values = recent.flatMap(run => {
        const value = aggregateEvent(required.map(t => raw.get(run)?.get(t) ?? null), spec.operation);
        if (value === null) return [];
        provenance.push({ provider: 'Open-Meteo Single Runs', modelId: model.id, family: model.family, issuedAt: run.issueConfirmed === false ? null : utc(run.runTime), sourceTime: run.availableAt ?? null, fetchedAt: run.fetchedAt, validFrom: start, validTo: end, units: { [spec.variable]: unit(spec.variable) }, coverage: 'Complete raw run window; no gap-fill duplication' });
        return [{ value, weight: 2 ** (-(now - utc(run.runTime)) / (12 * HOUR)) }];
      });
      if (!values.length) continue;
      usable += values.length;
      const total = values.reduce((s, v) => s + v.weight, 0);
      byModel.push({ modelId: model.id, family: model.family, value: values.reduce((s, v) => s + (meets(v.value, spec) ? v.weight : 0), 0) / total });
    }
    return { basis: 'recent-run-support', value: familyMean(byModel), start, end, threshold: spec.label, usable, expected: DETERMINISTIC_MODELS.length * 4, systems: byModel.map(v => v.modelId), status: byModel.length ? 'partial' : 'unavailable', expectedAmount: null, conditionalAmount: null, provenance };
  };
  const location = context.location ?? 'peterborough';
  const metOffice = usableMetOffice(context.metOffice, context.coordinates ?? LOCATION, now) ? context.metOffice : undefined;
  const disagreements: Disagreement[] = [];
  const processed = (variable: string, start: number, end: number, statistic: MetOfficeValue['statistic'] = 'median', threshold?: number) => metOffice?.values.find(v => v.variable === variable && v.start === start && v.end === end && v.statistic === statistic && (threshold === undefined || v.threshold === threshold && v.comparison === '>='));
  const ruleFor = (variable: string, start: number) => policyRule(context.policy, variable, Math.max(0, (start - now) / HOUR), location, now);
  const blend = (variable: string, sources: ModelValue[], start: number, end = start) => {
    const eligible = sources.some(v => !v.stale) ? sources.filter(v => !v.stale) : sources;
    const reference = variable === 'precipitation' ? undefined : processed(variable, start, end);
    const raw = familyMean(eligible);
    if (raw !== null && reference) {
      const difference = reference.value - raw;
      const threshold = variable === 'temperature_2m' ? DIAGNOSTIC_THRESHOLDS.temperatureC : variable === 'wind_gusts_10m' ? DIAGNOSTIC_THRESHOLDS.gustMph / 2.23694 : Infinity;
      disagreements.push({ variable, start, end, original: raw, metOffice: reference.value, difference, flagged: Math.abs(difference) >= threshold });
    }
    const extra: ModelValue[] = reference && metOffice ? [{ ...metOffice, value: reference.value, family: 'UKMO', runTime: metOffice.issuedAt ?? metOffice.fetchedAt, validTime: end, validFrom: start, validTo: end, stale: false, gapFilled: false }] : [];
    return blendValue([...eligible, ...extra], ruleFor(variable, start));
  };
  const mean = (variable: VariableId, time: number, freshOnly = false) => {
    const preceding = ['precipitation', 'snowfall', 'wind_gusts_10m'].includes(variable);
    return blend(variable, samples(variable, time, freshOnly), preceding ? time - HOUR : time, preceding ? time : time);
  };
  const blendPeriod = (variable: VariableId, times: number[], operation: EventSpec['operation']) => {
    const values = aggregate(variable, times, operation);
    // Blend the complete per-source period values. A maximum of point medians is
    // a central trajectory maximum, never labelled as a percentile of period maxima.
    const preceding = ['precipitation', 'snowfall', 'wind_gusts_10m'].includes(variable);
    const points = times.map(t => processed(variable, preceding ? t - HOUR : t, t)?.value ?? null);
    const value = variable === 'precipitation' ? null : aggregateEvent(points, operation);
    const extra: ModelValue[] = value !== null && metOffice && times.length ? [{ ...metOffice, family: 'UKMO', value, runTime: metOffice.issuedAt ?? metOffice.fetchedAt, validTime: times[0], validFrom: times[0], validTo: times.at(-1)!, stale: false, gapFilled: false }] : [];
    const eligible = values.some(v => !v.stale) ? values.filter(v => !v.stale) : values;
    return blendValue([...eligible, ...extra], ruleFor(variable, times[0] ?? now));
  };
  return { samples, aggregate, modelAggregate, agreement, support, raw, groups, mean, blend, blendPeriod, processed, disagreements, context,
    event(spec: EventSpec, start: number, end: number, ensembles?: EnsembleIndex): EventEstimate {
      const probability = ensembles?.event(spec, start, end);
      const event = probability?.value !== null && probability?.value !== undefined ? probability : agreement(spec, start, end);
      const variable = spec.variable === 'precipitation' ? 'precipitation_probability' : spec.variable === 'wind_gusts_10m' ? 'gust_probability' : '';
      const reference = spec.direction ? undefined : processed(variable, start, end, 'probability', spec.threshold);
      if (event.basis === 'ensemble-probability' && event.value !== null && event.components?.length) {
        if (reference) {
          const difference = reference.value - event.value;
          disagreements.push({ variable, start, end, original: event.value, metOffice: reference.value, difference, flagged: Math.abs(difference) >= DIAGNOSTIC_THRESHOLDS.precipitationProbability });
        }
        const rule = ruleFor(variable, start);
        const combined = blendValue([...event.components, ...(reference ? [{ family: 'UKMO' as const, modelId: 'metoffice_blended', value: reference.value }] : [])], rule)!;
        const value = variable === 'precipitation_probability' ? Math.max(0, Math.min(1, combined * (rule?.occurrenceSlope ?? 1) + (rule?.occurrenceIntercept ?? 0))) : combined;
        return { ...event, value, ...(reference ? { metOfficeProbability: reference.value, provenance: [...event.provenance, provenanceOf(metOffice!)] } : {}) };
      }
      // Deterministic agreement is never converted to a probability or fitted as one.
      return reference ? { ...event, metOfficeProbability: reference.value } : event;
    },
    supporting(spec: EventSpec, start: number, end: number) {
      const values = aggregate(spec.variable, eventTimes(spec, start, end), spec.operation, true).filter(v => meets(v.value, spec));
      return { models: values.length, families: new Set(values.map(v => v.family)).size, sources: values };
    },
  };
}
export type ForecastSignals = ReturnType<typeof buildForecastSignals>;
