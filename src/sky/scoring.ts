import { HOUR, mphToMs } from '../data/contracts.ts';
import type { Family, Provenance } from '../data/contracts.ts';
import { familyMean } from '../forecast/signals.ts';
import type { Interval, SkySample, AstroProvenance } from '../astro/ephemeris.ts';
export type ObservingMode = 'deep-sky' | 'moon-planets';
export const SKY_HEURISTICS = { cloudHigh: { 'deep-sky': 0.7, 'moon-planets': 0.4 }, moonPenalty: 0.6, rainOverride: 0.4, windowMinimum: 55, fullCoverage: 0.75 };
export interface WeatherInput {
  modelId: string; family: Family; cloud: number | null; low: number | null; mid: number | null; high: number | null;
  temperature: number | null; dewPoint: number | null; humidity: number | null; visibility: number | null; aerosol: number | null; wind: number | null; gust: number | null; jet: number | null;
  provenance?: (Provenance | AstroProvenance)[];
}
export interface ModelScore { modelId: string; family: Family; value: number | null; cloud: number | null; transparencyInputs: string[]; fog: boolean; dew: boolean | null; frost: boolean | null; radiationFog: boolean | null; jet: 'favourable' | 'mixed' | 'unfavourable' | null; provenance: (Provenance | AstroProvenance)[]; inputs: WeatherInput }
export function scoreModel(input: WeatherInput, sky: SkySample, mode: ObservingMode): ModelScore {
  const { low, mid, high } = input;
  const cloud = low !== null && mid !== null && high !== null ? 1 - (1 - low) * (1 - mid) * (1 - SKY_HEURISTICS.cloudHigh[mode] * high) : input.cloud;
  const components: number[] = []; const transparencyInputs: string[] = [];
  if (input.humidity !== null) { transparencyInputs.push('relative humidity'); components.push(input.humidity <= 0.75 ? 1 : input.humidity <= 0.85 ? 0.9 : input.humidity <= 0.92 ? 0.8 : 0.7); }
  if (input.visibility !== null) { transparencyInputs.push('visibility'); components.push(input.visibility >= 20_000 ? 1 : input.visibility >= 10_000 ? 0.9 : input.visibility >= 5000 ? 0.8 : 0.7); }
  if (input.aerosol !== null) { transparencyInputs.push('aerosol optical depth'); components.push(input.aerosol < 0.1 ? 1 : input.aerosol < 0.2 ? 0.9 : input.aerosol < 0.4 ? 0.8 : 0.7); }
  const transparency = Math.max(0.6, components.reduce((s, v) => s * v, 1));
  const gustFactor = input.gust === null ? null : input.gust < mphToMs(25) ? 1 : input.gust <= mphToMs(35) ? 0.8 : 0;
  const moonFactor = mode === 'deep-sky' ? sky.illumination * Math.sin(Math.max(0, sky.moonAltitude) * Math.PI / 180) : 0;
  const fog = input.visibility !== null && input.visibility < 1000;
  const dew = input.temperature !== null && input.dewPoint !== null && input.wind !== null ? input.temperature - input.dewPoint <= 2 && input.wind < mphToMs(7) : null;
  const frost = dew === null || input.temperature === null ? null : dew && input.temperature <= 1;
  const radiationFog = input.humidity === null || input.wind === null || input.cloud === null ? null : input.humidity >= 0.97 && input.wind < mphToMs(5) && input.cloud < 0.3;
  const value = cloud === null || gustFactor === null ? null : fog ? 0 : Math.max(0, Math.min(100, 100 * (1 - cloud) * (1 - SKY_HEURISTICS.moonPenalty * moonFactor) * transparency * gustFactor));
  return { modelId: input.modelId, family: input.family, value, cloud, transparencyInputs, fog, dew, frost, radiationFog, jet: input.jet === null ? null : input.jet < 20 ? 'favourable' : input.jet <= 35 ? 'mixed' : 'unfavourable', provenance: input.provenance ?? [], inputs: input };
}
export function combineScores(models: ModelScore[], precipitation: { value: number | null; basis: string }, dark: boolean): number | null {
  if (!dark) return null;
  if (precipitation.value === null) return null;
  const eligible = models.flatMap(m => m.value === null ? [] : [{ ...m, value: m.value }]);
  if (!eligible.length) return null;
  if (precipitation.value >= SKY_HEURISTICS.rainOverride - 1e-12) return 0;
  return familyMean(eligible);
}
export interface ScorePeriod { start: number; end: number; score: number | null; families: number; transparencyKnown: boolean }
export interface ObservingWindow extends Interval { duration: number; mean: number }
export function observingWindows(periods: ScorePeriod[], dark: Interval, now: number = -Infinity) {
  const clipped = periods.map(p => ({ ...p, start: Math.max(p.start, dark.start, now), end: Math.min(p.end, dark.end) })).filter(p => p.end > p.start).sort((a, b) => a.start - b.start);
  const windows: ObservingWindow[] = [];
  let current: ObservingWindow | null = null;
  for (const p of clipped) {
    if (p.score === null || p.score < SKY_HEURISTICS.windowMinimum || (current && p.start !== current.end)) {
      if (current) windows.push(current);
      current = null;
    }
    if (p.score === null || p.score < SKY_HEURISTICS.windowMinimum) continue;
    const duration = p.end - p.start;
    if (current) { current.mean = (current.mean * current.duration + p.score * duration) / (current.duration + duration); current.end = p.end; current.duration += duration; }
    else current = { start: p.start, end: p.end, duration, mean: p.score };
  }
  if (current) windows.push(current);
  windows.sort((a, b) => b.duration - a.duration || b.mean - a.mean || a.start - b.start);
  const interval = Math.max(0, dark.end - Math.max(dark.start, now));
  const coverage = interval ? clipped.filter(p => p.score !== null).reduce((s, p) => s + p.end - p.start, 0) / interval : 0;
  const familyCoverage = interval ? clipped.filter(p => p.score !== null && p.families >= 2).reduce((s, p) => s + p.end - p.start, 0) / interval : 0;
  return { windows, best: windows[0] ?? null, coverage, familyCoverage, clipped };
}
export type NightRating = 'Excellent' | 'Good' | 'Fair' | 'Poor' | 'Unsuitable' | 'Limited data';
export function rateNight(result: ReturnType<typeof observingWindows>, twilightOnly = false): NightRating {
  if (result.coverage < SKY_HEURISTICS.fullCoverage) return 'Limited data';
  const best = result.best;
  const transparencyKnown = result.clipped.some(p => p.score !== null && p.transparencyKnown);
  if (best && best.duration >= 4 * HOUR && best.mean >= 75 && !twilightOnly && transparencyKnown) return 'Excellent';
  if (best && best.duration >= 2 * HOUR && best.mean >= 60) return 'Good';
  if (best && best.duration >= HOUR) return 'Fair';
  return result.clipped.some(p => p.score !== null && p.score >= 35) ? 'Poor' : 'Unsuitable';
}
