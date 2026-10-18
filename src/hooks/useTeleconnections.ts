import { useEffect, useState } from 'react';
import { fetchTeleconnections, readTeleconnections, type TeleconnectionSnapshot } from '../api/teleconnections';
import { classifyTeleconnections, type TeleconnectionContext } from '../metrics/regime';

interface TeleconnectionState {
  snapshot: TeleconnectionSnapshot | null;
  context: TeleconnectionContext | null;
  loading: boolean;
  failed: boolean;
  refresh: () => void;
}

export function useTeleconnections(): TeleconnectionState {
  const [snapshot, setSnapshot] = useState<TeleconnectionSnapshot | null>(() => readTeleconnections());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetchTeleconnections(trigger > 0)
      .then((data) => { if (!cancelled) setSnapshot(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [trigger]);

  const context = snapshot ? classifyTeleconnections(snapshot) : null;
  const refresh = () => {
    setLoading(true);
    setFailed(false);
    setTrigger((n) => n + 1);
  };

  return { snapshot, context, loading, failed, refresh };
}
