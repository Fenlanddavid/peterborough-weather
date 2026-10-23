import type { CachedRun } from '../types';
import type { VariableId } from '../config/models.ts';
import { getLocalDate, getLocalDayHours, toLocalTime } from '../hooks/useLocalTime.ts';
import { buildForecastSignals, familyMean } from '../forecast/signals.ts';
import type { ModelValue, ForecastContext, Disagreement } from '../forecast/signals.ts';
import { eventTimes, PRECIP_DAY, SNOW, GUST } from '../forecast/events.ts';
import type { EnsembleIndex } from '../forecast/events.ts';
import type { EventEstimate, Provenance } from '../data/contracts.ts';
import { HOUR, msToMph, utc, eventPercent } from '../data/contracts.ts';
import { forecastDaylight, getDailyCondition } from './hourlyWeather.ts';
import type { IconName } from '../components/WeatherIcon';

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
  gustUpperMph: number | null;
  gustEvent: EventEstimate;
  gustReference: { mph: number; start: number; end: number } | null;
  hazardTiming: string[];
  disagreements: Disagreement[];
  rainTiming: string | null;
  modelCount: number;
  temperatureSpread: number | null;
  paragraphs: string[];
  precipitation: EventEstimate;
  completeModels: number;
  condition: { label: string; icon: IconName | null };
  provenance: Provenance[];
  stale: boolean;
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
const available = (values: (number | null)[]): number[] => values.filter((value): value is number => value !== null);
const preferFresh = (values: ModelValue[]) => values.some(v => !v.stale) ? values.filter(v => !v.stale) : values;
// Weather codes are categories; their numeric mean would describe a different condition.
const mostFrequentCode = (values: number[]): number | null => {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (Number.isInteger(value) && value >= 0 && value <= 99) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};
const degrees = (value: number) => `${Math.round(value)}°C`;
const periodName = (day: SummaryDay) => day.label !== 'Today' ? day.label : day.remainingToday ? 'the rest of today' : 'today';
const joinDays = (days: SummaryDay[]) => new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }).format(days.map(periodName));
const fullRain = (day: SummaryDay) => day.rainMm !== null && day.expectedHours > 0 && (day.completeModels > 0 || day.precipitation.basis === 'ensemble-probability' && day.precipitation.value !== null);

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
  return `Rain is mainly expected ${periods[0].label}${periods.length === 2 ? ` and ${periods[1].label}` : ''}.`;
}

function describeDay(day: SummaryDay): string[] {
  const lines: string[] = [];
  if (day.stale) lines.push('Some displayed values use older cached output beyond the source’s expected publication cadence. Older output is excluded from new event recommendations.');
  if (day.high !== null && day.low !== null) {
    lines.push(`Temperatures range from ${degrees(day.low)} to ${degrees(day.high)}${day.temperatureHours < day.expectedHours ? ' across the available hours' : ''}.`);
  } else lines.push(`A complete temperature window is unavailable (${day.temperatureHours} of ${day.expectedHours} hours have some data).`);

  if (day.rainMm !== null) {
    const amount = day.rainMm.toFixed(1);
    if (day.rainMm === 0) lines.push('No rain indicated across the fully covered period.');
    else if (day.rainMm < 0.1) lines.push('Trace precipitation (less than 0.1 mm) indicated across the fully covered period.');
    else if (day.rainMm < 1) lines.push(`Precipitation total around ${amount} mm.${day.rainTiming ? ` ${day.rainTiming}` : ''}`);
    else if (day.rainMm < 5) lines.push(`Precipitation total around ${amount} mm.${day.rainTiming ? ` ${day.rainTiming}` : ''}`);
    else lines.push(`Precipitation total around ${amount} mm.${day.rainTiming ? ` ${day.rainTiming}` : ''}`);
  } else lines.push('Rainfall coverage is incomplete or unavailable; missing hours cannot be described as dry.');
  if (day.precipitation.value !== null) lines.push(`${day.precipitation.basis === 'ensemble-probability' ? 'Ensemble probability' : 'Deterministic agreement (not probability)'}: ${eventPercent(day.precipitation.value)} for ${day.precipitation.threshold}.`);
  if (day.precipitation.conditionalAmount !== null) lines.push(`When the event occurs, the wet-condition median is ${day.precipitation.conditionalAmount.toFixed(1)} mm; this is separate from the ${day.precipitation.basis === 'ensemble-probability' ? 'ensemble expected amount' : 'deterministic blended total'}.`);
  if (day.precipitation.metOfficeProbability !== undefined) lines.push(`Met Office probability for the identical interval: ${eventPercent(day.precipitation.metOfficeProbability)}.`);

  if (day.windMph !== null) lines.push(`Winds average around ${Math.round(day.windMph)} mph across the available hours${day.gustMph !== null ? `, with peak gusts near ${Math.round(day.gustMph)} mph${day.gustTime ? ` around ${day.gustTime}` : ''}` : '; gust data is unavailable'}.`);
  else if (day.gustMph !== null) lines.push(`Peak gusts are around ${Math.round(day.gustMph)} mph${day.gustTime ? ` near ${day.gustTime}` : ''}; average wind data is unavailable.`);
  else lines.push('Wind and gust data is unavailable.');

  if (day.gustUpperMph !== null) lines.push(`Ensemble upper (90th percentile) period-maximum gust: ${Math.round(day.gustUpperMph)} mph${day.gustEvent.value !== null ? `; ${eventPercent(day.gustEvent.value)} probability of at least 30 mph` : ''}.`);
  if (day.gustReference) lines.push(`Met Office source-specific 90th percentile reference: ${Math.round(day.gustReference.mph)} mph for ${toLocalTime(new Date(day.gustReference.start).toISOString(), 'time')}–${toLocalTime(new Date(day.gustReference.end).toISOString(), 'time')}. This is a source period reference, not a blended daily percentile.`);
  const aligned = [...day.precipitation.alignedWindows ?? [], ...day.gustEvent.alignedWindows ?? []];
  const uniqueAlignments = [...new Map(aligned.map(w => [`${w.modelId}:${w.start}:${w.end}`, w])).values()];
  if (uniqueAlignments.length) lines.push(`Native timing: ${uniqueAlignments.map(w => `${w.modelId} shifted ${w.shiftHours > 0 ? '+' : ''}${w.shiftHours} h for the same-length event window`).join('; ')}.`);
  for (const risk of day.hazardTiming) lines.push(risk);
  if (day.disagreements.length) lines.push('Forecast sources disagree on matching quantities; the difference is a diagnostic, not an observed error.');
  if (day.snowCm !== null && day.snowCm > 0) lines.push(`The models indicate ${day.snowCm < 0.1 ? 'a trace of snowfall' : `around ${day.snowCm.toFixed(1)} cm of snowfall`} across the available hours; settling is uncertain.`);
  if (day.low !== null && day.low <= 0) lines.push('Air temperatures reach freezing or below during the forecast period.');
  if (day.temperatureSpread !== null) lines.push(`${day.modelCount} temperature models contribute, with a largest same-hour difference of ${day.temperatureSpread.toFixed(1)}°C.`);
  else if (day.modelCount === 1) lines.push('Only one temperature model is available, so model agreement cannot be assessed.');
  return lines;
}

export interface BriefingOptions {
  /** Include today's earlier hours (the home screen's day cards) rather than only what's left. */
  wholeToday?: boolean;
  ensembles?: EnsembleIndex;
  context?: ForecastContext;
}

/** Generate a complete-window family-weighted briefing, including eligible UKV data. */
export function buildForecastBriefing(runs: CachedRun[], now: Date, options: BriefingOptions = {}): ForecastBriefing {
  const signals = buildForecastSignals(runs, now.getTime(), options.context);
  const latest = new Map([...signals.groups].flatMap(([key, runs]) => runs[0] ? [[key, runs[0]] as const] : []));
  const valuesAt = (variable: VariableId, time: string): number[] => signals.samples(variable, utc(time)).map(v => v.value);
  const today = getLocalDate(now);
  const currentHour = Math.floor(now.getTime() / 3600_000) * 3600_000;
  const weightedAt = (variable: VariableId, time: string) => {
    const value = signals.mean(variable, utc(time));
    return value !== null && /^wind_/.test(variable) ? msToMph(value) : value;
  };
  const days: SummaryDay[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.parse(`${today}T12:00:00Z`) + index * 86400_000).toISOString().slice(0, 10);
    const times = getLocalDayHours(date).filter((time) => index > 0 || options.wholeToday || Date.parse(`${time}Z`) >= currentHour);
    const hours: Hour[] = times.map((time) => {
      const temperatures = valuesAt('temperature_2m', time);
      return {
        time, weatherCode: mostFrequentCode(valuesAt('weather_code', time)), temperature: weightedAt('temperature_2m', time), rain: weightedAt('precipitation', new Date(utc(time) + HOUR).toISOString()),
        snow: weightedAt('snowfall', new Date(utc(time) + HOUR).toISOString()), wind: weightedAt('wind_speed_10m', time),
        gust: weightedAt('wind_gusts_10m', new Date(utc(time) + HOUR).toISOString()), temperatureModels: temperatures.length,
        temperatureSpread: temperatures.length > 1 ? Math.max(...temperatures) - Math.min(...temperatures) : null,
      };
    });
    const rain = available(hours.map((hour) => hour.rain));
    const gust = max(available(hours.map((hour) => hour.gust)));
    const peakGustHours = hours.filter((hour) => gust !== null && hour.gust === gust);
    const start = times.length ? utc(times[0]) : currentHour;
    const end = times.length ? utc(times.at(-1)!) + HOUR : start;
    const sampleTimes = times.map(utc);
    const highs = preferFresh(signals.aggregate('temperature_2m', sampleTimes, 'max'));
    const lows = preferFresh(signals.aggregate('temperature_2m', sampleTimes, 'min'));
    const precipitation = signals.event(PRECIP_DAY, start, end, options.ensembles);
    const rainCohort = preferFresh(signals.aggregate('precipitation', eventTimes(PRECIP_DAY, start, end), 'sum'));
    const snowCohort = preferFresh(signals.aggregate('snowfall', eventTimes(SNOW, start, end), 'sum'));
    const winds = preferFresh(signals.aggregate('wind_speed_10m', sampleTimes, 'sum')).map(v => ({ ...v, value: v.value / sampleTimes.length }));
    const gusts = preferFresh(signals.aggregate('wind_gusts_10m', eventTimes({ ...SNOW, variable: 'wind_gusts_10m', operation: 'max' }, start, end), 'max'));
    const contributors = [...highs, ...lows, ...rainCohort, ...snowCohort, ...winds, ...gusts];
    const conditions = times.map(t => getDailyCondition(signals, t));
    // Day cards describe daytime, so longer nights cannot outvote the day's weather.
    // Without daylight flags use 09:00–17:00 local, retaining neutral sky artwork.
    const daytimeConditions = conditions.filter((_, i) => {
      const daylight = forecastDaylight(signals.samples('is_day', utc(times[i])));
      const localHour = Number(toLocalTime(times[i], 'time').slice(0, 2));
      return daylight === 1 || daylight === null && localHour >= 9 && localHour < 17;
    });
    // The detail summary can cover only the remaining evening of today.
    const headlineConditions = !daytimeConditions.length && index === 0 && !options.wholeToday ? conditions : daytimeConditions;
    const counts = new Map<string, { condition: typeof conditions[number]; hours: number }>();
    for (const condition of headlineConditions) {
      if (condition.icon === null) continue;
      const key = condition.label; const current = counts.get(key); counts.set(key, { condition, hours: (current?.hours ?? 0) + 1 });
    }
    const rankedConditions = [...counts.values()].sort((a, b) => b.hours - a.hours || a.condition.label.localeCompare(b.condition.label));
    const isHazard = (c: typeof conditions[number]) => ['storm', 'snow', 'fog'].includes(c.icon ?? '') || /freezing/i.test(c.label);
    const condition = rankedConditions.find(c => !isHazard(c.condition) || c.hours >= headlineConditions.length / 2)?.condition ?? rankedConditions[0]?.condition ?? { label: 'Unavailable', icon: null };
    const hazardTiming = conditions.flatMap((c, i) => {
      const hazard = ['storm', 'snow'].includes(c.icon ?? '') || /freezing/i.test(c.label);
      const labels = [...(hazard ? [c.label] : []), ...(c.risks ?? []).map(r => `${r.label} risk (${Math.round(r.support * 100)}% family support, not probability)` )];
      return labels.length ? [`${labels.join('; ')} near ${toLocalTime(times[i], 'time')}; may be brief.`] : [];
    });
    const gustEvent = signals.event({ ...GUST, label: 'gust at least 30 mph over this local forecast period' }, start, end, options.ensembles);
    const periodGust = signals.blendPeriod('wind_gusts_10m', eventTimes(GUST, start, end), 'max');
    // Peak time refers to the final hourly central trajectory. A broad plateau
    // becomes a window rather than an arbitrary first maximum.
    // A flat source trajectory has no timed peak; it must not turn another
    // source's distinct peak into a misleading all-day window.
    const timedGusts = gusts.filter(g => sampleTimes.some(t => signals.samples('wind_gusts_10m', t + HOUR).some(v => v.modelId === g.modelId && v.value < g.value)));
    const sourcePeakTimes = sampleTimes.filter(t => timedGusts.some(g => signals.samples('wind_gusts_10m', t + HOUR).some(v => v.modelId === g.modelId && v.value === g.value)));
    const peakTimes = [...new Set([...peakGustHours.map(h => utc(h.time)), ...sourcePeakTimes])].sort((a, b) => a - b);
    const uncertainPeak = peakTimes.length ? `${toLocalTime(new Date(peakTimes[0]).toISOString(), 'time')}–${toLocalTime(new Date(peakTimes.at(-1)! + HOUR).toISOString(), 'time')}` : null;
    const references = sampleTimes.flatMap(t => {
      const hourly = signals.processed('wind_gusts_10m', t, t + HOUR, 'percentile90');
      const threeHourly = t % (3 * HOUR) === 0 ? signals.processed('wind_gusts_10m', t, t + 3 * HOUR, 'percentile90') : undefined;
      return [hourly, threeHourly].flatMap(v => v && v.end <= end ? [{ mph: msToMph(v.value), start: v.start, end: v.end }] : []);
    }).sort((a, b) => b.mph - a.mph);
    const day: SummaryDay = {
      date, label: index === 0 ? 'Today' : new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' }),
      remainingToday: index === 0 && !options.wholeToday, expectedHours: times.length,
      temperatureHours: hours.filter((hour) => hour.temperature !== null).length, rainHours: rain.length,
      weatherCode: mostFrequentCode(available(hours.map((hour) => hour.weatherCode))),
      high: signals.blendPeriod('temperature_2m', sampleTimes, 'max'), low: signals.blendPeriod('temperature_2m', sampleTimes, 'min'),
      rainMm: precipitation.basis === 'ensemble-probability' ? precipitation.expectedAmount : signals.blendPeriod('precipitation', eventTimes(PRECIP_DAY, start, end), 'sum'),
      snowCm: familyMean(snowCohort),
      windMph: signals.blendPeriod('wind_speed_10m', sampleTimes, 'sum') === null ? null : msToMph(signals.blendPeriod('wind_speed_10m', sampleTimes, 'sum')! / sampleTimes.length), gustMph: periodGust === null ? null : msToMph(periodGust),
      gustTime: uncertainPeak, gustUpperMph: gustEvent.basis === 'ensemble-probability' && gustEvent.upperAmount !== null && gustEvent.upperAmount !== undefined ? msToMph(gustEvent.upperAmount) : null, gustEvent, gustReference: references[0] ?? null, hazardTiming, disagreements: signals.disagreements.filter(d => d.flagged && d.start >= start && d.start < end),
      rainTiming: rainTiming(hours), modelCount: Math.max(0, ...hours.map((hour) => hour.temperatureModels)),
      temperatureSpread: max(available(hours.map((hour) => hour.temperatureSpread))), paragraphs: [], precipitation, completeModels: rainCohort.length, condition,
      provenance: [...precipitation.provenance, ...contributors.flatMap(v => v.contributions ?? [v])], stale: contributors.some(v => v.stale),
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
    ? `${wet.length} of the next seven forecast periods ${wet.length === 1 ? 'has' : 'have'} at least 0.5 mm of precipitation indicated, totalling around ${days.reduce((sum, day) => sum + day.rainMm!, 0).toFixed(1)} mm.`
    : `Precipitation coverage is complete for ${completeRain.length} of the seven forecast periods. Missing hours cannot be treated as dry, so a full-week total is not available.`;
  if (wettest && wettest.rainMm! >= 0.5) rainfall += ` The wettest fully covered period is ${periodName(wettest)}, at around ${wettest.rainMm!.toFixed(1)} mm. ${wettest.rainTiming ?? ''}`;
  const dry = completeRain.filter((day) => day.rainMm! < 0.1);
  if (dry.length) rainfall += ` Little or no precipitation is indicated for ${joinDays(dry)}.`;

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
  const latestRun = usedRuns.filter(r => r.issueConfirmed !== false).map((run) => run.runTime).sort().at(-1) ?? null;
  const stale = days.some(day => day.stale);
  const overview = !hasData ? 'A detailed briefing will appear once forecast data is available.'
    : `${temperature.split('. ')[0].replace(/\.$/, '')}. ${completeRain.length === 7 ? wet.length ? `Precipitation is indicated in ${wet.length} of the seven forecast periods.` : 'Very little precipitation is indicated across the seven forecast periods.' : 'Precipitation coverage is incomplete, so check the daily detail before planning.'}${windiest ? ` Peak gusts are around ${Math.round(windiest.gustMph!)} mph for ${periodName(windiest)}.` : ''}`;
  return { days, hasData, overview, temperature, rainfall, wind, cold, agreement, latestRun, stale };
}
