import { ENSEMBLE_VARIABLES } from '../data/probes.ts';
import { finite, HOUR, utc } from '../data/contracts.ts';
import type { Provenance, Family, SourceResult } from '../data/contracts.ts';
import { cachedResource, resource } from '../data/resource.ts';
import { scheduledFetch } from '../data/scheduler.ts';
import { readStore, writeStore } from '../api/db.ts';

export const ENSEMBLE_MODELS: { id: string; label: string; family: Family; expected: number; nativeHours: number }[] = [
  { id: 'ecmwf_ifs025', label: 'IFS', family: 'ECMWF', expected: 51, nativeHours: 3 },
  { id: 'gfs025', label: 'GEFS', family: 'NOAA', expected: 31, nativeHours: 3 },
  { id: 'ukmo_global_ensemble_20km', label: 'MOGREPS-G', family: 'UKMO', expected: 18, nativeHours: 1 },
];
export type EnsembleVariable = typeof ENSEMBLE_VARIABLES[number];
export interface EnsembleSnapshot extends Provenance {
  identity: string; // content hash when genuine model issue metadata is unavailable
  expected: number;
  times: number[];
  members: Partial<Record<EnsembleVariable, Record<string, (number | null)[]>>>;
  nativeHours: number;
  warnings: string[];
  firstSeenAt?: number;
  providerUpdate?: { initialisedAt: number; availableAt: number; temporalResolutionSeconds: number };
}
export interface SnapshotPair { current: EnsembleSnapshot; previous: EnsembleSnapshot | null }
const units: Record<EnsembleVariable, string> = { temperature_2m: '°C', precipitation: 'mm', snowfall: 'cm', wind_gusts_10m: 'm/s', cloud_cover: '%' };
export function parseEnsemble(raw: unknown, modelId: string, fetchedAt = Date.now()): Omit<EnsembleSnapshot, 'identity'> {
  const model = ENSEMBLE_MODELS.find(m => m.id === modelId);
  if (!model) throw new RangeError(`Unconfirmed ensemble model ${modelId}`);
  const data = raw as { hourly?: Record<string, unknown>; hourly_units?: Record<string, string>; utc_offset_seconds?: number };
  const hourly = data?.hourly;
  if (!hourly || !Array.isArray(hourly.time) || hourly.time.length === 0 || data.utc_offset_seconds !== 0) throw new RangeError('Invalid UTC ensemble time axis');
  const times = hourly.time.map(t => typeof t === 'string' ? utc(t) : NaN);
  if (times.some((t, i) => !finite(t) || (i > 0 && t - times[i - 1] !== HOUR))) throw new RangeError('Ensemble times must be distinct consecutive UTC hours');
  const members: EnsembleSnapshot['members'] = {};
  const warnings: string[] = [];
  for (const variable of ENSEMBLE_VARIABLES) {
    const collection: Record<string, (number | null)[]> = {};
    const originals = new Map<string, string>();
    for (const [key, array] of Object.entries(hourly)) {
      const match = new RegExp(`^${variable}(?:_member(\\d+))?$`).exec(key);
      if (!match) continue;
      const id = String(Number(match[1] ?? '0'));
      if (Number(id) >= model.expected) throw new RangeError(`Unexpected member ${key}`);
      if (!Array.isArray(array) || array.length !== times.length || array.some(v => v !== null && !finite(v))) throw new RangeError(`Invalid member values ${key}`);
      if (originals.has(id) && originals.get(id) !== JSON.stringify(array)) throw new RangeError(`Conflicting control/member alias ${key}`);
      originals.set(id, JSON.stringify(array));
      if (data.hourly_units?.[key] !== units[variable]) throw new RangeError(`Wrong units for ${key}: ${data.hourly_units?.[key]}`);
      const invalid = (v: number | null) => v !== null && (variable === 'cloud_cover' ? v < 0 || v > 100 : variable !== 'temperature_2m' && v < 0);
      // Real IFS fixtures contain negative interpolated precipitation. Exclude the invalid
      // cell as unknown (never clamp to dry) without discarding other variables/members.
      if (array.some(invalid)) warnings.push(`${key}: out-of-range cells excluded as unknown`);
      const values = array.map(v => v === null || invalid(v) ? null : variable === 'cloud_cover' ? v / 100 : v);
      if (collection[id] && JSON.stringify(collection[id]) !== JSON.stringify(values)) throw new RangeError(`Conflicting control/member alias ${key}`);
      collection[id] = values;
    }
    const count = Object.keys(collection).length;
    if (count === 1) throw new RangeError(`${variable}: deterministic-only response is not an ensemble`);
    if (count) {
      members[variable] = collection;
      if (count < model.expected) warnings.push(`${variable}: ${count}/${model.expected} member columns`);
    } else warnings.push(`${variable}: unsupported or absent`);
  }
  if (!Object.keys(members).length) throw new RangeError('No ensemble members');
  return { provider: 'Open-Meteo Ensemble', modelId, family: model.family, issuedAt: null, sourceTime: null, fetchedAt,
    validFrom: times[0], validTo: times.at(-1)! + HOUR, units: { ...units, cloud_cover: 'fraction' }, coverage: 'Hourly API output; IFS/GEFS resampled from 3-hour native output', times, members, expected: model.expected, nativeHours: model.nativeHours, warnings };
}
export function rotateSnapshot(saved: SnapshotPair | null, incoming: EnsembleSnapshot): SnapshotPair {
  // Same contents do not create a new forecast or displace the previous distinct snapshot.
  return saved?.current.identity === incoming.identity ? { ...saved, current: { ...incoming, firstSeenAt: saved.current.firstSeenAt ?? saved.current.fetchedAt } }
    : { current: incoming, previous: saved?.current ?? null };
}
export async function fetchEnsemble(modelId: string, force = false, signal?: AbortSignal): Promise<SourceResult<SnapshotPair>> {
  const lastCheck = await cachedResource<SnapshotPair>(`ensemble:${modelId}`);
  if (!force && lastCheck && Date.now() - lastCheck.checkedAt < 3 * HOUR) return lastCheck;
  return resource(`ensemble:${modelId}`, 3 * HOUR, async () => {
    let saved: SnapshotPair | null = null;
    try { saved = await readStore('ensembleSnapshots', modelId); } catch (error) { console.warn('Snapshot read:', error); }
    if (!saved) saved = (await cachedResource<SnapshotPair>(`ensemble:${modelId}`))?.data ?? null;
    const metadataId = ({ ecmwf_ifs025: 'ecmwf_ifs025_ensemble', gfs025: 'ncep_gefs025', ukmo_global_ensemble_20km: 'ukmo_global_ensemble_20km' } as Record<string, string>)[modelId];
    let providerUpdate: EnsembleSnapshot['providerUpdate'];
    try {
      const meta = await (await scheduledFetch(`https://api.open-meteo.com/data/${metadataId}/static/meta.json`, { signal })).json();
      if (!finite(meta.last_run_initialisation_time) || !finite(meta.last_run_availability_time) || !finite(meta.temporal_resolution_seconds)) throw new RangeError('Invalid model metadata');
      providerUpdate = { initialisedAt: meta.last_run_initialisation_time * 1000, availableAt: meta.last_run_availability_time * 1000, temporalResolutionSeconds: meta.temporal_resolution_seconds };
      if (saved?.current.providerUpdate?.initialisedAt === providerUpdate.initialisedAt && Date.now() - providerUpdate.availableAt >= 10 * 60_000) return saved;
    } catch (error) { if (signal?.aborted) throw error; console.warn('Ensemble update metadata unavailable; content hash fallback:', error); }
    const params = new URLSearchParams({ latitude: '52.5736', longitude: '-0.2400', models: modelId, hourly: ENSEMBLE_VARIABLES.join(','), forecast_days: '9', timezone: 'GMT', wind_speed_unit: 'ms', temperature_unit: 'celsius', precipitation_unit: 'mm' });
    const response = await scheduledFetch(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`, { signal });
    const parsed = parseEnsemble(await response.json(), modelId);
    const hashInput = JSON.stringify({ times: parsed.times, members: parsed.members });
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashInput)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const incoming: EnsembleSnapshot = { ...parsed, identity: hash, firstSeenAt: parsed.fetchedAt, providerUpdate };
    const pair = rotateSnapshot(saved, incoming);
    try { await writeStore('ensembleSnapshots', modelId, pair); } catch (error) { console.warn('Snapshot write:', error); }
    return pair;
  }, force);
}
