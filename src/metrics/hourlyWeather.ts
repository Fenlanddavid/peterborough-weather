import type { CachedRun } from '../types';
import type { IconName } from '../components/WeatherIcon';
import { DETERMINISTIC_MODELS } from '../config/models';
import { getModelRuns, getValueAtTime } from './utils';

interface HourlyCondition {
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
    return { label: code === 0 ? 'Clear sky' : 'Mainly clear', icon: null };
  }
  if (code === 2) {
    return { label: 'Partly cloudy', icon: isDay === 1 ? 'partly-cloudy' : isDay === 0 ? 'cloud-moon' : 'cloud' };
  }
  return CONDITIONS[code] ?? UNAVAILABLE;
}

/** Weather codes are categories: use the most common code, never their numeric average. */
export function getHourlyCondition(allRuns: CachedRun[], validTime: string): HourlyCondition {
  const votes = new Map<number, { count: number; condition: HourlyCondition }>();
  for (const model of DETERMINISTIC_MODELS) {
    if (model.isOverlay) continue;
    const modelRuns = getModelRuns(allRuns, model.id, 'weather_code');
    const latest = modelRuns.at(-1);
    if (!latest) continue;
    const code = getValueAtTime(latest, validTime);
    const daylight = allRuns.find((run) => run.modelId === model.id && run.variable === 'is_day' && run.runTime === latest.runTime);
    const condition = conditionForCode(code, daylight ? getValueAtTime(daylight, validTime) : null);
    if (condition === UNAVAILABLE || code === null) continue;
    const existing = votes.get(code);
    if (existing) existing.count++;
    else votes.set(code, { count: 1, condition });
  }
  // Stable ordering gives tied codes the configured model order as a consistent fallback.
  return [...votes.values()].sort((a, b) => b.count - a.count)[0]?.condition ?? UNAVAILABLE;
}
