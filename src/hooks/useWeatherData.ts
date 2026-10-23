import { useState, useEffect, useCallback, useRef } from 'react';
import type { CachedRun } from '../types';
import { fetchAllDeterministicRuns } from '../api/fetch';
import { getAllCachedRuns, putCachedRuns } from '../api/db';
import { validateForecastProduct, validatePolicyProduct } from '../forecast/product';
import { validateMetOffice } from '../forecast/metOffice';
import { validatePolicy } from '../forecast/policy';
import type { ForecastContext } from '../forecast/signals';

interface WeatherDataState {
  runs: CachedRun[];
  loading: boolean;
  progress: { done: number; total: number; phase: string } | null;
  /** When Open-Meteo was last reached successfully (not merely when the page loaded). */
  lastUpdated: number | null;
  error: string | null;
  context: ForecastContext;
  sourceNotes: string[];
}

const CHECKED_KEY = 'pb-weather:last-checked';
/** Re-check automatically when the app comes back to the foreground after this long. */
const AUTO_REFRESH_MS = 15 * 60_000;
const POLICY_KEY = 'pb-weather:last-good-policy:v1';

function readLastChecked(): number | null {
  try {
    const value = Number(localStorage.getItem(CHECKED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

export function useWeatherData() {
  const [state, setState] = useState<WeatherDataState>({
    runs: [],
    loading: true,
    progress: null,
    lastUpdated: readLastChecked(),
    error: null,
    context: {}, sourceNotes: [],
  });
  const inFlight = useRef(false);
  const lastChecked = useRef<number | null>(readLastChecked());
  const contextRef = useRef<ForecastContext>({});

  const loadData = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Show saved data straight away
      const cachedRuns = await getAllCachedRuns();
      if (cachedRuns.length > 0) {
        setState((s) => ({
          ...s,
          runs: cachedRuns,
          lastUpdated: lastChecked.current ?? Math.max(...cachedRuns.map((r) => r.fetchedAt)),
        }));
      }

      const notes: string[] = [];
      const context: ForecastContext = { ...contextRef.current };
      try { if (!context.policy) context.policy = validatePolicy(JSON.parse(localStorage.getItem(POLICY_KEY) ?? 'null')); } catch { delete context.policy; }
      const get = async (path: string) => {
        const response = await fetch(`${import.meta.env.BASE_URL}data/${path}`, { cache: 'no-cache', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      };
      await Promise.all([
        (async () => { try { const p = validateForecastProduct(await get('forecast/latest.json')); await putCachedRuns(p.runs); context.updates = p.updates; context.operational = p.operational; } catch { notes.push('Shared forecast cache unavailable; direct model forecasts remain available.'); } })(),
        (async () => { try { const p = validatePolicyProduct(await get('forecast/policy.json')); context.policy = p.policy ?? undefined; try { if (p.policy) localStorage.setItem(POLICY_KEY, JSON.stringify(p.policy)); else localStorage.removeItem(POLICY_KEY); } catch { /* in-memory policy remains usable */ } } catch { notes.push('Using the last valid policy or conservative defaults.'); } })(),
        (async () => { try { context.metOffice = validateMetOffice(await get('forecast/metoffice.json')); } catch { notes.push('Met Office refresh unavailable; only a retained compatible product within its freshness limit can contribute.'); } })(),
      ]);
      contextRef.current = context;
      const readyRuns = await getAllCachedRuns();
      setState(s => ({ ...s, runs: readyRuns, context, sourceNotes: notes }));

      const summary = await fetchAllDeterministicRuns(readyRuns, (done, total) => {
        setState((s) => ({ ...s, progress: { done, total, phase: 'Backfilling model comparisons' } }));
      }, async (updates, operational) => {
        if (operational) context.operational = operational;
        context.updates = { ...context.updates, ...updates };
        contextRef.current = context;
        const latestRuns = await getAllCachedRuns();
        setState(s => ({ ...s, runs: latestRuns, context: { ...context } }));
      });

      const reachedServer = summary.ok + summary.unavailable > 0 || Object.keys(summary.updates).length > 0;
      if (reachedServer) {
        lastChecked.current = Date.now();
        try { localStorage.setItem(CHECKED_KEY, String(lastChecked.current)); } catch { /* not critical */ }
      }

      const allRuns = summary.ok > 0 ? await getAllCachedRuns() : readyRuns;
      const error = null;

      setState((s) => ({
        runs: allRuns,
        loading: false,
        progress: null,
        lastUpdated: lastChecked.current ?? s.lastUpdated,
        error,
        context: { ...context }, sourceNotes: notes,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        progress: null,
        error: err instanceof Error ? err.message : 'Failed to load data',
      }));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // Leftovers from the retired wttr.in reference blend.
    try { localStorage.removeItem('pw_reference_forecast'); localStorage.removeItem('pw_reference_forecast:v2'); } catch { /* not critical */ }
    loadData();
    // A home-screen PWA can sit in the background for hours; catch up when it's reopened.
    const onVisible = () => {
      if (document.hidden) return;
      if (lastChecked.current === null || Date.now() - lastChecked.current > AUTO_REFRESH_MS) loadData();
    };
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const updates = Object.values(contextRef.current.updates ?? {});
      const due = updates.length ? Math.min(...updates.map(u => u.availableAt + u.cadence + 10 * 60_000)) : Date.now() + AUTO_REFRESH_MS;
      timer = setTimeout(() => { onVisible(); schedule(); }, Math.max(AUTO_REFRESH_MS, due - Date.now()));
    };
    const visible = () => { onVisible(); schedule(); };
    document.addEventListener('visibilitychange', visible);
    schedule();
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', visible); };
  }, [loadData]);

  return { ...state, refresh: loadData };
}
