import type { VariableId } from '../config/models.ts';
import { HOUR, localTime, msToMph, utc } from '../data/contracts.ts';
import { familyMean } from '../forecast/signals.ts';
import type { ForecastSignals } from '../forecast/signals.ts';
import { formatPrecipitation, getHourlyCondition, rankedWeatherCodes } from './hourlyWeather.ts';

export const formatHourlySpeed = (ms: number | null) => ms === null || !Number.isFinite(ms) || ms < 0 ? '—' : `${Math.round(msToMph(ms))} mph`;
const localDateTime = (time: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
}).format(time);

/** CachedRun retains provider UTC timestamps and validated canonical units. Instant
 * values use start; preceding-hour totals/maxima use end, without interpolation.
 * Each field prefers fresh samples, falling back to explicitly marked cached data.
 */
export function buildHourlySlot(signals: ForecastSignals, time: string) {
  const start = utc(time);
  const end = start + HOUR;
  const cachedFields: VariableId[] = [];
  const samples = (variable: VariableId, instant: number) => {
    const all = signals.samples(variable, instant);
    const fresh = all.filter(v => !v.stale);
    if (!fresh.length && all.length) cachedFields.push(variable);
    return fresh.length ? fresh : all;
  };
  const mean = (variable: VariableId, instant: number) => familyMean(samples(variable, instant));
  const temperature = mean('temperature_2m', start);
  const wind = mean('wind_speed_10m', start);
  const precipitation = mean('precipitation', end);
  const snowfall = mean('snowfall', end);
  const gust = mean('wind_gusts_10m', end);
  const cloud = mean('cloud_cover', start);
  const daylightSamples = samples('is_day', start).filter(v => v.value === 0 || v.value === 1);
  // Disagreement about daylight uses neutral art; never guess sunshine.
  const daylight = daylightSamples.length && daylightSamples.every(v => v.value === daylightSamples[0].value) ? daylightSamples[0].value : null;
  const codes = rankedWeatherCodes(samples('weather_code', start));
  const resolved = getHourlyCondition({ codes, precipitation, snowfall, cloud, daylight });
  const cached = cachedFields.length > 0;
  const condition = cached ? { ...resolved, description: `${resolved.description ?? resolved.label}; includes cached forecast data` } : resolved;
  const display = {
    time: localTime(start), interval: `${localDateTime(start)} to ${localDateTime(end)}`,
    temperature: temperature === null ? '—' : `${Math.round(temperature)}°C`,
    precipitation: formatPrecipitation(precipitation), wind: formatHourlySpeed(wind), gust: formatHourlySpeed(gust),
  };
  const fieldLabel = (variable: VariableId, label: string, value: string) => `${label} ${value === '—' ? 'unavailable' : value}${cachedFields.includes(variable) ? ', cached forecast' : ''}`;
  return {
    start, end, temperature, wind, gust, precipitation, snowfall, cloud, daylight, codes, condition, cached, cachedFields, display,
    accessible: {
      interval: `Forecast slot ${display.interval}`,
      temperature: fieldLabel('temperature_2m', 'Temperature at the shown time', display.temperature),
      precipitation: fieldLabel('precipitation', 'Precipitation total for the following hour', display.precipitation),
      wind: fieldLabel('wind_speed_10m', 'Sustained wind at the shown time', display.wind),
      gust: fieldLabel('wind_gusts_10m', 'Gust, blend of model maxima for the following hour', display.gust),
    },
  };
}
