import { SNOW_HOURLY_THRESHOLD_CM } from '../config/forecast.ts';
import type { CachedRun } from '../types';
import type { IconName } from '../components/WeatherIcon';
import { buildForecastSignals, familyWeights } from '../forecast/signals.ts';
import type { ModelValue, ForecastSignals } from '../forecast/signals.ts';
import { utc } from '../data/contracts.ts';

export interface HourlyCondition {
  label: string;
  description?: string;
  icon: IconName | null;
  risks?: { label: string; support: number }[];
}

const UNAVAILABLE: HourlyCondition = { label: 'Unavailable', description: 'Weather conditions unavailable', icon: null };

// Open-Meteo WMO weather interpretation codes.
const CONDITIONS: Record<number, HourlyCondition> = {
  3: { label: 'Cloudy', icon: 'cloud' },
  45: { label: 'Fog', icon: 'fog' },
  48: { label: 'Freezing fog', icon: 'fog' },
  51: { label: 'Light drizzle', icon: 'rain' },
  53: { label: 'Drizzle', icon: 'rain' },
  55: { label: 'Heavy drizzle', icon: 'rain' },
  56: { label: 'Freezing drizzle', icon: 'rain' },
  57: { label: 'Freezing drizzle', icon: 'rain' },
  61: { label: 'Light rain', icon: 'rain' },
  63: { label: 'Rain', icon: 'rain' },
  65: { label: 'Heavy rain', icon: 'rain' },
  66: { label: 'Freezing rain', icon: 'rain' },
  67: { label: 'Heavy freezing rain', icon: 'rain' },
  71: { label: 'Light snow', icon: 'snow' },
  73: { label: 'Snow', icon: 'snow' },
  75: { label: 'Heavy snow', icon: 'snow' },
  77: { label: 'Snow grains', icon: 'snow' },
  80: { label: 'Rain showers', icon: 'rain' },
  81: { label: 'Rain showers', icon: 'rain' },
  82: { label: 'Heavy rain showers', icon: 'rain' },
  85: { label: 'Snow showers', icon: 'snow' },
  86: { label: 'Heavy snow showers', icon: 'snow' },
  95: { label: 'Thunderstorm', icon: 'storm' },
  96: { label: 'Thunderstorm with hail', icon: 'storm' },
  97: { label: 'Heavy thunderstorm', icon: 'storm' },
  99: { label: 'Thunderstorm with hail', icon: 'storm' },
};

export function conditionForCode(code: number | null, isDay: number | null): HourlyCondition {
  if (code === null || !Number.isInteger(code)) return UNAVAILABLE;
  if (code === 0 || code === 1) {
    if (isDay === 1) return { label: code === 0 ? 'Sunny' : 'Mainly sunny', icon: 'sun' };
    if (isDay === 0) return { label: code === 0 ? 'Clear night' : 'Mainly clear night', icon: 'moon' };
    return { label: code === 0 ? 'Clear sky' : 'Mainly clear', icon: 'clear-sky' };
  }
  if (code === 2) {
    return { label: 'Partly cloudy', icon: isDay === 1 ? 'partly-cloudy' : isDay === 0 ? 'cloud-moon' : 'cloud' };
  }
  return CONDITIONS[code] ?? UNAVAILABLE;
}

/** Codes are categorical. Ties use the lower code, independent of model/run order. */
export function weightedWeatherCodes(samples: ModelValue[]): { code: number; support: number }[] {
  const votes = new Map<number, number>();
  const valid = samples.filter(source => Number.isInteger(source.value) && ([0, 1, 2].includes(source.value) || CONDITIONS[source.value]));
  for (const { source, weight } of familyWeights(valid)) {
    votes.set(source.value, (votes.get(source.value) ?? 0) + weight);
  }
  return [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([code, support]) => ({ code, support }));
}

export const rankedWeatherCodes = (samples: ModelValue[]) => weightedWeatherCodes(samples).map(v => v.code);
export const CONDITION_CONFIG = { hazardSupport: 0.5, wetSupport: 0.5 };

/** Missing or conflicting daylight flags use neutral artwork. */
export function forecastDaylight(samples: ModelValue[]): number | null {
  const fresh = samples.filter(v => !v.stale);
  const valid = (fresh.length ? fresh : samples).filter(v => v.value === 0 || v.value === 1);
  return valid.length && valid.every(v => v.value === valid[0].value) ? valid[0].value : null;
}

export const PRECIPITATION_THRESHOLD_MM = 0.1;
// No numerical-noise tolerance: every finite positive amount remains distinguishable
// from zero. Compare raw values at the threshold; never compare rounded display text.
export function precipitationKind(value: number | null): 'missing' | 'zero' | 'trace' | 'wet' {
  if (value === null || !Number.isFinite(value) || value < 0) return 'missing';
  return value === 0 ? 'zero' : value < PRECIPITATION_THRESHOLD_MM ? 'trace' : 'wet';
}
export function formatPrecipitation(value: number | null): string {
  const kind = precipitationKind(value);
  return kind === 'missing' ? '—' : kind === 'zero' ? '0.0 mm' : kind === 'trace' ? '<0.1 mm' : `${value!.toFixed(1)} mm`;
}

export interface ConditionEvidence {
  /** Valid codes in descending family-weighted order. */
  codes: readonly number[];
  support?: readonly { code: number; support: number }[];
  hazardThreshold?: number;
  precipitation: number | null;
  snowfall: number | null;
  snowSupport?: number;
  rainSupport: number;
  wetCodes?: readonly number[];
  cloud: number | null; // ForecastSignals fraction, already 0–1
  daylight: number | null;
}
const freezing = [56, 57, 66, 67];
const snow = [71, 73, 75, 77, 85, 86];
const thunder = [95, 96, 97, 99];
const fog = [45, 48];
const ordinaryWet = [51, 53, 55, 61, 63, 65, 80, 81, 82];


/** Resolve one slot from the same unrounded evidence used for its displayed values.
 * Instantaneous codes can describe hazards at the start, not promise a wet whole hour.
 * Longer-period probabilities/agreements are deliberately absent from this contract.
 */
export function getHourlyCondition(input: ConditionEvidence): HourlyCondition {
  const { codes, precipitation, snowfall, cloud, daylight } = input;
  const kind = precipitationKind(precipitation);
  const isDay = daylight === 0 || daylight === 1 ? daylight : null;
  const dryCode = codes.find(c => c >= 0 && c <= 3);
  const sky = conditionForCode(dryCode ?? (cloud === null || !Number.isFinite(cloud) || cloud < 0 || cloud > 1 ? null : cloud < 0.15 ? 0 : cloud < 0.65 ? 2 : 3), isDay);
  const hazards = [thunder, freezing, snow];
  const evidence = input.support ?? codes.map((code, i) => ({ code, support: i === 0 ? 1 : 0 }));
  const threshold = input.hazardThreshold ?? CONDITION_CONFIG.hazardSupport;
  const riskGroups = hazards.map(group => ({ group, support: evidence.filter(v => group.includes(v.code)).reduce((s, v) => s + v.support, 0) }));
  const dominant = riskGroups.filter(v => v.support >= threshold && (v.group !== freezing || input.rainSupport >= CONDITION_CONFIG.wetSupport)).sort((a, b) => b.support - a.support)[0];
  const hazardCodes = dominant?.group === freezing ? input.wetCodes ?? codes : codes;
  const hazard = dominant ? hazardCodes.find(c => dominant.group.includes(c)) : undefined;
  const risks = riskGroups.filter(v => v.support > 0 && v !== dominant).map(v => ({ label: conditionForCode(codes.find(c => v.group.includes(c))!, isDay).label, support: v.support }));
  let result: HourlyCondition;
  if (hazard !== undefined) {
    const condition = conditionForCode(hazard, isDay);
    result = { ...condition, description: `${condition.label} indicated at the shown time; may not persist throughout the hour` };
  } else if (snowfall !== null && Number.isFinite(snowfall) && snowfall > 0 && (input.snowSupport ?? (input.support || snowfall < SNOW_HOURLY_THRESHOLD_CM ? 0 : 1)) >= threshold) {
    result = { label: 'Snow', description: 'Snowfall indicated during the hour', icon: 'snow' };
  } else if (input.rainSupport >= CONDITION_CONFIG.wetSupport) {
    const wet = (input.wetCodes ?? codes).find(c => [...ordinaryWet, ...freezing].includes(c));
    result = wet === undefined ? { label: 'Precipitation', description: 'Precipitation; type uncertain', icon: 'precipitation' } : conditionForCode(wet, isDay);
    const fogCode = codes.find(c => fog.includes(c));
    if (fogCode !== undefined) result = { ...result, description: `${result.description ?? result.label}; ${conditionForCode(fogCode, isDay).label} indicated at the shown time` };
  } else if (codes.some(c => fog.includes(c))) {
    const condition = conditionForCode(codes.find(c => fog.includes(c))!, isDay);
    result = { ...condition, description: `${condition.label} indicated at the shown time` };
  } else {
    result = sky;
    if (kind === 'zero' && codes.some(c => ordinaryWet.includes(c))) {
      result = { ...result, description: `${result.description ?? result.label}; instantaneous wet code conflicts with zero precipitation for this slot` };
    }
  }
  if (input.rainSupport > 0 && input.rainSupport < CONDITION_CONFIG.wetSupport) risks.push({ label: 'Showers possible', support: input.rainSupport });
  if (kind === 'trace') result = { ...result, description: `${result.description ?? result.label}; Trace precipitation` };
  if (kind === 'missing') result = { ...result, description: `${result.description ?? result.label}; hourly precipitation unavailable` };
  if (snowfall !== null && snowfall > 0 && input.snowSupport !== undefined && input.snowSupport > 0 && input.snowSupport < threshold && !risks.some(r => /snow/i.test(r.label))) risks.push({ label: 'Snowfall', support: input.snowSupport });
  if (risks.length) result = { ...result, risks, description: `${result.description ?? result.label}; lower-support risk: ${risks.map(r => `${r.label} (${Math.round(r.support * 100)}% family support, not probability)`).join('; ')}` };
  return result;
}

/** Occurrence uses equal-family fresh model support, independent of amount priors. */
export function rainOccurrence(amounts: ModelValue[], codes: ModelValue[]) {
  const fresh = amounts.filter(v => !v.stale);
  const wetModels = new Set(fresh.filter(v => v.value >= PRECIPITATION_THRESHOLD_MM).map(v => v.modelId));
  const rainSupport = familyWeights(fresh).filter(v => wetModels.has(v.source.modelId)).reduce((sum, v) => sum + v.weight, 0);
  const wetCodes = weightedWeatherCodes(codes.filter(v => !v.stale && wetModels.has(v.modelId) && [...ordinaryWet, ...freezing].includes(v.value))).map(v => v.code);
  return { rainSupport, wetCodes };
}

/** Daily event interpretation stays separate from hourly amount thresholds. */
export function getDailyCondition(input: CachedRun[] | ForecastSignals, validTime: string): HourlyCondition {
  const index = Array.isArray(input) ? buildForecastSignals(input) : input;
  const time = utc(validTime);
  const preferFresh = (samples: ModelValue[]) => samples.some(v => !v.stale) ? samples.filter(v => !v.stale) : samples;
  const support = weightedWeatherCodes(preferFresh(index.samples('weather_code', time)));
  const daylight = forecastDaylight(index.samples('is_day', time));
  const snowValues = preferFresh(index.samples('snowfall', time + 3600_000));
  const snowSupport = familyWeights(snowValues).filter(v => v.source.value >= SNOW_HOURLY_THRESHOLD_CM).reduce((sum, v) => sum + v.weight, 0);
  const rain = rainOccurrence(index.samples('precipitation', time + 3600_000), index.samples('weather_code', time));
  return getHourlyCondition({ ...rain, snowSupport, codes: support.map(v => v.code), support, precipitation: index.mean('precipitation', time + 3600_000), snowfall: index.mean('snowfall', time + 3600_000), cloud: index.mean('cloud_cover', time), daylight });
}
