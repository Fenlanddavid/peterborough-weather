import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchSeasonalData, type SeasonalData } from '../api/seasonal';

export function useSeasonalData(today: string) {
  const [state, setState] = useState<{ data: SeasonalData | null; loading: boolean; error: boolean }>({
    data: null, loading: true, error: false,
  });

  const request = useRef(0);
  const load = useCallback((force = false) => {
    setState((s) => ({ ...s, loading: true, error: false }));
    const id = ++request.current;
    fetchSeasonalData(today, force).then((data) => {
      if (id !== request.current) return;
      setState({ data, loading: false, error: false });
    }).catch(() => {
      if (id !== request.current) return;
      setState((s) => ({ ...s, loading: false, error: true }));
    });
  }, [today]);

  const invalidate = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => { clearTimeout(timer); invalidate(); };
  }, [load, invalidate]);

  return { ...state, refresh: () => load(true) };
}
