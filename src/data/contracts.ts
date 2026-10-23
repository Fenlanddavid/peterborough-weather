export type Family = 'ECMWF' | 'NOAA' | 'UKMO';
export type SourceStatus = 'ok' | 'partial' | 'unsupported' | 'invalid-data' | 'http-error' | 'rate-limited' | 'network-error';
export interface Provenance {
  provider: string;
  modelId: string;
  family?: Family;
  issuedAt: number | null;
  fetchedAt: number;
  sourceTime: number | null;
  validFrom: number;
  validTo: number;
  units: Record<string, string>;
  coverage: string;
}
export interface SourceResult<T> {
  status: SourceStatus;
  data: T | null;
  checkedAt: number;
  error: string | null;
  /** The retained successful data may be older than the latest failed request. */
  stale: boolean;
  storageError?: string;
  cancelled?: boolean; // transient subscriber cancellation, never persisted as a source failure
}
export type PercentageBasis = 'ensemble-probability' | 'deterministic-agreement' | 'recent-run-support';
export interface EventEstimate {
  basis: PercentageBasis;
  value: number | null; // fraction 0–1, never a display percentage
  start: number;
  end: number;
  threshold: string;
  usable: number;
  expected: number;
  systems: string[];
  status: 'ok' | 'partial' | 'unavailable';
  expectedAmount: number | null;
  conditionalAmount: number | null;
  provenance: Provenance[];
  alignedWindows?: { modelId: string; start: number; end: number; shiftHours: number }[];
  components?: { family: Family; modelId: string; value: number }[];
  metOfficeProbability?: number;
  upperAmount?: number | null;
  nativeHours?: number;
}
export function provenanceOf(source: Provenance): Provenance {
  const { provider, modelId, family, issuedAt, fetchedAt, sourceTime, validFrom, validTo, units, coverage } = source;
  return { provider, modelId, family, issuedAt, fetchedAt, sourceTime, validFrom, validTo, units, coverage };
}
export const HOUR = 3600_000;
export const MPH_PER_MS = 2.23694; // Matches the existing LatestIndex conversion.
export const mphToMs = (mph: number) => mph / MPH_PER_MS;
export const msToMph = (ms: number) => ms * MPH_PER_MS;
/** Truncate event percentages so display rounding cannot cross an alert/score threshold. */
export function eventPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 1 + 1e-12) return 'unknown';
  if (value === 0) return '0%';
  if (value >= 1 - 1e-12) return '100%';
  return value < 0.01 ? '<1%' : `${Math.floor(value * 100 + 1e-9)}%`;
}
/** Use only for LatestIndex values, which are already converted to display mph. */
export function latestDisplayToCanonical(variable: string, value: number | null): number | null {
  return value === null ? null : /^wind_(speed|gusts)/.test(variable) ? mphToMs(value) : variable === 'cloud_cover' ? value / 100 : value;
}
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function utc(value: string): number {
  return Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`);
}
export const isoHour = (time: number) => new Date(time).toISOString().slice(0, 16);
export const localDate = (time: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
export function localInstant(date: string, hour: number): number {
  const noon = Date.parse(`${date}T12:00Z`);
  for (let t = noon - 14 * HOUR; t <= noon + 14 * HOUR; t += HOUR) {
    if (localDate(t) === date && Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(t)) === hour) return t;
  }
  throw new Error(`No local hour ${date} ${hour}`);
}
export function dayWindow(date: string): [number, number] { return [localInstant(date, 0), localInstant(addDays(date, 1), 0)]; }
export function frostWindow(date: string): [number, number] { return [localInstant(date, 18), localInstant(addDays(date, 1), 9)]; }
export const localTime = (time: number) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(time);
