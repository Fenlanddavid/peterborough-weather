import { DETERMINISTIC_MODELS } from '../config/models.ts';
import { finite, HOUR } from '../data/contracts.ts';
import type { Family } from '../data/contracts.ts';

export const POLICY_SCHEMA = 1;
export const SOURCE_FAMILIES: Record<string, Family> = { ...Object.fromEntries(DETERMINISTIC_MODELS.map(m => [m.id, m.family])), gfs025: 'NOAA', ukmo_global_ensemble_20km: 'UKMO', metoffice_blended: 'UKMO' };
export const MODEL_VERSION = `${Object.entries(SOURCE_FAMILIES).map(([id, family]) => `${id}:${family}`).join('|')}|canonical-v1`;
export const DEFAULT_VERSION = 'lead-ecmwf-prior-v1';
export const LEAD_BANDS = [0, 6, 24, 48, 120, 168] as const;
export const POLICY_VARIABLES = ['temperature_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_gusts_10m', 'cloud_cover'] as const;
export type PolicyVariable = typeof POLICY_VARIABLES[number];
export interface PolicyRule {
  derivedFrom?: string;
  variable: PolicyVariable; band: number; location: string;
  familyFactors: Partial<Record<Family, number>>;
  modelFactors: Record<string, number>;
  metOfficeShare: number;
  temperatureCorrection: number;
  occurrenceSlope: number;
  occurrenceIntercept: number;
}
export interface BlendPolicy {
  schema: 1; version: string; modelVersion: string; createdAt: number; expiresAt: number;
  rules: PolicyRule[];
  evidence: { observationThrough: number; trainingCases: number; trainingDates: number; heldOutDates: number; successfulBlocks: number };
}
export interface WeightedSource { modelId: string; family: Family; value: number }
export const leadBand = (lead: number) => lead < 6 ? 0 : lead < 24 ? 1 : lead < 48 ? 2 : lead < 120 ? 3 : 4;
/** Heuristic from a nine-day Wittering rescore, not a measured optimum.
 * Only deterministic central values pass a lead; probability/votes stay equal-family. */
export const defaultFamilyFactor = (family: Family, lead = 0) => family === 'ECMWF' ? 1 + Math.max(0, Math.min(1, (lead - 48) / 48)) : 1;


/** Equal-family allocation for agreement, categorical votes and raw ensembles. */
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
export const familyMean = <T extends WeightedSource>(values: T[]) => values.length ? familyWeights(values).reduce((s, v) => s + v.source.value * v.weight, 0) : null;
export function validatePolicy(raw: unknown, now = Date.now()): BlendPolicy {
  const p = raw as BlendPolicy;
  if (!p || p.schema !== POLICY_SCHEMA || typeof p.version !== 'string' || p.version.length > 160 || p.modelVersion !== MODEL_VERSION || !finite(p.createdAt) || !finite(p.expiresAt) || p.createdAt > now || p.expiresAt <= now || p.expiresAt > now + 35 * 24 * HOUR || !Array.isArray(p.rules) || p.rules.length > 200) throw new RangeError('Incompatible, expired or malformed blend policy');
  const e = p.evidence;
  if (!e || !Object.values(e).every(finite) || e.observationThrough > now || now - e.observationThrough > 14 * 24 * HOUR || e.trainingCases < 200 || e.trainingDates < 20 || e.heldOutDates < 7 || e.successfulBlocks < 2) throw new RangeError('Blend policy lacks current observation evidence');
  const keys = new Set<string>();
  for (const r of p.rules) {
    if (!r || typeof r !== 'object') throw new RangeError('Invalid policy rule');
    const key = `${r.location}:${r.variable}:${r.band}`;
    if (!r || !POLICY_VARIABLES.includes(r.variable) || !Number.isInteger(r.band) || r.band < -1 || r.band > 4 || typeof r.location !== 'string' || !r.location || keys.has(key) || !r.familyFactors || !r.modelFactors) throw new RangeError('Invalid policy rule');
    if (r.derivedFrom !== undefined && (typeof r.derivedFrom !== 'string' || !r.derivedFrom || r.derivedFrom.length > 200 || r.location !== 'peterborough' || r.temperatureCorrection !== 0 || r.occurrenceSlope !== 1 || r.occurrenceIntercept !== 0)) throw new RangeError('Invalid derived rule');
    keys.add(key);
    if (Object.entries(r.familyFactors).some(([k, v]) => !['ECMWF', 'NOAA', 'UKMO'].includes(k) || !finite(v) || v < 0.75 || v > 1.25) || Object.entries(r.modelFactors).some(([k, v]) => !Object.hasOwn(SOURCE_FAMILIES, k) || k === 'metoffice_blended' || !finite(v) || v < 0.5 || v > 1.5)) throw new RangeError('Unbounded weights');
    if (!finite(r.metOfficeShare) || r.metOfficeShare < 0.25 || r.metOfficeShare > 0.75 || !finite(r.temperatureCorrection) || Math.abs(r.temperatureCorrection) > 1 || r.variable !== 'temperature_2m' && r.temperatureCorrection !== 0 || !finite(r.occurrenceSlope) || r.occurrenceSlope < 0.75 || r.occurrenceSlope > 1.25 || !finite(r.occurrenceIntercept) || Math.abs(r.occurrenceIntercept) > 0.1 || r.variable !== 'precipitation_probability' && (r.occurrenceSlope !== 1 || r.occurrenceIntercept !== 0)) throw new RangeError('Invalid correction or probability calibration');
  }
  return p;
}
export function policyRule(policy: BlendPolicy | undefined, variable: string, lead: number, location: string, now: number): PolicyRule | undefined {
  if (!policy) return;
  try { validatePolicy(policy, now); } catch { return; }
  return policy.rules.find(r => r.variable === variable && r.location === location && r.band === leadBand(lead)) ?? policy.rules.find(r => r.variable === variable && r.location === location && r.band === -1);
}
/** Repeated runs/members split a model allocation. The processed feed shares UKMO's
 * allocation, never creates a fourth family, and only enters after compatibility checks. */
export function blendWeights<T extends WeightedSource>(sources: T[], rule?: PolicyRule, lead = 0): { source: T; weight: number }[] {
  const families = [...new Set(sources.map(s => s.family))];
  const factor = (family: Family) => defaultFamilyFactor(family, lead) * (rule?.familyFactors[family] ?? 1);
  const total = families.reduce((sum, family) => sum + factor(family), 0);
  const within = (group: T[], allocation: number) => {
    const entries = familyWeights(group).map(v => ({ ...v, weight: v.weight * (rule?.modelFactors[v.source.modelId] ?? 1) }));
    const sum = entries.reduce((s, v) => s + v.weight, 0);
    return entries.map(v => ({ ...v, weight: allocation * v.weight / sum }));
  };
  return families.flatMap(family => {
    const group = sources.filter(s => s.family === family);
    const allocation = factor(family) / total;
    const processed = group.filter(s => s.modelId === 'metoffice_blended');
    const raw = group.filter(s => s.modelId !== 'metoffice_blended');
    if (family === 'UKMO' && processed.length && raw.length) {
      const share = rule?.metOfficeShare ?? 0.5;
      return [...within(raw, allocation * (1 - share)), ...within(processed, allocation * share)];
    }
    return within(group, allocation);
  });
}
export function blendValue<T extends WeightedSource>(sources: T[], rule?: PolicyRule, lead = 0): number | null {
  if (!sources.length) return null;
  // Preserve exact equal-family arithmetic while the default prior is equal.
  if (lead <= 48 && !rule && !sources.some(v => v.modelId === 'metoffice_blended')) return familyMean(sources);
  return blendWeights(sources, rule, lead).reduce((s, v) => s + v.source.value * v.weight, 0) + (rule?.temperatureCorrection ?? 0);
}
