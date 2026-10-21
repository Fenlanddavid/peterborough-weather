import { useEffect, useState } from 'react';
import type { SourceResult } from '../data/contracts';
import { cachedResource } from '../data/resource';

/** Mounted by its owning tab. Cache renders before refresh; hidden documents do no polling. */
export function useVisibleResource<T>(key: string, cadence: number, load: (signal: AbortSignal) => Promise<SourceResult<T>>) {
  const [result, setResult] = useState<SourceResult<T> | null>(null);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined; let controller: AbortController | null = null;
    const refresh = async () => {
      if (document.hidden || controller || !alive) return;
      controller = new AbortController();
      try { const next = await load(controller.signal); if (alive) setResult(next); }
      catch (error) { if (alive) setResult(old => ({ data: old?.data ?? null, status: 'network-error', error: String(error), stale: !!old?.data, checkedAt: Date.now() })); }
      finally { controller = null; if (alive && !document.hidden) timer = setTimeout(refresh, cadence); }
    };
    void cachedResource<T>(key).then(saved => { if (alive && saved) setResult(saved); }).then(refresh);
    const visibility = () => { clearTimeout(timer); if (document.hidden) controller?.abort(); else void refresh(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { alive = false; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [key, cadence, load]);
  return result;
}
