import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { getDb, getAllCachedRuns, DB_VERSION } from '../src/api/db.ts';

test('version 3 migration preserves run history and legacy stores, signals blocked upgrades and closes on a later versionchange', async () => {
  const old = await openDB('weather-trends', 3, { upgrade(db) { db.createObjectStore('runs', { keyPath: 'key' }); db.createObjectStore('ensembles'); } });
  const run = { key: 'retained', modelId: 'gfs_global', runTime: '2026-10-21T00:00', fetchedAt: 1, variable: 'temperature_2m', times: ['2026-10-21T12:00'], values: [9] };
  await old.put('runs', run); await old.put('ensembles', { legacy: true }, 'old');
  let blocked = false;
  Object.defineProperty(globalThis, 'dispatchEvent', { configurable: true, value: (event: Event) => { if (event.type === 'weather-db-blocked') blocked = true; return true; } });
  const opening = getDb();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(blocked, true); old.close();
  const db = await opening;
  assert.equal(db.version, DB_VERSION); assert.deepEqual(await db.get('runs', 'retained'), run); assert.deepEqual(await db.get('ensembles', 'old'), { legacy: true });
  for (const store of ['runs', 'ensembleSnapshots', 'datasets', 'httpCache']) assert.ok(db.objectStoreNames.contains(store));
  assert.deepEqual(await getAllCachedRuns(), [run]);
  const later = await openDB('weather-trends', 5);
  assert.equal(later.version, 5); later.close();
});
