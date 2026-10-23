import type { VariableId } from './config/models.ts';

export interface OutlookWeek {
  date: string;
  temperatureAnomaly: number | null;
  rainfallMm: number | null;
  rainfallAnomaly: number | null;
}

export interface MonthlyOutlookData {
  fetchedAt: number;
  weeks: OutlookWeek[];
}

/** A single model run's forecast data for one variable */
export interface RunData {
  modelId: string;
  runTime: string;       // ISO string, e.g. "2026-10-17T00:00"
  variable: VariableId;
  times: string[];       // ISO strings for each forecast hour
  values: (number | null)[];
}

/** Keyed for IndexedDB storage */
export interface CachedRun {
  key: string;           // `${modelId}__${runTime}__${variable}`
  modelId: string;
  runTime: string;
  variable: VariableId;
  times: string[];
  values: (number | null)[];
  fetchedAt: number;     // Date.now() when cached
  availableAt?: number;  // Provider publication time, only when matched to this run
  checkedAt?: number;
  nativeHours?: number;
  forecastLocation?: { latitude: number; longitude: number; elevation: number };
  product?: 'latest-forecast';
  issueConfirmed?: false;
  firstSeenAt?: number;
  unitState?: 'unknown-legacy'; // v1 wind units were not trustworthy; keep records, exclude calculations.
}

/** A six-hour window aggregate */
export interface WindowValue {
  windowEnd: string; // ISO string, end of the 6h window
  value: number | null;
  complete: boolean; // false if any hour is missing
}

/** Metric results for display */
export interface ChangeMetric {
  change24h: number | null;
  change48h: number | null;
  changePrev: number | null;
}

export interface FlipFlopMetric {
  reversals: number;
  totalRuns: number;
}

export interface PersistenceMetric {
  count: number;
  total: number;
}
