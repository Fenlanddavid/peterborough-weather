import type { CachedRun } from '../types';
import type { IconName } from '../components/WeatherIcon';
import { buildForecastSignals, familyWeights } from '../forecast/signals.ts';
import type { ModelValue, ForecastSignals } from '../forecast/signals.ts';
import { utc } from '../data/contracts.ts';
import type { EventEstimate } from '../data/contracts.ts';

export interface HourlyCondition {
  label: string;
  icon: IconName | null;
}

const UNAVAILABLE: HourlyCondition = { label: 'Weather conditions unavailable', icon: null };

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
export function rankedWeatherCodes(samples: ModelValue[]): number[] {
  const votes = new Map<number, number>();
  const valid = samples.filter(source => Number.isInteger(source.value) && ([0, 1, 2].includes(source.value) || CONDITIONS[source.value]));
  for (const { source, weight } of familyWeights(valid)) {
    votes.set(source.value, (votes.get(source.value) ?? 0) + weight);
  }
  return [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([code]) => code);
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

interface ConditionEvidence {
  /** Valid codes in descending family-weighted order. */
  codes: readonly number[];
  precipitation: number | null;
  snowfall: number | null;
  cloud: number | null; // ForecastSignals fraction, already 0–1
  daylight: number | null;
}
const freezing = [56, 57, 66, 67];
const snow = [71, 73, 75, 77, 85, 86];
const thunder = [95, 96, 97, 99];
const fog = [45, 48];
const ordinaryWet = [51, 53, 55, 61, 63, 65, 80, 81, 82];
const lightWet = [51, 53, 55, 80, 81, 82];

/** Resolve one slot from the same unrounded evidence used for its displayed values.
 * Instantaneous codes can describe hazards at the start, not promise a wet whole hour.
 * Longer-period probabilities/agreements are deliberately absent from this contract.
 */
export function getHourlyCondition(input: ConditionEvidence): HourlyCondition {
  const { codes, precipitation, snowfall, cloud, daylight } = input;
  const kind = precipitationKind(precipitation);
  const isDay = daylight === 0 || daylight === 1 ? daylight : null;
  const code = codes[0] ?? null;
  const dryCode = codes.find(c => c >= 0 && c <= 3);
  const sky = conditionForCode(dryCode ?? (cloud === null || !Number.isFinite(cloud) || cloud < 0 || cloud > 1 ? null : cloud < 0.15 ? 0 : cloud < 0.65 ? 2 : 3), isDay);
  const hazard = codes.find(c => thunder.includes(c) || freezing.includes(c) || snow.includes(c));
  let result: HourlyCondition;
  if (hazard !== undefined) {
    const condition = conditionForCode(hazard, isDay);
    result = { ...condition, label: `${condition.label} indicated at the shown time; may not persist throughout the hour` };
  } else if (snowfall !== null && Number.isFinite(snowfall) && snowfall > 0) {
    result = { label: 'Snowfall indicated during the hour', icon: 'snow' };
  } else if (kind === 'wet') {
    const wet = codes.find(c => ordinaryWet.includes(c));
    result = wet === undefined ? { label: 'Precipitation; type uncertain', icon: 'precipitation' } : conditionForCode(wet, isDay);
    const fogCode = codes.find(c => fog.includes(c));
    if (fogCode !== undefined) result = { ...result, label: `${result.label}; ${conditionForCode(fogCode, isDay).label} indicated at the shown time` };
  } else if (codes.some(c => fog.includes(c))) {
    const condition = conditionForCode(codes.find(c => fog.includes(c))!, isDay);
    result = { ...condition, label: `${condition.label} indicated at the shown time` };
  } else if (kind === 'trace' && codes.some(c => lightWet.includes(c))) {
    result = conditionForCode(codes.find(c => lightWet.includes(c))!, isDay);
  } else if (kind === 'missing' && code !== null) {
    result = conditionForCode(code, isDay);
    if (ordinaryWet.includes(code)) result = { ...result, label: `${result.label} indicated at the shown time; may not persist throughout the hour` };
  } else {
    result = sky;
    if (kind === 'zero' && codes.some(c => ordinaryWet.includes(c))) {
      result = { ...result, label: `${result.label}; instantaneous wet code conflicts with zero precipitation for this slot` };
    }
  }
  if (kind === 'trace') result = { ...result, label: `${result.label}; Trace precipitation` };
  if (kind === 'missing') result = { ...result, label: `${result.label}; hourly precipitation unavailable` };
  return result;
}

/** Daily event interpretation stays separate from hourly amount thresholds. */
export function getDailyCondition(input: CachedRun[] | ForecastSignals, validTime: string, precipitation?: EventEstimate): HourlyCondition {
  const index = Array.isArray(input) ? buildForecastSignals(input) : input;
  const time = utc(validTime);
  const ranked = rankedWeatherCodes(index.samples('weather_code', time, true));
  const hazard = ranked.find(c => [...fog, ...freezing, ...thunder].includes(c));
  const code = hazard ?? ranked[0] ?? null;
  const daylight = index.mean('is_day', time, true);
  const isDay = daylight === null ? null : Math.round(daylight);
  if (code !== null && code >= 45) return conditionForCode(code, isDay);
  if (precipitation?.value !== null && precipitation?.value !== undefined && precipitation.value > 0) return { label: 'Precipitation signal in the stated daily period', icon: 'precipitation' };
  if (code !== null) return conditionForCode(code, isDay);
  const cloud = index.mean('cloud_cover', time, true);
  return conditionForCode(cloud === null ? null : cloud < 0.15 ? 0 : cloud < 0.65 ? 2 : 3, isDay);
}
