import { HOUR, mphToMs, provenanceOf } from '../data/contracts.ts';
import type { EventEstimate } from '../data/contracts.ts';
import type { EnsembleSnapshot, EnsembleVariable } from './ensembles.ts';
import { familyWeights } from './policy.ts';
import { runIsStale } from '../api/modelUpdates.ts';

export const THRESHOLDS = { wet3h: 0.2, wet6h: 1, wetDay: 1, snow: 0.5, gust: mphToMs(30), airFrost: 0, clear: 0.3 };
export interface EventSpec { variable: EnsembleVariable; operation: 'sum' | 'max' | 'min' | 'point'; threshold: number; direction?: 'below' | 'strict-below'; label: string }
export const PRECIP_3H: EventSpec = { variable: 'precipitation', operation: 'sum', threshold: THRESHOLDS.wet3h, label: 'at least 0.2 mm precipitation over 3 hours' };
export const PRECIP_DAY: EventSpec = { ...PRECIP_3H, threshold: THRESHOLDS.wetDay, label: 'at least 1 mm precipitation over this local day' };
export const PRECIP_6H: EventSpec = { ...PRECIP_3H, threshold: THRESHOLDS.wet6h, label: 'at least 1 mm precipitation over 6 hours' };
export const CLEAR_CLOUD: EventSpec = { variable: 'cloud_cover', operation: 'point', threshold: THRESHOLDS.clear, direction: 'strict-below', label: 'total cloud below 30% at the valid hour' };
export const SNOW: EventSpec = { variable: 'snowfall', operation: 'sum', threshold: THRESHOLDS.snow, label: 'at least 0.5 cm snowfall' };
export const GUST: EventSpec = { variable: 'wind_gusts_10m', operation: 'max', threshold: THRESHOLDS.gust, label: 'gust at least 30 mph over 6 hours' };
export const FROST: EventSpec = { variable: 'temperature_2m', operation: 'min', threshold: 0, direction: 'below', label: 'air temperature at or below 0°C overnight (18:00–09:00)' };
export function eventTimes(spec: EventSpec, start: number, end: number): number[] {
  if (spec.operation === 'point') return [start];
  if (end <= start || start % HOUR || end % HOUR) return [];
  const preceding = spec.operation === 'sum' || spec.variable === 'wind_gusts_10m';
  return Array.from({ length: (end - start) / HOUR }, (_, i) => start + (i + (preceding ? 1 : 0)) * HOUR);
}
export function aggregateEvent(values: (number | null)[], operation: EventSpec['operation']): number | null {
  if (!values.length || values.some(v => v === null)) return null;
  const numbers = values as number[];
  return operation === 'sum' ? numbers.reduce((s, v) => s + v, 0) : operation === 'min' ? Math.min(...numbers) : operation === 'max' ? Math.max(...numbers) : numbers[0];
}
export const meets = (value: number, spec: EventSpec) => spec.direction === 'below' ? value <= spec.threshold : spec.direction === 'strict-below' ? value < spec.threshold : value >= spec.threshold;
export function weightedMedian(values: { value: number; weight: number }[]): number | null {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, v) => s + v.weight, 0);
  if (!total) return null;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].weight;
    if (Math.abs(cumulative - total / 2) < 1e-10 && sorted[i + 1]) return (sorted[i].value + sorted[i + 1].value) / 2;
    if (cumulative > total / 2) return sorted[i].value;
  }
  return sorted.at(-1)?.value ?? null;
}
/** Inverse empirical CDF of the family-weighted mixture; never average percentiles. */
export function weightedQuantile(values: { value: number; weight: number }[], probability: number): number | null {
  const sorted = values.filter(v => Number.isFinite(v.value) && v.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, v) => s + v.weight, 0);
  if (!total || probability < 0 || probability > 1) return null;
  let cumulative = 0;
  for (const item of sorted) { cumulative += item.weight; if (cumulative >= probability * total - 1e-12) return item.value; }
  return sorted.at(-1)?.value ?? null;
}
export interface EnsembleIndex {
  snapshots: EnsembleSnapshot[];
  event(spec: EventSpec, start: number, end: number): EventEstimate;
  atTime(now: number): EnsembleIndex;
}
export function buildEnsembleIndex(snapshots: EnsembleSnapshot[]): EnsembleIndex {
  const indexed = snapshots.map(snapshot => ({ snapshot, times: new Map(snapshot.times.map((t, i) => [t, i])) }));
  const view = (selected: typeof indexed): EnsembleIndex => {
    return {
      snapshots: selected.map(s => s.snapshot),
      atTime(now) {
        return view(indexed.filter(({ snapshot }) => {
          const source = snapshot.providerUpdate?.initialisedAt ?? snapshot.firstSeenAt ?? snapshot.fetchedAt;
          const age = now - source;
          return age >= -5 * 60_000 && (snapshot.providerUpdate ? !runIsStale(snapshot.modelId, source, now, { ...snapshot.providerUpdate, cadence: 6 * HOUR, nativeHours: snapshot.nativeHours, checkedAt: snapshot.fetchedAt }) : age < 6 * HOUR);
        }));
      },
      event(spec: EventSpec, start: number, end: number): EventEstimate {
        const required = eventTimes(spec, start, end);
        const systems = selected.map(({ snapshot, times }) => {
          const values = Object.values(snapshot.members[spec.variable] ?? {}).flatMap(member => {
            const value = aggregateEvent(required.map(t => { const i = times.get(t); return i === undefined ? null : member[i]; }), spec.operation);
            return value === null ? [] : [value];
          });
          const nativeCompatible = spec.operation === 'point' || (end - start >= snapshot.nativeHours * HOUR && start % (snapshot.nativeHours * HOUR) === 0 && end % (snapshot.nativeHours * HOUR) === 0);
          return { snapshot, values, eligible: nativeCompatible && values.length >= Math.ceil(snapshot.expected * 0.8) };
        });
        const eligible = systems.filter(s => s.eligible);
        const totalExpected = systems.reduce((s, v) => s + v.snapshot.expected, 0);
        const usable = systems.reduce((s, v) => s + v.values.length, 0);
        const weighted = familyWeights(eligible.map(s => ({ ...s, family: s.snapshot.family!, modelId: s.snapshot.modelId })));
        const mixture = weighted.flatMap(({ source, weight }) => source.values.map(value => ({ value, weight: weight / source.values.length })));
        const wet = mixture.filter(v => meets(v.value, spec));
        return { basis: 'ensemble-probability', value: eligible.length ? weighted.reduce((sum, s) => sum + s.weight * s.source.values.filter(v => meets(v, spec)).length / s.source.values.length, 0) : null,
          start, end, threshold: spec.label, usable, expected: totalExpected, systems: eligible.map(s => s.snapshot.modelId), status: !eligible.length ? 'unavailable' : eligible.length < systems.length || usable < totalExpected ? 'partial' : 'ok',
          expectedAmount: eligible.length ? weighted.reduce((sum, s) => sum + s.weight * s.source.values.reduce((a, b) => a + b, 0) / s.source.values.length, 0) : null,
          conditionalAmount: weightedMedian(wet), upperAmount: weightedQuantile(mixture, 0.9), nativeHours: Math.max(1, ...eligible.map(s => s.snapshot.nativeHours)),
          components: eligible.map(s => ({ family: s.snapshot.family!, modelId: s.snapshot.modelId, value: s.values.filter(v => meets(v, spec)).length / s.values.length })), provenance: eligible.map(s => provenanceOf(s.snapshot)) };
      },
    };
  };
  return view(indexed);
}
