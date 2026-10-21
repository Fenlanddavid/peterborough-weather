import { useEffect, useRef, useState } from 'react';
import { fetchMonthlyOutlook, readMonthlyOutlook } from '../api/monthly';

export function useMonthlyOutlook(today: string, refreshKey: number | null = null) {
  const [reload, setReload] = useState(0);
  const lastReload = useRef(0);
  const key = `${today}:${refreshKey}:${reload}`;
  const [state, setState] = useState(() => ({ data: readMonthlyOutlook(), completedKey: null as string | null, failed: false }));
  useEffect(() => {
    let active = true;
    const force = reload !== lastReload.current;
    lastReload.current = reload;
    fetchMonthlyOutlook(today, force).then((data) => {
      if (active) setState({ data, completedKey: key, failed: false });
    }).catch(() => {
      if (active) setState((previous) => ({ ...previous, completedKey: key, failed: true }));
    });
    return () => { active = false; };
  }, [today, key, reload]);
  return { data: state.data, loading: state.completedKey !== key, failed: state.completedKey === key && state.failed, refresh: () => setReload((value) => value + 1) };
}
