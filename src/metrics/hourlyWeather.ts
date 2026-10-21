import type { CachedRun } from '../types';
import type { IconName } from '../components/WeatherIcon';
import { buildForecastSignals, familyWeights } from '../forecast/signals.ts';
import type { ForecastSignals } from '../forecast/signals.ts';
import { utc } from '../data/contracts.ts';
import type { EventEstimate } from '../data/contracts.ts';

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
export function getHourlyCondition(input: CachedRun[] | ForecastSignals, validTime: string, precipitation?: EventEstimate): HourlyCondition {
  const index = Array.isArray(input) ? buildForecastSignals(input) : input;
  const time = utc(validTime);
  const votes = new Map<number, number>();
  for (const { source, weight } of familyWeights(index.samples('weather_code', time, true))) votes.set(source.value, (votes.get(source.value) ?? 0) + weight);
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  // Retain supported fog, freezing precipitation and thunder signals before cloud appearance.
  const hazard = ranked.find(([c]) => [45, 48, 56, 57, 66, 67, 95, 96, 97, 99].includes(c));
  const code = hazard?.[0] ?? ranked[0]?.[0] ?? null;
  const daylight = index.mean('is_day', time, true);
  if (code !== null && code >= 45) return conditionForCode(code, daylight === null ? null : Math.round(daylight));
  if (precipitation?.value !== null && precipitation?.value !== undefined && precipitation.value > 0) return { label: 'Precipitation signal in the stated period', icon: 'showers' };
  const cloud = index.mean('cloud_cover', time, true);
  if (cloud === null) return { label: 'Cloud conditions unknown', icon: null };
  return conditionForCode(cloud < 0.15 ? 0 : cloud < 0.65 ? 2 : 3, daylight === null ? null : Math.round(daylight));
}
