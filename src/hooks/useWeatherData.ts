import { useState, useEffect, useCallback, useRef } from 'react';
import type { CachedRun } from '../types';
import { fetchAllDeterministicRuns } from '../api/fetch';
import { getAllCachedRuns } from '../api/db';

interface WeatherDataState {
  runs: CachedRun[];
  loading: boolean;
  progress: { done: number; total: number; phase: string } | null;
  /** When Open-Meteo was last reached successfully (not merely when the page loaded). */
  lastUpdated: number | null;
  error: string | null;
}

const CHECKED_KEY = 'pb-weather:last-checked';
/** Re-check automatically when the app comes back to the foreground after this long. */
const AUTO_REFRESH_MS = 60 * 60_000;

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
  });
  const inFlight = useRef(false);
  const lastChecked = useRef<number | null>(readLastChecked());

  const loadData = useCallback(async () => {
    if (inFlight.current) return;
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

      const summary = await fetchAllDeterministicRuns(cachedRuns, (done, total) => {
        setState((s) => ({ ...s, progress: { done, total, phase: 'Fetching model runs' } }));
      });

      const reachedServer = summary.ok + summary.unavailable > 0;
      if (reachedServer) {
        lastChecked.current = Date.now();
        try { localStorage.setItem(CHECKED_KEY, String(lastChecked.current)); } catch { /* not critical */ }
      }

      const allRuns = summary.ok > 0 ? await getAllCachedRuns() : cachedRuns;
      const error = summary.requested === 0 || reachedServer ? null
        : allRuns.length ? "Couldn't reach the forecast service. Showing the forecast saved on this device."
        : "Couldn't reach the forecast service. Check your connection and try Refresh.";

      setState((s) => ({
        runs: allRuns,
        loading: false,
        progress: null,
        lastUpdated: lastChecked.current ?? s.lastUpdated,
        error,
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
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadData]);

  return { ...state, refresh: loadData };
}
