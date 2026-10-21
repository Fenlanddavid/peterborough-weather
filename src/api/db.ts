import { openDB, type IDBPDatabase } from 'idb';
import type { CachedRun } from '../types.ts';
import { RUN_LOOKBACK_HOURS, MS_PER_HOUR } from '../config/models.ts';

const DB_NAME = 'weather-trends';
export const DB_VERSION = 4; // v4 is additive: never delete deterministic run history.

let dbPromise: Promise<IDBPDatabase> | null = null;
const volatileRuns = new Map<string, CachedRun>();
const unsavedRuns = new Map<string, CachedRun>();
let retryAfter = 0;
let lastDatabaseError: unknown = null;
let cacheWarning = false;
function cacheAvailability(available: boolean) {
  if (cacheWarning === !available) return;
  cacheWarning = !available;
  globalThis.dispatchEvent?.(new Event(available ? 'weather-cache-ready' : 'weather-cache-unavailable'));
}

export function getDb() {
  if (!dbPromise && lastDatabaseError && Date.now() < retryAfter) return Promise.reject(lastDatabaseError);
  if (!dbPromise) {
    let connection: IDBPDatabase | undefined;
    let timedOut = false;
    const opening = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Legacy v1 records are retained. New calculations validate their units separately.
        if (!db.objectStoreNames.contains('runs')) {
          const store = db.createObjectStore('runs', { keyPath: 'key' });
          store.createIndex('by-model', 'modelId');
          store.createIndex('by-fetchedAt', 'fetchedAt');
        }
        if (oldVersion < 4) {
          for (const name of ['ensembleSnapshots', 'datasets', 'httpCache']) {
            if (!db.objectStoreNames.contains(name)) {
              const store = db.createObjectStore(name);
              if (name === 'httpCache') store.createIndex('by-time', 'time');
            }
          }
        }
        if (oldVersion === 1) {
          void transaction.objectStore('runs').openCursor().then(async function mark(cursor): Promise<void> {
            if (!cursor) return;
            if (['wind_speed_10m', 'wind_gusts_10m'].includes(cursor.value.variable)) await cursor.update({ ...cursor.value, unitState: 'unknown-legacy' });
            return mark(await cursor.continue());
          });
        }
      },
      blocked() { globalThis.dispatchEvent?.(new Event('weather-db-blocked')); },
      blocking() { connection?.close(); dbPromise = null; },
      terminated() { dbPromise = null; },
    });
    void opening.then(db => { connection = db; retryAfter = 0; lastDatabaseError = null; globalThis.dispatchEvent?.(new Event('weather-db-ready')); if (timedOut) db.close(); }, () => undefined);
    // A tab holding an old connection must not prevent the forecast from rendering.
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('Weather database upgrade blocked; close other weather tabs to save data')); }, 5000); });
    dbPromise = Promise.race([opening, timeout]).finally(() => clearTimeout(timer));
    dbPromise.catch(error => { dbPromise = null; lastDatabaseError = error; retryAfter = Date.now() + 60_000; });
  }
  return dbPromise;
}

export async function readStore<T>(store: string, key: string): Promise<T | null> {
  return (await (await getDb()).get(store, key)) ?? null;
}
export async function writeStore<T>(store: string, key: string, value: T): Promise<void> {
  await (await getDb()).put(store, value, key);
}

export async function putCachedRun(run: CachedRun): Promise<void> {
  return putCachedRuns([run]);
}

/** Store several records in one transaction (one model run = one record per variable). */
export async function putCachedRuns(runs: CachedRun[]): Promise<void> {
  runs.forEach(run => volatileRuns.set(run.key, run));
  try {
    const db = await getDb();
    const tx = db.transaction('runs', 'readwrite');
    await Promise.all([...runs.map((run) => tx.store.put(run)), tx.done]);
    runs.forEach(run => unsavedRuns.delete(run.key));
    if (!unsavedRuns.size) cacheAvailability(true);
  } catch (error) { runs.forEach(run => unsavedRuns.set(run.key, run)); cacheAvailability(false); console.warn('Forecast cache unavailable; displaying unsaved data:', error); }
}

export async function getAllCachedRuns(): Promise<CachedRun[]> {
  try {
    const db = await getDb();
    if (unsavedRuns.size) {
      const tx = db.transaction('runs', 'readwrite');
      await Promise.all([...unsavedRuns.values()].map(run => tx.store.put(run)));
      await tx.done;
      unsavedRuns.clear();
      cacheAvailability(true);
    }
    const saved: CachedRun[] = await db.getAll('runs');
    saved.forEach(run => { if (!volatileRuns.has(run.key) || volatileRuns.get(run.key)!.fetchedAt < run.fetchedAt) volatileRuns.set(run.key, run); });
  } catch (error) { console.warn('Saved forecasts unavailable:', error); }
  return [...volatileRuns.values()];
}

export async function pruneOldRuns(): Promise<void> {
  const cutoff = Date.now() - RUN_LOOKBACK_HOURS * MS_PER_HOUR;
  for (const runs of [volatileRuns, unsavedRuns]) {
    for (const [key, run] of runs) if (Date.parse(`${run.runTime}Z`) < cutoff) runs.delete(key);
  }
  let db: IDBPDatabase;
  try { db = await getDb(); } catch (error) { console.warn('Run pruning deferred:', error); return; }
  // Keys are `${modelId}__${runTime}__${variable}`, so no need to load every forecast array.
  const keys = (await db.getAllKeys('runs')) as string[];
  const stale = keys.filter((key) => {
    const runTime = key.split('__')[1];
    return !runTime || Date.parse(`${runTime}Z`) < cutoff;
  });
  if (!stale.length) return;
  const tx = db.transaction('runs', 'readwrite');
  await Promise.all([...stale.map((key) => tx.store.delete(key)), tx.done]);
}
