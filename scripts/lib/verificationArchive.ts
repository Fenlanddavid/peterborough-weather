import { DETERMINISTIC_MODELS } from '../../src/config/models.ts';
import { finite, HOUR } from '../../src/data/contracts.ts';
import type { Station, VerificationForecast, VerificationResult } from '../../src/verification/verification.ts';

export const VERIFICATION_RETENTION_MS = 100 * 24 * HOUR;
export const VERIFICATION_REFRESH_MS = 20 * HOUR;
type Location = VerificationForecast['forecastLocation'];
export type ForecastRow = [modelId: string, validTimeSec: number, leadHours: number, celsius: number];
export interface ForecastArchiveV2 {
  version: 2;
  station: Station;
  locations: Record<string, Location>;
  rows: ForecastRow[];
  note: string;
}
export interface LegacyForecastArchive { station: Station; forecasts: VerificationForecast[]; version?: undefined }
export interface DailyVerification { date: string; modelId: string; leadHours: number; n: number; mae: number | null; bias: number | null }
export interface VerificationProduct {
  station: Station;
  collectedAt: number;
  results: VerificationResult[];
  daily?: DailyVerification[];
  evaluations?: { time: number; results: VerificationResult[] }[];
  [key: string]: unknown;
}
const models = new Map(DETERMINISTIC_MODELS.map(model => [model.id, model]));
const key = (row: ForecastRow) => `${row[0]}:${row[1]}:${row[2]}`;
const validLocation = (location: Location) => location && finite(location.latitude) && finite(location.longitude) && finite(location.elevation);

/** Keep raw Celsius values and ordering used by the existing evaluator. No fetch
 * timestamps or per-row copies of station/provider metadata enter the archive. */
export function compactForecasts(forecasts: VerificationForecast[], station: Station, now: number): ForecastArchiveV2 {
  const locations: Record<string, Location> = {};
  const rows = new Map<string, ForecastRow>();
  for (const forecast of forecasts) {
    if (forecast.variable !== 'temperature') continue;
    if (!models.has(forecast.modelId) || !validLocation(forecast.forecastLocation) || !finite(forecast.validTime) || !finite(forecast.value) || !finite(forecast.leadHours)) throw new RangeError('Invalid temperature archive row');
    if (forecast.unit !== '°C' || !forecast.measurementCompatible) throw new RangeError('Incompatible temperature archive units');
    if (forecast.validTime < now - VERIFICATION_RETENTION_MS) continue;
    locations[forecast.modelId] = forecast.forecastLocation;
    const row: ForecastRow = [forecast.modelId, forecast.validTime / 1000, forecast.leadHours, forecast.value];
    if (!rows.has(key(row))) rows.set(key(row), row);
  }
  return {
    version: 2, station, locations: Object.fromEntries(Object.entries(locations).sort(([a], [b]) => a.localeCompare(b))),
    rows: [...rows.values()].sort((a, b) => a[1] - b[1] || key(a).localeCompare(key(b))),
    note: 'Temperature in Celsius at fixed Previous Runs lead offsets; valid times in UTC seconds. Null model horizons excluded. Genuine issue times are not supplied.',
  };
}

/** Expand only in the collector, leaving evaluateVerification and its client
 * result schema unchanged. Fetch time is deliberately not recorded in v2. */
export function expandForecasts(archive: ForecastArchiveV2 | LegacyForecastArchive): VerificationForecast[] {
  if (!archive || !archive.station) throw new RangeError('Invalid verification forecast archive');
  if (archive.version === undefined) {
    if (!Array.isArray(archive.forecasts)) throw new RangeError('Invalid legacy forecast archive');
    return archive.forecasts.filter(forecast => forecast.variable === 'temperature');
  }
  if (archive.version !== 2 || !Array.isArray(archive.rows) || !archive.locations) throw new RangeError('Unknown verification archive version');
  return archive.rows.map(row => {
    if (!Array.isArray(row) || row.length !== 4) throw new RangeError('Invalid compact forecast row');
    const [modelId, seconds, leadHours, value] = row;
    const model = models.get(modelId);
    const forecastLocation = archive.locations[modelId];
    if (!model || !validLocation(forecastLocation) || !finite(seconds) || !finite(leadHours) || !finite(value)) throw new RangeError('Invalid compact forecast values');
    return { modelId, family: model.family, validTime: seconds * 1000, leadHours, variable: 'temperature', value,
      station: archive.station, forecastLocation, provider: 'Open-Meteo Previous Runs', issuedAt: null, sourceTime: null, fetchedAt: 0, unit: '°C', measurementCompatible: true };
  });
}

export function verificationIsRecent(product: VerificationProduct | null, now: number): boolean {
  return !!product && finite(product.collectedAt) && now >= product.collectedAt && now - product.collectedAt < VERIFICATION_REFRESH_MS;
}

/** Replace repeated hourly evaluations with the last score set for each UTC
 * collection date. These are daily snapshots of the unchanged rolling scores. */
export function compactResults(product: VerificationProduct, now: number): VerificationProduct {
  const { evaluations = [], daily = [], ...current } = product;
  const dates = new Map<string, DailyVerification[]>();
  const cutoff = new Date(now - VERIFICATION_RETENTION_MS).toISOString().slice(0, 10);
  for (const entry of daily) {
    if (entry.date < cutoff) continue;
    if (!dates.has(entry.date)) dates.set(entry.date, []);
    const entries = dates.get(entry.date)!;
    const index = entries.findIndex(row => row.modelId === entry.modelId && row.leadHours === entry.leadHours);
    if (index >= 0) entries[index] = entry; else entries.push(entry);
  }
  const snapshots = [...evaluations, { time: product.collectedAt, results: product.results }].sort((a, b) => a.time - b.time);
  for (const snapshot of snapshots) {
    if (!finite(snapshot.time) || !Array.isArray(snapshot.results)) throw new RangeError('Invalid verification result history');
    const date = new Date(snapshot.time).toISOString().slice(0, 10);
    if (date < cutoff) continue;
    dates.set(date, snapshot.results.filter(result => result.variable === 'temperature').map(result => ({ date, modelId: result.modelId, leadHours: result.leadHours, n: result.metrics.n, mae: result.metrics.mae, bias: result.metrics.bias })));
  }
  return { ...current, daily: [...dates].sort(([a], [b]) => a.localeCompare(b)).flatMap(([, rows]) => rows) };
}
