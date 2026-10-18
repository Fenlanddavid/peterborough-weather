import { openDB, type IDBPDatabase } from 'idb';
import type { CachedRun, EnsembleData } from '../types';
import { RUN_LOOKBACK_HOURS, MS_PER_HOUR } from '../config/models';

const DB_NAME = 'weather-trends';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('runs')) {
          const store = db.createObjectStore('runs', { keyPath: 'key' });
          store.createIndex('by-model', 'modelId');
          store.createIndex('by-fetchedAt', 'fetchedAt');
        }
        if (!db.objectStoreNames.contains('ensembles')) {
          db.createObjectStore('ensembles', { keyPath: ['modelId', 'variable'] });
        }
      },
    });
  }
  return dbPromise;
}

export async function getCachedRun(key: string): Promise<CachedRun | undefined> {
  const db = await getDb();
  return db.get('runs', key);
}

export async function putCachedRun(run: CachedRun): Promise<void> {
  const db = await getDb();
  await db.put('runs', run);
}

export async function getAllCachedRuns(): Promise<CachedRun[]> {
  const db = await getDb();
  return db.getAll('runs');
}

export async function pruneOldRuns(): Promise<void> {
  const db = await getDb();
  const cutoff = Date.now() - RUN_LOOKBACK_HOURS * MS_PER_HOUR;
  const all = await db.getAll('runs');
  const tx = db.transaction('runs', 'readwrite');
  for (const run of all) {
    if (new Date(run.runTime).getTime() < cutoff) {
      await tx.store.delete(run.key);
    }
  }
  await tx.done;
}

export async function putEnsemble(data: EnsembleData): Promise<void> {
  const db = await getDb();
  await db.put('ensembles', data);
}

export async function getEnsemble(modelId: string, variable: string): Promise<EnsembleData | undefined> {
  const db = await getDb();
  return db.get('ensembles', [modelId, variable]);
}

export async function getAllEnsembles(): Promise<EnsembleData[]> {
  const db = await getDb();
  return db.getAll('ensembles');
}
