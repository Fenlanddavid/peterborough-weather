import { FORECAST_VARIABLES, parseRun } from './runSource.ts';
import type { ModelUpdate } from './modelUpdates.ts';
import type { CachedRun } from '../types.ts';
import { HOUR } from '../data/contracts.ts';
import { finite, utc } from '../data/contracts.ts';
import { LOCATION } from '../config/models.ts';

export interface OperationalForecast { schema: 1; identity: string; firstSeenAt: number; checkedAt: number; runs: CachedRun[]; issueTime: null; metadata: ModelUpdate; requested: { latitude: number; longitude: number } }
export function operationalUrl(location: { latitude: number; longitude: number; elevation?: number }) {
  const params = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), models: 'ukmo_uk_deterministic_2km', hourly: FORECAST_VARIABLES.join(','), forecast_days: '3', timezone: 'UTC', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' });
  if (location.elevation !== undefined) params.set('elevation', String(location.elevation));
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
export async function parseOperational(raw: Record<string, any>, metadata: ModelUpdate, previous?: OperationalForecast, now = Date.now(), requested: { latitude: number; longitude: number } = LOCATION): Promise<OperationalForecast> {
  const reference = new Date(metadata.initialisedAt).toISOString().slice(0, 16);
  const records = parseRun(raw, 'ukmo_uk_deterministic_2km', reference, FORECAST_VARIABLES, now, metadata);
  if (!records.length) throw new RangeError('No latest UKV product');
  const content = JSON.stringify(records.map(r => ({ variable: r.variable, times: r.times, values: r.values, location: r.forecastLocation })));
  const identity = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const firstSeenAt = previous?.identity === identity ? previous.firstSeenAt : now;
  return { schema: 1, identity, firstSeenAt, checkedAt: now, issueTime: null, metadata, requested, runs: records.map(r => ({ ...r, product: 'latest-forecast', issueConfirmed: false, firstSeenAt })) };
}
const combined = new WeakMap<CachedRun[], WeakMap<OperationalForecast, CachedRun[]>>();
export function withOperational(runs: CachedRun[], operational: OperationalForecast | undefined, now: number, location: { latitude: number; longitude: number } = LOCATION): CachedRun[] {
  if (!operational || operational.schema !== 1 || !Array.isArray(operational.runs) || !operational.requested || Math.abs(location.latitude - operational.requested.latitude) > 0.001 || Math.abs(location.longitude - operational.requested.longitude) > 0.001 || !finite(operational.firstSeenAt) || !finite(operational.checkedAt) || now - operational.firstSeenAt > 6 * HOUR || now < operational.firstSeenAt || now - operational.checkedAt > 2 * HOUR || operational.runs.some(r => !r || r.modelId !== 'ukmo_uk_deterministic_2km' || r.product !== 'latest-forecast' || r.issueConfirmed !== false || !Array.isArray(r.times) || !Array.isArray(r.values) || r.times.length !== r.values.length || r.times.some(t => typeof t !== 'string' || !finite(utc(t))) || r.values.some(v => v !== null && !finite(v)))) return runs;
  let byProduct = combined.get(runs);
  if (!byProduct) { byProduct = new WeakMap(); combined.set(runs, byProduct); }
  let result = byProduct.get(operational);
  if (!result) { result = [...runs, ...operational.runs]; byProduct.set(operational, result); }
  return result;
}
