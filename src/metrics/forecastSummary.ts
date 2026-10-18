import type { CachedRun } from '../types';
import { DETERMINISTIC_MODELS, type VariableId } from '../config/models.ts';
import { getLocalDate, getLocalDayHours, toLocalTime } from '../hooks/useLocalTime.ts';

export interface SummaryDay {
  date: string;
  label: string;
  remainingToday: boolean;
  expectedHours: number;
  temperatureHours: number;
  rainHours: number;
  weatherCode: number | null;
  high: number | null;
  low: number | null;
  rainMm: number | null;
  snowCm: number | null;
  windMph: number | null;
  gustMph: number | null;
  gustTime: string | null;
  rainTiming: string | null;
  modelCount: number;
  temperatureSpread: number | null;
  paragraphs: string[];
}

interface Hour {
  time: string;
  weatherCode: number | null;
  temperature: number | null;
  rain: number | null;
  snow: number | null;
  wind: number | null;
  gust: number | null;
  temperatureModels: number;
  temperatureSpread: number | null;
}

export interface ForecastBriefing {
  days: SummaryDay[];
  hasData: boolean;
  overview: string;
  temperature: string;
  rainfall: string;
  wind: string;
  cold: string;
  agreement: string;
  latestRun: string | null;
  stale: boolean;
}

const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const max = (values: number[]): number | null => values.length ? Math.max(...values) : null;
const min = (values: number[]): number | null => values.length ? Math.min(...values) : null;
const available = (values: (number | null)[]): number[] => values.filter((value): value is number => value !== null);
// Weather codes are categories; their numeric mean would describe a different condition.
const mostFrequentCode = (values: number[]): number | null => {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (Number.isInteger(value) && value >= 0 && value <= 99) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const degrees = (value: number) => `${Math.round(value)}°C`;
const periodName = (day: SummaryDay) => day.label === 'Today' ? 'the rest of today' : day.label;
const joinDays = (days: SummaryDay[]) => new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(days.map(periodName));
const fullRain = (day: SummaryDay) => day.rainHours === day.expectedHours && day.expectedHours > 0;

function rainTiming(hours: Hour[]): string | null {
  const wet = hours.filter((hour) => hour.rain !== null && hour.rain >= 0.1);
  if (!wet.length) return null;
  const periods = [
    { label: 'overnight (00:00–06:00)', start: 0, end: 6 },
    { label: 'in the morning (06:00–12:00)', start: 6, end: 12 },
    { label: 'in the afternoon (12:00–18:00)', start: 12, end: 18 },
    { label: 'in the evening (18:00–00:00)', start: 18, end: 24 },
  ].map((period) => ({ ...period, total: wet.reduce((sum, hour) => {
    const localHour = Number(toLocalTime(hour.time, 'time').slice(0, 2));
    return sum + (localHour >= period.start && localHour < period.end ? hour.rain! : 0);
  }, 0) })).filter((period) => period.total > 0).sort((a, b) => b.total - a.total);
  if (periods.length >= 3) return 'Rain is spread across several parts of the day.';
  return `Rain is mainly indicated ${periods[0].label}${periods.length === 2 ? ` and ${periods[1].label}` : ''}.`;
}

function describeDay(day: SummaryDay): string[] {
  const lines: string[] = [];
  if (day.high !== null && day.low !== null) {
    lines.push(`Temperatures range from ${degrees(day.low)} to ${degrees(day.high)}${day.temperatureHours < day.expectedHours ? ' across the available hours' : ''}.`);
  } else lines.push('Temperature data is unavailable.');

  if (day.rainMm === null) lines.push('Rainfall data is unavailable; this is not a dry-weather signal.');
  else {
    const amount = day.rainMm.toFixed(1);
    lines.push(fullRain(day)
      ? day.rainMm < 0.1 ? 'Little or no rain is indicated.' : `Around ${amount} mm of rain is indicated. ${day.rainTiming ?? 'Only small amounts are indicated in individual hours.'}`
      : `The available hours show ${amount} mm of rain, but coverage is incomplete (${day.rainHours} of ${day.expectedHours} hours).${day.rainTiming ? ` ${day.rainTiming}` : ''}`);
  }

  if (day.windMph !== null) lines.push(`Winds average around ${Math.round(day.windMph)} mph across the available hours${day.gustMph !== null ? `, with peak gusts near ${Math.round(day.gustMph)} mph${day.gustTime ? ` around ${day.gustTime}` : ''}` : '; gust data is unavailable'}.`);
  else if (day.gustMph !== null) lines.push(`Peak gusts are around ${Math.round(day.gustMph)} mph${day.gustTime ? ` near ${day.gustTime}` : ''}; average wind data is unavailable.`);
  else lines.push('Wind and gust data is unavailable.');

  if (day.snowCm !== null && day.snowCm > 0) lines.push(`The models indicate ${day.snowCm < 0.1 ? 'a trace of snowfall' : `around ${day.snowCm.toFixed(1)} cm of snowfall`} across the available hours; settling is uncertain.`);
  if (day.low !== null && day.low <= 0) lines.push('Air temperatures reach freezing or below during the forecast period.');
  if (day.temperatureSpread !== null) lines.push(`${day.modelCount} temperature models contribute, with a largest same-hour difference of ${day.temperatureSpread.toFixed(1)}°C.`);
  else if (day.modelCount === 1) lines.push('Only one temperature model is available, so model agreement cannot be assessed.');
  return lines;
}

/** Generate a briefing from the latest non-overlay runs, using Peterborough's calendar days. */
export function buildForecastBriefing(runs: CachedRun[], now: Date): ForecastBriefing {
  const models = DETERMINISTIC_MODELS.filter((model) => !model.isOverlay);
  const modelIds = new Set(models.map((model) => model.id));
  const latest = new Map<string, CachedRun>();
  for (const run of runs) {
    if (!modelIds.has(run.modelId)) continue;
    const key = `${run.modelId}:${run.variable}`;
    if (!latest.has(key) || latest.get(key)!.runTime < run.runTime) latest.set(key, run);
  }
  // Index once: the same hourly values are used for the narrative and model agreement.
  const indexed = new Map([...latest].map(([key, run]) => [key, new Map(run.times.map((time, i) => [time, run.values[i]]))]));
  const valuesAt = (variable: VariableId, time: string): number[] => models.flatMap((model) => {
    const value = indexed.get(`${model.id}:${variable}`)?.get(time);
    if (typeof value !== 'number' || !Number.isFinite(value)) return [];
    if (variable !== 'temperature_2m' && value < 0) return [];
    return [variable === 'wind_speed_10m' || variable === 'wind_gusts_10m' ? value * 2.23694 : value];
  });
  const today = getLocalDate(now);
  const currentHour = Math.floor(now.getTime() / 3600_000) * 3600_000;
  const days: SummaryDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + index * 86400_000).toISOString().slice(0, 10);
    const times = getLocalDayHours(date).filter((time) => index > 0 || Date.parse(`${time}Z`) >= currentHour);
    const hours: Hour[] = times.map((time) => {
      const temperatures = valuesAt('temperature_2m', time);
      return {
        time, weatherCode: mostFrequentCode(valuesAt('weather_code', time)), temperature: mean(temperatures), rain: mean(valuesAt('precipitation', time)),
        snow: mean(valuesAt('snowfall', time)), wind: mean(valuesAt('wind_speed_10m', time)),
        gust: mean(valuesAt('wind_gusts_10m', time)), temperatureModels: temperatures.length,
        temperatureSpread: temperatures.length > 1 ? Math.max(...temperatures) - Math.min(...temperatures) : null,
      };
    });
    const rain = available(hours.map((hour) => hour.rain));
    const snow = available(hours.map((hour) => hour.snow));
    const gust = max(available(hours.map((hour) => hour.gust)));
    const peakGustHours = hours.filter((hour) => gust !== null && hour.gust === gust);
    const day: SummaryDay = {
      date, label: index === 0 ? 'Today' : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' }),
      remainingToday: index === 0, expectedHours: times.length,
      temperatureHours: hours.filter((hour) => hour.temperature !== null).length, rainHours: rain.length,
      weatherCode: mostFrequentCode(available(hours.map((hour) => hour.weatherCode))),
      high: max(available(hours.map((hour) => hour.temperature))), low: min(available(hours.map((hour) => hour.temperature))),
      rainMm: rain.length ? rain.reduce((sum, value) => sum + value, 0) : null,
      snowCm: snow.length ? snow.reduce((sum, value) => sum + value, 0) : null,
      windMph: mean(available(hours.map((hour) => hour.wind))), gustMph: gust,
      gustTime: peakGustHours.length === 1 ? toLocalTime(peakGustHours[0].time, 'time') : null,
      rainTiming: rainTiming(hours), modelCount: Math.max(0, ...hours.map((hour) => hour.temperatureModels)),
      temperatureSpread: max(available(hours.map((hour) => hour.temperatureSpread))), paragraphs: [],
    };
    day.paragraphs = describeDay(day);
    return day;
  });
  const withTemp = days.filter((day) => day.high !== null);
  const completeTemp = withTemp.filter((day) => day.temperatureHours === day.expectedHours);
  const wet = days.filter((day) => day.rainMm !== null && day.rainMm >= 0.5);
  const completeRain = days.filter(fullRain);
  const warmest = [...completeTemp].sort((a, b) => b.high! - a.high!)[0];
  const coldest = [...completeTemp].sort((a, b) => a.low! - b.low!)[0];
  const wettest = [...completeRain].sort((a, b) => b.rainMm! - a.rainMm!)[0];
  const windiest = [...days].filter((day) => day.gustMph !== null).sort((a, b) => b.gustMph! - a.gustMph!)[0];
  const freezing = days.filter((day) => day.low !== null && day.low <= 0);
  const snowy = days.filter((day) => day.snowCm !== null && day.snowCm > 0);
  const hasData = days.some((day) => day.weatherCode !== null || day.high !== null || day.rainMm !== null || day.windMph !== null || day.gustMph !== null || day.snowCm !== null);

  let temperature = withTemp.length
    ? `Forecast highs range from ${degrees(Math.min(...withTemp.map((day) => day.high!)))} to ${degrees(Math.max(...withTemp.map((day) => day.high!)))} across the available days.`
    : 'Temperature data is unavailable, so a temperature trend cannot be assessed.';
  if (warmest && coldest) temperature += ` The highest forecast temperature is ${degrees(warmest.high!)} for ${periodName(warmest)}; the lowest is ${degrees(coldest.low!)} for ${periodName(coldest)}.`;
  if (completeTemp.length < 7 && withTemp.length) temperature += ' Temperature coverage is incomplete; the full range may be wider.';
  const early = mean(days.slice(1, 3).filter((day) => day.temperatureHours === day.expectedHours).map((day) => day.high!));
  const late = mean(days.slice(4, 7).filter((day) => day.temperatureHours === day.expectedHours).map((day) => day.high!));
  if (early !== null && late !== null) temperature += late - early >= 2
    ? ' The later days look warmer than the next couple of days.'
    : early - late >= 2 ? ' The later days look cooler than the next couple of days.' : ' Daytime highs look broadly similar between the next couple of days and later in the week.';

  let rainfall = completeRain.length === 7
    ? `${wet.length} of the next seven forecast periods ${wet.length === 1 ? 'has' : 'have'} at least 0.5 mm of rain indicated, totalling around ${days.reduce((sum, day) => sum + day.rainMm!, 0).toFixed(1)} mm.`
    : `Rainfall coverage is complete for ${completeRain.length} of the seven forecast periods. Missing hours cannot be treated as dry, so a full-week total is not available.`;
  if (wettest && wettest.rainMm! >= 0.5) rainfall += ` The wettest fully covered period is ${periodName(wettest)}, at around ${wettest.rainMm!.toFixed(1)} mm. ${wettest.rainTiming ?? ''}`;
  const dry = completeRain.filter((day) => day.rainMm! < 0.1);
  if (dry.length) rainfall += ` Little or no rain is indicated for ${joinDays(dry)}.`;

  const winds = available(days.map((day) => day.windMph));
  let wind = winds.length ? `Average winds range from around ${Math.round(Math.min(...winds))} to ${Math.round(Math.max(...winds))} mph across the available periods.` : 'Average wind data is unavailable.';
  wind += windiest ? ` The strongest forecast gusts are near ${Math.round(windiest.gustMph!)} mph for ${periodName(windiest)}${windiest.gustTime ? ` around ${windiest.gustTime}` : ''}.` : ' Gust data is unavailable.';
  const gusty = days.filter((day) => day.gustMph !== null && day.gustMph >= 30);
  if (gusty.length) wind += ` Gusts of 30 mph or more are indicated for ${joinDays(gusty)}.`;

  const cold = [
    freezing.length ? `Freezing or below-freezing air temperatures are indicated for ${joinDays(freezing)}.` : '',
    snowy.length ? `A snowfall signal appears for ${joinDays(snowy)}. Forecast snowfall does not guarantee snow will settle.` : '',
  ].filter(Boolean).join(' ');

  const compared = days.filter((day) => day.temperatureSpread !== null);
  const divergent = compared.filter((day) => day.temperatureSpread! >= 4);
  let agreement = compared.length ? `Temperature model agreement can be compared on ${compared.length} of the seven periods.` : 'There are not enough overlapping temperature forecasts to compare model agreement.';
  if (divergent.length) agreement += ` The models differ by at least 4°C at the same hour for ${joinDays(divergent)}, so the exact temperatures are less settled.`;
  else if (compared.length) agreement += ' Where multiple models overlap, their same-hour temperature differences stay below 4°C.';
  agreement += ' This measures model spread, not the probability of a forecast being correct. Rain timing and other details can change, especially further ahead.';
  const usedRuns = [...latest.values()].filter((run) => ['temperature_2m', 'precipitation', 'snowfall', 'wind_speed_10m', 'wind_gusts_10m'].includes(run.variable)
    && run.times.some((time, index) => Date.parse(`${time}Z`) >= currentHour && typeof run.values[index] === 'number' && Number.isFinite(run.values[index])));
  const latestRun = usedRuns.map((run) => run.runTime).sort().at(-1) ?? null;
  const stale = latestRun !== null && now.getTime() - Date.parse(`${latestRun}Z`) > 24 * 3600_000;
  const overview = !hasData ? 'A detailed briefing will appear once forecast data is available.'
    : `${temperature.split('. ')[0].replace(/\.$/, '')}. ${completeRain.length === 7 ? wet.length ? `Rain is indicated in ${wet.length} of the seven forecast periods.` : 'Very little rain is indicated across the seven forecast periods.' : 'Rainfall coverage is incomplete, so check the daily detail before planning.'}${windiest ? ` Peak gusts are around ${Math.round(windiest.gustMph!)} mph for ${periodName(windiest)}.` : ''}`;
  return { days, hasData, overview, temperature, rainfall, wind, cold, agreement, latestRun, stale };
}
