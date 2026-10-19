import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAuroraData, type AuroraData } from '../api/aurora';

export function useAuroraData() {
  const [aurora, setAurora] = useState<AuroraData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const load = useCallback((force = false) => {
    const id = ++request.current;
    setLoading(true);
    setError(false);
    fetchAuroraData(force).then((data) => {
      if (id !== request.current) return;
      if (data) setAurora(data);
      setError(!data);
    }).catch(() => {
      if (id === request.current) setError(true);
    }).finally(() => {
      if (id === request.current) setLoading(false);
    });
  }, []);
  const invalidate = useCallback(() => { request.current++; }, []);
  useEffect(() => {
    const timer = setTimeout(() => load(), 0);
    return () => { clearTimeout(timer); invalidate(); };
  }, [load, invalidate]);
  return { aurora, loading, error, refresh: () => load(true) };
}
