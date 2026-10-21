import { useEffect, useMemo, useState } from 'react';
import { ENSEMBLE_MODELS, fetchEnsemble } from '../forecast/ensembles';
import type { SnapshotPair } from '../forecast/ensembles';
import type { SourceResult } from '../data/contracts';
import { HOUR } from '../data/contracts';
import { cachedResource } from '../data/resource';
import { buildEnsembleIndex } from '../forecast/events';
import { useLocalNow } from './useLocalTime';

export function useEnsembles(enabled = true) {
  const now = useLocalNow().getTime();
  const [sources, setSources] = useState<Record<string, SourceResult<SnapshotPair>>>({});
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let controller: AbortController | null = null;
    const update = async () => {
      if (document.hidden || controller) return;
      controller = new AbortController();
      const signal = controller.signal;
      await Promise.all(ENSEMBLE_MODELS.map(async model => {
        const cached = await cachedResource<SnapshotPair>(`ensemble:${model.id}`);
        if (!alive || signal.aborted) return;
        if (alive && cached) setSources(s => ({ ...s, [model.id]: cached }));
        const result = await fetchEnsemble(model.id, false, signal);
        if (alive) setSources(s => ({ ...s, [model.id]: result }));
      }));
      controller = null;
    };
    const onVisibility = () => { if (document.hidden) controller?.abort(); else void update(); };
    void update();
    const timer = setInterval(() => void update(), 3 * HOUR);
    document.addEventListener('visibilitychange', onVisibility);
    return () => { alive = false; clearInterval(timer); controller?.abort(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled]);
  const loadedIndex = useMemo(() => buildEnsembleIndex(Object.values(sources).flatMap(s => s.data ? [s.data.current] : [])), [sources]);
  const index = useMemo(() => loadedIndex.atTime(now), [loadedIndex, now]);
  return { sources, index };
}
