import { useState, useEffect, useCallback } from 'react';
import type { CachedRun, EnsembleData } from '../types';
import { fetchAllDeterministicRuns, fetchEnsembles } from '../api/fetch';
import { getAllCachedRuns, getAllEnsembles } from '../api/db';

interface WeatherDataState {
  runs: CachedRun[];
  ensembles: EnsembleData[];
  loading: boolean;
  progress: { done: number; total: number; phase: string } | null;
  lastUpdated: number | null;
  error: string | null;
}

export function useWeatherData() {
  const [state, setState] = useState<WeatherDataState>({
    runs: [],
    ensembles: [],
    loading: true,
    progress: null,
    lastUpdated: null,
    error: null,
  });

  const loadData = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Load cached data first for instant display
      const cachedRuns = await getAllCachedRuns();
      const cachedEnsembles = await getAllEnsembles();
      if (cachedRuns.length > 0) {
        setState((s) => ({
          ...s,
          runs: cachedRuns,
          ensembles: cachedEnsembles,
          lastUpdated: Math.max(...cachedRuns.map((r) => r.fetchedAt)),
        }));
      }

      // Fetch new deterministic runs
      await fetchAllDeterministicRuns((done, total) => {
        setState((s) => ({ ...s, progress: { done, total, phase: 'Fetching model runs' } }));
      });

      // Fetch ensemble snapshots
      await fetchEnsembles((done, total) => {
        setState((s) => ({ ...s, progress: { done, total, phase: 'Fetching ensembles' } }));
      });

      // Reload from DB
      const allRuns = await getAllCachedRuns();
      const allEnsembles = await getAllEnsembles();

      setState({
        runs: allRuns,
        ensembles: allEnsembles,
        loading: false,
        progress: null,
        lastUpdated: Date.now(),
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        progress: null,
        error: err instanceof Error ? err.message : 'Failed to load data',
      }));
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return { ...state, refresh: loadData };
}
