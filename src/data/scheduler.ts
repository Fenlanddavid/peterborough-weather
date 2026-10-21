import { getDb, readStore, writeStore } from '../api/db.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export interface UsageEntry { time: number; weighted: number; http: number; endpoint: string }
export interface Usage { entries: UsageEntry[]; blockedUntil: number }
const KEY = 'pb-weather:api-usage:v1';
let fallback: Usage = { entries: [], blockedUntil: 0 };
const pending = new Map<string, Promise<Response>>();
let lastCachePrune = 0;
let persistenceFailed = false;
export function readUsage(now = Date.now()): Usage {
  try {
    if (typeof localStorage !== 'undefined' && !persistenceFailed) {
      const data = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      fallback = Array.isArray(data?.entries) ? { entries: data.entries.filter((e: UsageEntry) => e && Number.isFinite(e.time) && Number.isFinite(e.weighted) && e.weighted >= 0 && Number.isFinite(e.http) && e.http >= 0 && typeof e.endpoint === 'string'), blockedUntil: Number.isFinite(data.blockedUntil) ? data.blockedUntil : 0 } : { entries: [], blockedUntil: 0 };
    }
  }
  catch (error) { console.warn('API usage storage unavailable:', error); }
  const recent: UsageEntry[] = [];
  const days = new Map<string, UsageEntry>();
  for (const entry of fallback.entries) {
    if (entry.time <= now - 32 * 86400_000) continue;
    if (entry.time > now - 60_000) recent.push(entry);
    else {
      const date = new Date(entry.time).toISOString().slice(0, 10);
      const key = `${date}:${entry.endpoint}`;
      const previous = days.get(key);
      if (previous) { previous.http += entry.http; previous.weighted += entry.weighted; }
      else days.set(key, { ...entry, time: Date.parse(`${date}T00:00Z`) });
    }
  }
  return { entries: [...days.values(), ...recent], blockedUntil: fallback.blockedUntil };
}
export function usageToday(now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  return readUsage(now).entries.filter(e => new Date(e.time).toISOString().startsWith(day)).reduce((a, e) => ({ weighted: a.weighted + e.weighted, http: a.http + e.http }), { weighted: 0, http: 0 });
}
export function estimatedCost(input: string): number {
  const url = new URL(input);
  const p = url.searchParams;
  if (/^\/data\/[^/]+\/static\/meta\.json$/.test(url.pathname)) return 0; // Documented metadata exemption; HTTP count remains recorded.
  const count = ['hourly', 'daily', 'weekly', 'monthly', 'minutely_15', 'current'].reduce((sum, key) => sum + (p.get(key)?.split(',').filter(Boolean).length ?? 0), 0);
  const days = Number(p.get('forecast_days') ?? 7) + Number(p.get('past_days') ?? 0);
  const models = p.get('models')?.split(',') ?? ['best_match'];
  // Conservative reservation for uncertain endpoint multipliers; never equate HTTP count with usage.
  const members = url.hostname.startsWith('ensemble-') ? models.reduce((sum, m) => sum + ({ ecmwf_ifs025: 51, gfs025: 31, ukmo_global_ensemble_20km: 18 }[m] ?? 64), 0) : models.length;
  // Server commit 7a0724b: member count multiplies variables before the /10 factor.
  // Seasonal weekly/monthly variables are non-ensemble and the server divides by 120.
  const adjustedVariables = url.hostname.startsWith('seasonal-') ? Math.floor(count * models.length / 120) : count * members;
  return Math.ceil(Math.max(1, adjustedVariables / 10 * Math.max(1, days / 14)));
}
export function budgetDecision(usage: Usage, cost: number, optional: boolean, now: number): string | null {
  const day = new Date(now).toISOString().slice(0, 10);
  const today = usage.entries.filter(e => new Date(e.time).toISOString().startsWith(day)).reduce((s, e) => s + e.weighted, 0);
  if (now < usage.blockedUntil) return 'Provider backoff active; serving cached data';
  if (today + cost > 2000) return 'Daily local API limit (2,000 weighted calls); serving cached data';
  if (optional && today + cost > 1500) return 'Optional requests deferred to reserve core forecast allowance';
  if (usage.entries.filter(e => e.time > now - 60_000).reduce((s, e) => s + Math.max(e.weighted, e.http), 0) + Math.max(cost, 1) > 300) return 'Rolling minute budget reached; try again shortly';
  return null;
}
async function lock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, work);
  return work();
}
function saveUsage(usage: Usage) {
  fallback = usage;
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(usage)); }
  catch (error) { persistenceFailed = true; console.warn('API meter persistence failed; using this tab’s memory:', error); }
}
const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(signal?.reason); };
  signal?.addEventListener('abort', abort, { once: true });
});
interface Options { optional?: boolean; signal?: AbortSignal; timeout?: number; retries?: number }
export async function scheduledFetch(url: string, options: Options = {}): Promise<Response> {
  const isMeteo = /(^|\.)open-meteo\.com$/.test(new URL(url).hostname);
  const key = `${options.optional ? 'optional' : 'core'}:${url}`;
  if (pending.has(key)) return (await pending.get(key)!).clone();
  const work = lock(`pb-weather:request:${url}`, async () => {
    // Web Locks + shared short response cache coalesce overlapping requests in other tabs.
    if (typeof indexedDB !== 'undefined') {
      try {
        const saved = await readStore<{ time: number; body: string; headers: [string, string][] }>('httpCache', url);
        if (saved && Date.now() - saved.time < 30_000) return new Response(saved.body, { headers: saved.headers });
      } catch (error) { console.warn('Cross-tab request cache:', error); }
    }
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      if (isMeteo) await lock('pb-weather:budget', async () => {
        const now = Date.now();
        const usage = readUsage(now);
        const cost = estimatedCost(url);
        const reason = budgetDecision(usage, cost, options.optional ?? false, now);
        if (reason) throw new HttpError(429, reason);
        usage.entries.push({ time: now, weighted: cost, http: 1, endpoint: new URL(url).hostname });
        saveUsage(usage);
      });
      const timeout = AbortSignal.timeout(options.timeout ?? 20_000);
      const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
      const response = await fetch(url, { signal });
      if ((response.status === 429 || response.status >= 500) && attempt < (options.retries ?? 1)) {
        const header = response.headers.get('Retry-After');
        const suppliedWait = header ? /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now() : NaN;
        const wait = Math.max(response.status === 429 ? 2000 : 0, Number.isFinite(suppliedWait) ? Math.max(0, suppliedWait) : 2000 * 2 ** attempt);
        if (isMeteo && response.status === 429) await lock('pb-weather:budget', async () => {
          const usage = readUsage(); usage.blockedUntil = Date.now() + Math.max(2000, wait); saveUsage(usage);
        });
        if (wait > 30_000) throw new HttpError(response.status, `HTTP ${response.status}; provider backoff ${wait / 1000}s`);
        await delay(wait + 20, options.signal);
        continue;
      }
      if (!response.ok) throw new HttpError(response.status, `HTTP ${response.status} from ${new URL(url).hostname}`);
      if (typeof indexedDB !== 'undefined') {
        try {
          await writeStore('httpCache', url, { time: Date.now(), body: await response.clone().text(), headers: [...response.headers] });
          if (Date.now() - lastCachePrune > 60_000) {
            lastCachePrune = Date.now();
            const db = await getDb();
            if (db.transaction('httpCache').store.indexNames.contains('by-time')) {
              const keys = await db.getAllKeysFromIndex('httpCache', 'by-time', IDBKeyRange.upperBound(Date.now() - 120_000));
              const tx = db.transaction('httpCache', 'readwrite');
              await Promise.all([...keys.map(key => tx.store.delete(key)), tx.done]);
            }
          }
        }
        catch (error) { console.warn('Cross-tab response cache write:', error); }
      }
      return response;
    }
  }).finally(() => pending.delete(key));
  pending.set(key, work);
  return (await work).clone();
}
