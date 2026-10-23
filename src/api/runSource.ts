import { LOCATION } from '../config/models.ts';
import type { VariableId } from '../config/models.ts';
import type { CachedRun } from '../types.ts';
import type { ModelUpdate } from './modelUpdates.ts';
import { utc, finite } from '../data/contracts.ts';

export const FORECAST_VARIABLES: VariableId[] = ['temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'pressure_msl', 'snowfall', 'weather_code', 'is_day', 'cloud_cover'];
export function runUrl(modelId: string, runTime: string, variables: VariableId[], location: { latitude: number; longitude: number; elevation?: number } = LOCATION) {
  const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), hourly: variables.join(','), models: modelId, run: runTime, forecast_days: '7', timezone: 'UTC', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' });
  if (finite(location.elevation)) params.set('elevation', String(location.elevation));
  return `https://single-runs-api.open-meteo.com/v1/forecast?${params}`;
}
export function parseRun(data: Record<string, any>, modelId: string, runTime: string, variables: VariableId[], fetchedAt = Date.now(), update?: ModelUpdate): CachedRun[] {
  const hourly = data?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length || data.utc_offset_seconds !== 0 || hourly.time.some((t: unknown, i: number) => typeof t !== 'string' || !finite(utc(t)) || i > 0 && utc(t) - utc(hourly.time[i - 1]) !== 3600_000)) throw new RangeError('Invalid UTC run time axis');
  const units: Record<string, string> = { temperature_2m: '°C', precipitation: 'mm', snowfall: 'cm', wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', pressure_msl: 'hPa', cloud_cover: '%', is_day: '', weather_code: 'wmo code' };
  return variables.filter(variable => data.hourly_units?.[variable] === units[variable] && Array.isArray(hourly[variable]) && hourly[variable].length === hourly.time.length && hourly[variable].every((v: unknown) => v === null || finite(v)) && hourly[variable].some(finite)).map(variable => ({
    key: `${modelId}__${runTime}__${variable}`, modelId, runTime, variable, times: hourly.time,
    values: hourly[variable].map((v: number | null) => v !== null && (variable !== 'temperature_2m' && v < 0 || variable === 'cloud_cover' && v > 100) ? null : v),
    fetchedAt, checkedAt: fetchedAt, availableAt: update?.initialisedAt === utc(runTime) ? update.availableAt : undefined, nativeHours: update?.nativeHours,
    forecastLocation: [data.latitude, data.longitude, data.elevation].every(finite) ? { latitude: data.latitude, longitude: data.longitude, elevation: data.elevation } : undefined,
  }));
}
