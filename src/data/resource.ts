import { readStore, writeStore } from '../api/db.ts';
import type { SourceResult } from './contracts.ts';
import { HttpError } from './scheduler.ts';

const pending = new Map<string, Promise<SourceResult<unknown>>>();
const memory = new Map<string, SourceResult<unknown>>();
export async function cachedResource<T>(key: string): Promise<SourceResult<T> | null> {
  if (memory.has(key)) return memory.get(key) as SourceResult<T>;
  try { return await readStore<SourceResult<T>>('datasets', key); }
  catch (error) { console.warn(`Cache read ${key}:`, error); return null; }
}
export async function resource<T>(key: string, ttl: number, load: () => Promise<T>, force = false): Promise<SourceResult<T>> {
  const inflight = pending.get(key);
  if (inflight) {
    const result = await inflight as SourceResult<T>;
    return result.cancelled ? resource(key, ttl, load, force) : result;
  }
  const work = (async (): Promise<SourceResult<T>> => {
    const cached = await cachedResource<T>(key);
    if (!force && cached?.data && Date.now() - cached.checkedAt < ttl && !cached.error) return cached;
    let result: SourceResult<T>;
    try {
      const data = await load();
      const warnings = data as { warnings?: string[]; current?: { warnings?: string[] } };
      result = { data, status: (warnings?.warnings?.length || warnings?.current?.warnings?.length) ? 'partial' : 'ok', checkedAt: Date.now(), stale: false, error: null };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return { data: cached?.data ?? null, status: cached?.status ?? 'network-error', checkedAt: cached?.checkedAt ?? Date.now(), stale: cached?.stale ?? false, error: cached?.error ?? 'Refresh cancelled', cancelled: true };
      const status = error instanceof HttpError ? error.status === 429 ? 'rate-limited' : error.status === 400 ? 'unsupported' : 'http-error' : error instanceof SyntaxError || error instanceof RangeError ? 'invalid-data' : 'network-error';
      result = { data: cached?.data ?? null, status, checkedAt: Date.now(), stale: !!cached?.data, error: String(error) };
    }
    memory.set(key, result as SourceResult<unknown>);
    try { await writeStore('datasets', key, result); }
    catch (error) { result.storageError = String(error); console.warn(`Cache write ${key}:`, error); }
    return result;
  })().finally(() => pending.delete(key));
  pending.set(key, work as Promise<SourceResult<unknown>>);
  return work;
}
