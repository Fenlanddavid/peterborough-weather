import { useEffect, useState } from 'react';
import { fetchMonthlyOutlook, readMonthlyOutlook } from '../api/monthly';

export function useMonthlyOutlook(today: string, refreshKey: number | null = null) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState(() => ({ data: readMonthlyOutlook(), loading: true, failed: false }));
  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    fetchMonthlyOutlook(today, reload > 0).then((data) => {
      if (active) setState({ data, loading: false, failed: false });
    }).catch(() => {
      if (active) setState((previous) => ({ ...previous, loading: false, failed: true }));
    });
    return () => { active = false; };
  }, [today, refreshKey, reload]);
  return { ...state, refresh: () => setReload((value) => value + 1) };
}
