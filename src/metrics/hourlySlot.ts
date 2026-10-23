import { SNOW_HOURLY_THRESHOLD_CM } from '../config/forecast.ts';
import type { VariableId } from '../config/models.ts';
import { HOUR, localTime, msToMph, utc } from '../data/contracts.ts';
import { familyWeights } from '../forecast/policy.ts';
import { PRECIP_3H, PRECIP_6H, GUST } from '../forecast/events.ts';
import type { EnsembleIndex } from '../forecast/events.ts';
import type { ForecastSignals } from '../forecast/signals.ts';
import { forecastDaylight, formatPrecipitation, getHourlyCondition, weightedWeatherCodes } from './hourlyWeather.ts';

export const formatHourlySpeed = (ms: number | null) => ms === null || !Number.isFinite(ms) || ms < 0 ? '—' : `${Math.round(msToMph(ms))} mph`;
const localDateTime = (time: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(time);

/** CachedRun retains provider UTC timestamps and validated canonical units. Instant
 * values use start; preceding-hour totals/maxima use end, without interpolation.
 * Each field prefers fresh samples, falling back to explicitly marked cached data.
 */
export function buildHourlySlot(signals: ForecastSignals, time: string, ensembles?: EnsembleIndex) {
  const start = utc(time);
  const end = start + HOUR;
  const cachedFields: VariableId[] = [];
  const samples = (variable: VariableId, instant: number) => {
    const all = signals.samples(variable, instant);
    const fresh = all.filter(v => !v.stale);
    if (!fresh.length && all.length) cachedFields.push(variable);
    return fresh.length ? fresh : all;
  };
  const mean = (variable: VariableId, instant: number) => { samples(variable, instant); return signals.mean(variable, instant); };
  const temperature = mean('temperature_2m', start);
  const wind = mean('wind_speed_10m', start);
  const precipitation = mean('precipitation', end);
  const snowfall = mean('snowfall', end);
  const gust = mean('wind_gusts_10m', end);
  const cloud = mean('cloud_cover', start);
  const daylight = forecastDaylight(samples('is_day', start));
  const support = weightedWeatherCodes(samples('weather_code', start));
  const codes = support.map(v => v.code);
  const snowSupport = familyWeights(samples('snowfall', end)).filter(v => v.source.value >= SNOW_HOURLY_THRESHOLD_CM).reduce((sum, v) => sum + v.weight, 0);
  const resolved = getHourlyCondition({ codes, support, snowSupport, precipitation, snowfall, cloud, daylight });
  const windowHours = Math.max(3, ...samples('precipitation', end).map(s => s.nativeHours ?? 1)) > 3 ? 6 : 3;
  const windowStart = Math.floor(start / (windowHours * HOUR)) * windowHours * HOUR;
  const rainWindow = signals.event(windowHours === 6 ? PRECIP_6H : PRECIP_3H, windowStart, windowStart + windowHours * HOUR, ensembles);
  const gustWindow = signals.event({ ...GUST, label: `gust at least 30 mph over ${windowHours} hours` }, windowStart, windowStart + windowHours * HOUR, ensembles);
  const coarseRain = samples('precipitation', end).some(s => (s.nativeHours ?? 1) > 1);
  const cached = cachedFields.length > 0;
  const condition = cached ? { ...resolved, description: `${resolved.description ?? resolved.label}; includes cached forecast data` } : resolved;
  const display = {
    time: localTime(start), interval: `${localDateTime(start)} to ${localDateTime(end)}`,
    temperature: temperature === null ? '—' : `${Math.round(temperature)}°C`,
    precipitation: coarseRain ? `See ${windowHours}h window` : formatPrecipitation(precipitation), wind: formatHourlySpeed(wind), gust: formatHourlySpeed(gust),
  };
  const fieldLabel = (variable: VariableId, label: string, value: string) => `${label} ${value === '—' ? 'unavailable' : value}${cachedFields.includes(variable) ? ', cached forecast' : ''}`;
  return {
    start, end, temperature, wind, gust, precipitation, snowfall, cloud, daylight, codes, condition, rainWindow, gustWindow, coarseRain, cached, cachedFields, display,
    accessible: {
      interval: `Forecast slot ${display.interval}`,
      temperature: fieldLabel('temperature_2m', 'Temperature at the shown time', display.temperature),
      precipitation: fieldLabel('precipitation', coarseRain ? `Hourly rain timing unsupported; see ${windowHours}-hour window` : 'Precipitation total for the following hour', display.precipitation),
      wind: fieldLabel('wind_speed_10m', 'Sustained wind at the shown time', display.wind),
      gust: fieldLabel('wind_gusts_10m', 'Gust, blend of model maxima for the following hour', display.gust),
    },
  };
}
