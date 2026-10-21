/** Seasonal SEAS5 monthly outlook and EC46 weekly comparison from Open-Meteo. */

import { LOCATION } from '../config/models.ts';
import { scheduledFetch } from '../data/scheduler.ts';

const CACHE_KEY = 'pb-weather:seasonal:v2';
const CACHE_TTL = 6 * 3600_000; // 6 hours

export interface SeasonalModelConfig {
  id: string;
  label: string;
  agency: string;
  colour: string;
  hasEnsemble: boolean;
}

export const SEASONAL_MODELS: SeasonalModelConfig[] = [
  { id: 'ecmwf_seas5', label: 'ECMWF SEAS5', agency: 'ECMWF', colour: '#c8c2ec', hasEnsemble: true },
  { id: 'ecmwf_ec46', label: 'ECMWF EC46', agency: 'ECMWF', colour: '#85c9c1', hasEnsemble: true },

];

export interface SeasonalWeek {
  date: string; // ISO week start
  tempAnomaly: number | null;
  precipMm: number | null;
  precipAnomaly: number | null;
}

export interface SeasonalModelData {
  modelId: string;
  weeks: SeasonalWeek[];
}

export interface SeasonalMonth {
  /** YYYY-MM */
  month: string;
  label: string;
  /** Temperature anomaly per model (modelId → °C) */
  tempAnomalies: Map<string, number>;
  /** Rainfall anomaly per model (modelId → mm/week) */
  precipAnomalies: Map<string, number>;
  /** Mean weekly rainfall per model (modelId → mm/week) */
  precipTotals: Map<string, number>;
  /** Multi-model mean temp anomaly */
  tempMean: number | null;
  /** Multi-model mean precip anomaly */
  precipMean: number | null;
  /** Model agreement on temperature direction */
  tempAgreement: 'strong' | 'moderate' | 'weak' | 'none';
  /** Model agreement on precip direction */
  precipAgreement: 'strong' | 'moderate' | 'weak' | 'none';
}

export interface SeasonalData {
  models: SeasonalModelData[];
  months: SeasonalMonth[];
  fetchedAt: number;
}

/** Fetch weekly seasonal data for one model */
async function fetchModel(modelId: string): Promise<SeasonalModelData | null> {
  const monthly = modelId === 'ecmwf_seas5';
  const params = new URLSearchParams({
    latitude: String(LOCATION.latitude),
    longitude: String(LOCATION.longitude),
    models: modelId,
    [monthly ? 'monthly' : 'weekly']: 'temperature_2m_anomaly,precipitation_mean,precipitation_anomaly',
    forecast_days: monthly ? '210' : '46',
    timezone: 'Europe/London',
  });
  try {
    const res = await scheduledFetch(`https://seasonal-api.open-meteo.com/v1/seasonal?${params}`, { optional: true, timeout: 15_000 });
    if (!res.ok) return null;
    const data = await res.json();
    const weekly = data?.[monthly ? 'monthly' : 'weekly'];
    if (!weekly || !Array.isArray(weekly.time)) return null;

    const weeks: SeasonalWeek[] = [];
    for (let i = 0; i < weekly.time.length; i++) {
      const date = weekly.time[i];
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) continue;
      const tempAnomaly = safeNum(weekly.temperature_2m_anomaly?.[i]);
      // Present both systems on a common mm/week scale. SEAS5 supplies monthly totals.
      const days = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
      const scale = monthly ? 7 / days : 1;
      const rainfall = safeNum(weekly.precipitation_mean?.[i]);
      const anomaly = safeNum(weekly.precipitation_anomaly?.[i]);
      const precipMm = rainfall === null ? null : rainfall * scale;
      const precipAnomaly = anomaly === null ? null : anomaly * scale;
      if (tempAnomaly === null && precipMm === null && precipAnomaly === null) continue;
      weeks.push({ date, tempAnomaly, precipMm, precipAnomaly });
    }

    return weeks.length ? { modelId, weeks } : null;
  } catch {
    return null;
  }
}

function safeNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Aggregate weekly data into monthly buckets and compute multi-model stats */
function aggregateMonths(models: SeasonalModelData[], today: string): SeasonalMonth[] {
  // Collect all unique months across all models
  const monthMap = new Map<string, Map<string, { temps: number[]; precips: number[]; precipTotals: number[] }>>();

  for (const model of models) {
    for (const week of model.weeks) {
      if (model.modelId === 'ecmwf_seas5' ? week.date.slice(0, 7) < today.slice(0, 7) : week.date < today) continue;
      const ym = week.date.slice(0, 7); // YYYY-MM
      if (!monthMap.has(ym)) monthMap.set(ym, new Map());
      const modelMap = monthMap.get(ym)!;
      if (!modelMap.has(model.modelId)) modelMap.set(model.modelId, { temps: [], precips: [], precipTotals: [] });
      const bucket = modelMap.get(model.modelId)!;
      if (week.tempAnomaly !== null) bucket.temps.push(week.tempAnomaly);
      if (week.precipAnomaly !== null) bucket.precips.push(week.precipAnomaly);
      if (week.precipMm !== null) bucket.precipTotals.push(week.precipMm);
    }
  }

  const months: SeasonalMonth[] = [];
  const sortedKeys = [...monthMap.keys()].sort();

  for (const ym of sortedKeys) {
    const modelData = monthMap.get(ym)!;
    const tempAnomalies = new Map<string, number>();
    const precipAnomalies = new Map<string, number>();
    const precipTotals = new Map<string, number>();

    for (const [modelId, bucket] of modelData) {
      if (bucket.temps.length > 0) {
        tempAnomalies.set(modelId, avg(bucket.temps));
      }
      if (bucket.precips.length > 0) {
        precipAnomalies.set(modelId, avg(bucket.precips));
      }
      if (bucket.precipTotals.length > 0) {
        precipTotals.set(modelId, avg(bucket.precipTotals));
      }
    }

    const tempValues = [...tempAnomalies.values()];
    const precipValues = [...precipAnomalies.values()];

    const date = new Date(`${ym}-15T12:00:00Z`);
    const label = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });

    months.push({
      month: ym,
      label,
      tempAnomalies,
      precipAnomalies,
      precipTotals,
      tempMean: tempValues.length > 0 ? avg(tempValues) : null,
      precipMean: precipValues.length > 0 ? avg(precipValues) : null,
      tempAgreement: calcAgreement(tempValues),
      precipAgreement: calcAgreement(precipValues),
    });
  }

  return months;
}

function avg(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** How many models agree on the sign of the anomaly? */
function calcAgreement(values: number[]): 'strong' | 'moderate' | 'weak' | 'none' {
  if (values.length < 2) return 'none';
  const positive = values.filter((v) => v > 0.1).length;
  const negative = values.filter((v) => v < -0.1).length;
  const total = values.length;
  const dominant = Math.max(positive, negative);
  const ratio = dominant / total;
  if (ratio >= 0.8) return 'strong';
  if (ratio >= 0.6) return 'moderate';
  if (ratio >= 0.4) return 'weak';
  return 'none';
}

/** Fetch all seasonal models and aggregate */
export async function fetchSeasonalData(today: string, force = false): Promise<SeasonalData> {
  // Check cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!force && cached) {
      const parsed = JSON.parse(cached) as { fetchedAt: number; raw: SeasonalModelData[] };
      if (Array.isArray(parsed.raw) && Date.now() - parsed.fetchedAt < CACHE_TTL) {
        const months = aggregateMonths(parsed.raw, today);
        return { models: parsed.raw, months, fetchedAt: parsed.fetchedAt };
      }
    }
  } catch { /* corrupt cache */ }

  // Fetch all models in parallel
  const results = await Promise.allSettled(
    SEASONAL_MODELS.map((m) => fetchModel(m.id))
  );

  const models: SeasonalModelData[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) models.push(r.value);
  }

  if (models.length === 0) throw new Error('No seasonal data available');

  const months = aggregateMonths(models, today);
  if (!months.length) throw new Error('No upcoming seasonal data');
  const fetchedAt = Date.now();

  // Cache the raw model data
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, raw: models }));
  } catch { /* storage full */ }

  return { models, months, fetchedAt };
}

/** Human-readable temperature anomaly */
export function tempSignal(anomaly: number | null): string {
  if (anomaly === null) return 'Uncertain';
  if (anomaly >= 1.5) return 'Much warmer';
  if (anomaly >= 0.5) return 'Warmer';
  if (anomaly <= -1.5) return 'Much cooler';
  if (anomaly <= -0.5) return 'Cooler';
  return 'Near average';
}

/** Human-readable precipitation anomaly */
export function precipSignal(anomaly: number | null): string {
  if (anomaly === null) return 'Uncertain';
  if (anomaly >= 5) return 'Much wetter';
  if (anomaly >= 1) return 'Wetter';
  if (anomaly <= -5) return 'Much drier';
  if (anomaly <= -1) return 'Drier';
  return 'Near average';
}
