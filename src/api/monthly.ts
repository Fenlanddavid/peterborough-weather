import { LOCATION } from '../config/models';
import type { MonthlyOutlookData } from '../types';
import { scheduledFetch } from '../data/scheduler.ts';

const CACHE_KEY = 'pb-weather:monthly-outlook:v1';
const CACHE_AGE = 6 * 3600_000;
let pending: Promise<MonthlyOutlookData> | null = null;

export function parseMonthlyOutlook(response: unknown, fetchedAt = Date.now()): MonthlyOutlookData {
  const weekly = (response as { weekly?: Record<string, unknown> } | null)?.weekly;
  if (!weekly || !Array.isArray(weekly.time)) throw new Error('Long-range data unavailable');
  const value = (name: string, index: number) => {
    const values = weekly[name];
    const item = Array.isArray(values) ? values[index] : null;
    return typeof item === 'number' && Number.isFinite(item) ? item : null;
  };
  const weeks = weekly.time.flatMap((date: unknown, index: number) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return [];
    const rainfall = value('precipitation_mean', index);
    return [{ date, temperatureAnomaly: value('temperature_2m_anomaly', index),
      rainfallMm: rainfall !== null && rainfall >= 0 ? rainfall : null,
      rainfallAnomaly: value('precipitation_anomaly', index) }];
  }).sort((a, b) => a.date.localeCompare(b.date));
  if (!weeks.some((week) => week.temperatureAnomaly !== null || week.rainfallMm !== null)) throw new Error('Long-range data unavailable');
  return { fetchedAt, weeks: weeks.filter((week, index) => index === 0 || week.date !== weeks[index - 1].date) };
}

export function readMonthlyOutlook(): MonthlyOutlookData | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!saved || typeof saved.fetchedAt !== 'number' || !Number.isFinite(saved.fetchedAt) || saved.fetchedAt < 0 || saved.fetchedAt > Date.now() + 60_000) return null;
    return parseMonthlyOutlook(saved.response, saved.fetchedAt);
  } catch { return null; }
}

export function fetchMonthlyOutlook(today: string, force = false): Promise<MonthlyOutlookData> {
  const cached = readMonthlyOutlook();
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_AGE && cached.weeks.filter((week) => week.date >= today).length >= 4) return Promise.resolve(cached);
  if (pending) return pending;
  pending = (async () => {
    const params = new URLSearchParams({ latitude: String(LOCATION.latitude), longitude: String(LOCATION.longitude),
      models: 'ecmwf_ec46', weekly: 'temperature_2m_anomaly,precipitation_mean,precipitation_anomaly',
      forecast_days: '35', timezone: 'Europe/London' });
    const response = await scheduledFetch(`https://seasonal-api.open-meteo.com/v1/seasonal?${params}`, { optional: true, timeout: 15_000 });
    if (!response.ok) throw new Error('Long-range data unavailable');
    const data: unknown = await response.json();
    const outlook = parseMonthlyOutlook(data);
    if (!outlook.weeks.some((week) => week.date >= today)) throw new Error('No upcoming long-range data');
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: outlook.fetchedAt, response: data })); } catch { /* Reading forecasts still works when storage is unavailable. */ }
    return outlook;
  })().finally(() => { pending = null; });
  return pending;
}
