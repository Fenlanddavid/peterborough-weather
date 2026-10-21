import { resource } from '../data/resource.ts';
import { scheduledFetch } from '../data/scheduler.ts';
import { finite, HOUR, utc } from '../data/contracts.ts';
import type { Provenance, SourceResult } from '../data/contracts.ts';
import { DETERMINISTIC_MODELS } from '../config/models.ts';
import { SKY_MODELS } from '../data/probes.ts';
export const CORE_SKY = ['cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'temperature_2m', 'dew_point_2m', 'relative_humidity_2m', 'wind_speed_10m', 'wind_gusts_10m', 'precipitation'];
export const OPTIONAL_SKY = ['visibility', 'wind_speed_250hPa'];
const expectedUnits: Record<string, string> = { cloud_cover: '%', cloud_cover_low: '%', cloud_cover_mid: '%', cloud_cover_high: '%', temperature_2m: '°C', dew_point_2m: '°C', relative_humidity_2m: '%', visibility: 'm', wind_speed_250hPa: 'm/s', wind_speed_10m: 'm/s', wind_gusts_10m: 'm/s', precipitation: 'mm', aerosol_optical_depth: '', dust: 'μg/m³' };
export interface SkyWeather extends Provenance { times: number[]; variables: Record<string, (number | null)[]>; variableProvenance: Record<string, Provenance>; warnings: string[] }
export function parseSky(raw: unknown, modelId: string, variables: string[], fetchedAt = Date.now(), provider = 'Open-Meteo Forecast'): SkyWeather {
  const data = raw as { hourly?: Record<string, unknown>; hourly_units?: Record<string, string>; utc_offset_seconds?: number };
  const hourly = data?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !hourly.time.length || data.utc_offset_seconds !== 0) throw new RangeError('Missing UTC weather time axis');
  const times = hourly.time.map(t => typeof t === 'string' ? utc(t) : NaN);
  if (times.some((t, i) => !finite(t) || (i > 0 && t - times[i - 1] !== HOUR))) throw new RangeError('Invalid weather times');
  const parsed: Record<string, (number | null)[]> = {};
  const units: Record<string, string> = {};
  const warnings: string[] = [];
  for (const variable of variables) {
    // Single-model requests use plain keys; accept only the explicit requested model suffix as well.
    const key = Object.hasOwn(hourly, variable) ? variable : `${variable}_${modelId}`;
    const array = hourly[key];
    if (!Array.isArray(array)) { warnings.push(`${variable}: absent`); continue; }
    if (array.length !== times.length || array.some(v => v !== null && !finite(v))) throw new RangeError(`Invalid sky array ${key}`);
    if (array.every(v => v === null)) { warnings.push(`${variable}: all null, unavailable`); parsed[variable] = array; units[variable] = data.hourly_units?.[key] ?? 'unknown (all-null column; provider omitted units)'; continue; }
    const unit = data.hourly_units?.[key];
    if (unit !== expectedUnits[variable]) throw new RangeError(`Invalid units ${key}: ${unit}`);
    const fraction = variable.startsWith('cloud_cover') || variable === 'relative_humidity_2m';
    if (array.some(v => v !== null && (fraction ? v < 0 || v > 100 : !['temperature_2m', 'dew_point_2m'].includes(variable) && v < 0))) throw new RangeError(`Out-of-range sky ${key}`);
    parsed[variable] = array.map(v => v === null ? null : fraction ? v / 100 : v);
    units[variable] = fraction ? 'fraction' : unit!;
    if (array.every(v => v === null)) warnings.push(`${variable}: all null, unavailable`);
    else if (array.some(v => v === null)) warnings.push(`${variable}: incomplete coverage`);
  }
  if (!Object.values(parsed).some(a => a.some(finite))) throw new RangeError('No usable weather data');
  const provenance: Provenance = { provider, modelId, family: DETERMINISTIC_MODELS.find(m => m.id === modelId)?.family, issuedAt: null, sourceTime: null, fetchedAt, validFrom: times[0], validTo: times.at(-1)! + HOUR, units, coverage: 'Provider hourly output; native temporal resolution may be coarser. Model issue time not supplied.' };
  return { ...provenance, times, variables: parsed, variableProvenance: Object.fromEntries(Object.keys(parsed).map(v => [v, provenance])), warnings };
}
async function requestSky(modelId: string, variables: string[], signal?: AbortSignal) {
  const params = new URLSearchParams({ latitude: '52.5736', longitude: '-0.2400', models: modelId, hourly: variables.join(','), forecast_days: '9', timezone: 'GMT', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' });
  const response = await scheduledFetch(`https://api.open-meteo.com/v1/forecast?${params}`, { optional: true, signal });
  return parseSky(await response.json(), modelId, variables);
}
export function fetchSkyModel(modelId: string, signal?: AbortSignal): Promise<SourceResult<SkyWeather>> {
  return resource(`sky:${modelId}`, HOUR, async () => {
    const core = await requestSky(modelId, CORE_SKY, signal);
    try {
      const optional = await requestSky(modelId, modelId === 'ecmwf_ifs025' ? ['wind_speed_250hPa'] : OPTIONAL_SKY, signal);
      if (JSON.stringify(optional.times) !== JSON.stringify(core.times)) throw new RangeError('Optional weather time axis differs');
      return { ...core, variables: { ...core.variables, ...optional.variables }, units: { ...core.units, ...optional.units }, variableProvenance: { ...core.variableProvenance, ...optional.variableProvenance }, warnings: [...core.warnings, ...optional.warnings] };
    } catch (error) { return { ...core, warnings: [...core.warnings, `Optional visibility/jet refresh failed: ${String(error)}`] }; }
  });
}
export function fetchAirQuality(signal?: AbortSignal): Promise<SourceResult<SkyWeather>> {
  return resource('air-quality', 6 * HOUR, async () => {
    const params = new URLSearchParams({ latitude: '52.5736', longitude: '-0.2400', hourly: 'aerosol_optical_depth,dust', domains: 'cams_global', forecast_days: '7', timezone: 'GMT' });
    const response = await scheduledFetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, { optional: true, signal });
    return parseSky(await response.json(), 'cams_global', ['aerosol_optical_depth', 'dust'], Date.now(), 'Open-Meteo / CAMS');
  });
}
export { SKY_MODELS };
export function buildSkyIndex(datasets: SkyWeather[]) {
  return datasets.map(data => {
    const times = new Map(data.times.map((t, i) => [t, i]));
    return { data, value(variable: string, time: number): number | null { const i = times.get(time); return i === undefined ? null : data.variables[variable]?.[i] ?? null; } };
  });
}
export type SkyIndex = ReturnType<typeof buildSkyIndex>;
