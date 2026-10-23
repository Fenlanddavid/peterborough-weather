import { DETERMINISTIC_MODELS } from '../config/models.ts';
import { HOUR, finite, utc } from '../data/contracts.ts';

export const PUBLICATION_BUFFER = 10 * 60_000;
export interface ModelUpdate { initialisedAt: number; availableAt: number; cadence: number; nativeHours: number; checkedAt: number }
export type ModelUpdates = Record<string, ModelUpdate>;
export function parseModelUpdate(raw: unknown, now = Date.now()): ModelUpdate {
  const m = raw as Record<string, number>;
  if (!m || ![m.last_run_initialisation_time, m.last_run_availability_time, m.update_interval_seconds, m.temporal_resolution_seconds].every(finite)) throw new RangeError('Invalid publication metadata');
  const result = { initialisedAt: m.last_run_initialisation_time * 1000, availableAt: m.last_run_availability_time * 1000, cadence: m.update_interval_seconds * 1000, nativeHours: m.temporal_resolution_seconds / 3600, checkedAt: now };
  if (result.initialisedAt % HOUR || result.initialisedAt > now || result.availableAt < result.initialisedAt || result.availableAt > now + PUBLICATION_BUFFER || result.cadence < HOUR || result.cadence > 24 * HOUR || result.nativeHours < 1 || result.nativeHours > 6) throw new RangeError('Unsupported publication metadata');
  return result;
}
export function expectedAge(modelId: string, update?: ModelUpdate): number {
  const cadence = update?.cadence ?? (modelId === 'ukmo_uk_deterministic_2km' ? HOUR : 6 * HOUR);
  // UKMO's open-data delay is upstream; a successful check never resets issue age.
  const delay = update ? update.availableAt - update.initialisedAt : modelId.startsWith('ukmo') ? 7 * HOUR : 6 * HOUR;
  return Math.min(24 * HOUR, Math.max(2 * HOUR, delay + 2 * cadence + PUBLICATION_BUFFER));
}
export const runIsStale = (modelId: string, runTime: number, now: number, update?: ModelUpdate) => now - runTime > expectedAge(modelId, update) || runTime > now + PUBLICATION_BUFFER;
export function latestRunCandidates(modelId: string, update: ModelUpdate | undefined, now: number): string[] {
  const model = DETERMINISTIC_MODELS.find(m => m.id === modelId);
  if (!model) return [];
  if (update && now - update.checkedAt < 2 * HOUR) {
    const latest = update.initialisedAt - (now < update.availableAt + PUBLICATION_BUFFER ? update.cadence : 0);
    // Metadata supplies the actual hourly UKV initialisation. Probe at most three
    // recent runs; the five-day comparison archive retains its six-hour sampling.
    const candidates = Array.from({ length: 3 }, (_, i) => new Date(latest - i * update.cadence).toISOString().slice(0, 16));
    // Single Runs can archive only the regular cycles even when the operational
    // product updates hourly. Keep its newest supported comparison cycle usable.
    for (let age = 0; age < 24; age++) {
      const time = latest - age * HOUR;
      if (model.runCycles.includes(new Date(time).getUTCHours())) { candidates.push(new Date(time).toISOString().slice(0, 16)); break; }
    }
    return [...new Set(candidates)];
  }
  const candidates: string[] = [];
  for (let age = 0; age < 24; age++) {
    const time = Math.floor(now / HOUR) * HOUR - age * HOUR;
    if (model.runCycles.includes(new Date(time).getUTCHours()) && now - time >= 6 * HOUR + PUBLICATION_BUFFER) candidates.push(new Date(time).toISOString().slice(0, 16));
  }
  return candidates.slice(0, 2);
}
export function nativeResolution(modelId: string, issue: number, valid: number, metadataHours = 1): number {
  const lead = (valid - issue) / HOUR;
  if (modelId === 'ukmo_global_deterministic_10km') return Math.max(metadataHours, lead > 144 ? 6 : lead > 54 ? 3 : 1);
  if (modelId.startsWith('ecmwf')) return Math.max(metadataHours, lead > 90 ? 3 : 1);
  return metadataHours;
}
export function updateForRun(modelId: string, runTime: string, updates: ModelUpdates): ModelUpdate | undefined {
  const update = updates[modelId];
  return update?.initialisedAt === utc(runTime) ? update : undefined;
}
