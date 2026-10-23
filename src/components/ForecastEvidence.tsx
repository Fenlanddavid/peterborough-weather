import type { EventEstimate } from '../data/contracts';
import { eventPercent, localTime } from '../data/contracts';
import type { SourceResult } from '../data/contracts';
import type { SnapshotPair } from '../forecast/ensembles';
import { ENSEMBLE_MODELS } from '../forecast/ensembles';
import { useLocalNow } from '../hooks/useLocalTime';
import { runIsStale } from '../api/modelUpdates';
import { usageToday } from '../data/scheduler';

export function EventEvidence({ event }: { event: EventEstimate }) {
  return <span className="event-evidence">{event.value === null ? 'Event estimate unavailable' : `${event.basis === 'ensemble-probability' ? 'Rain/snow probability estimate' : event.basis === 'recent-run-support' ? 'Recent-run support' : 'Deterministic wet agreement'} ${eventPercent(event.value)}`}<small> · {event.threshold} · {localTime(event.start)}–{localTime(event.end)} · {event.usable}/{event.expected} eligible{event.status === 'partial' ? ' · partial data' : ''}</small></span>;
}
export function EnsembleStatus({ sources }: { sources: Record<string, SourceResult<SnapshotPair>> }) {
  const now = useLocalNow().getTime();
  const usage = usageToday(now);
  return <details className="forecast-note"><summary>Ensemble sources and API usage</summary>{ENSEMBLE_MODELS.map(model => {
    const result = sources[model.id]; const snapshot = result?.data?.current;
    return <p key={model.id}>{model.label}: {snapshot ? `${Object.keys(snapshot.members.temperature_2m ?? {}).length}/${model.expected} temperature members` : 'unavailable'} · {result?.status ?? 'checking'}{result?.error && ` · ${result.error}`}{result?.storageError && ' · cache unavailable; new data may not be available offline'}{snapshot && <> · checked {localTime(result.checkedAt)} · last successful fetch {new Date(snapshot.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} · issue time {snapshot.issuedAt === null ? 'not supplied; snapshots compared by content' : localTime(snapshot.issuedAt)}{snapshot.providerUpdate && <> · provider latest initialisation {new Date(snapshot.providerUpdate.initialisedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })} (metadata; response issue remains unconfirmed)</>}{(snapshot.providerUpdate ? runIsStale(snapshot.modelId, snapshot.providerUpdate.initialisedAt, now, { ...snapshot.providerUpdate, cadence: 6 * 3600_000, nativeHours: snapshot.nativeHours, checkedAt: snapshot.fetchedAt }) : now - (snapshot.firstSeenAt ?? snapshot.fetchedAt) > 6 * 3600_000) && ' · stale/recency unknown; excluded from new estimates'}{snapshot.warnings.map(w => ` · ${w}`)}</>}</p>;
  })}<p>Uncalibrated estimates; systems receive equal weight. IFS/GEFS hourly output is resampled from coarser native forecasts. {usage.http} HTTP requests / {usage.weighted} estimated weighted calls today (UTC). Optional requests defer at 1,500; all stop at 2,000. This device cannot count other devices sharing the IP.</p></details>;
}
