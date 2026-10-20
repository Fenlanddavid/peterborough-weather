import { openDB, type IDBPDatabase } from 'idb';
import type { CachedRun } from '../types';
import { RUN_LOOKBACK_HOURS, MS_PER_HOUR } from '../config/models';

const DB_NAME = 'weather-trends';
const DB_VERSION = 3; // v2: wind units fixed (km/h → m/s); v3: unused ensemble store dropped

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // Wipe stale stores on version bump (v1 had wrong wind units)
        if (oldVersion < 2) {
          if (db.objectStoreNames.contains('runs')) db.deleteObjectStore('runs');
        }
        if (!db.objectStoreNames.contains('runs')) {
          const store = db.createObjectStore('runs', { keyPath: 'key' });
          store.createIndex('by-model', 'modelId');
          store.createIndex('by-fetchedAt', 'fetchedAt');
        }
        if (db.objectStoreNames.contains('ensembles')) db.deleteObjectStore('ensembles');
      },
    });
  }
  return dbPromise;
}

export async function putCachedRun(run: CachedRun): Promise<void> {
  const db = await getDb();
  await db.put('runs', run);
}

/** Store several records in one transaction (one model run = one record per variable). */
export async function putCachedRuns(runs: CachedRun[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction('runs', 'readwrite');
  await Promise.all([...runs.map((run) => tx.store.put(run)), tx.done]);
}

export async function getAllCachedRuns(): Promise<CachedRun[]> {
  const db = await getDb();
  return db.getAll('runs');
}

export async function pruneOldRuns(): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - RUN_LOOKBACK_HOURS * MS_PER_HOUR;
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
