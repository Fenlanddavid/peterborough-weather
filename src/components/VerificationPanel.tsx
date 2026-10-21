import { useState } from 'react';
import { resource } from '../data/resource';
import { scheduledFetch } from '../data/scheduler';
import { useVisibleResource } from '../hooks/useVisibleResource';
import type { VerificationResult } from '../verification/verification';
import { HOUR } from '../data/contracts';
import { useLocalNow } from '../hooks/useLocalTime';
interface VerificationProduct { sourceTime: number | null; collectedAt: number; station: { id: string; name: string; latitude: number; longitude: number; elevation: number }; results: VerificationResult[]; failures: string[] }
const load = (signal: AbortSignal) => resource('verification:results', HOUR, async () => {
  const response = await scheduledFetch(new URL(`${import.meta.env.BASE_URL}data/verification/results.json`, location.href).href, { signal });
  const raw = await response.json();
  if (!raw || !Array.isArray(raw.results) || !raw.station || typeof raw.collectedAt !== 'number') throw new RangeError('Invalid verification archive');
  return raw as VerificationProduct;
});
const metric = (value: number | null) => value === null ? '—' : value.toFixed(2);
export function VerificationPanel() {
  const now = useLocalNow().getTime();
  const result = useVisibleResource('verification:results', HOUR, load);
  const [model, setModel] = useState('all'); const [lead, setLead] = useState('all');
  const data = result?.data;
  const rows = data?.results.filter(r => (model === 'all' || r.modelId === model) && (lead === 'all' || String(r.leadHours) === lead)) ?? [];
  return <section className="verification-panel"><h2>Observation verification · optional</h2><p>Information only. Automatic correction and model reweighting are disabled. Wittering station errors are not pure Peterborough grid errors and are not transferred to Peterborough.</p>
    {!data ? <p role="status">{result ? `Observation archive unavailable: ${result.error ?? result.status}. Collectors may be disabled.` : 'Checking the optional observation archive…'}</p> : <>
      <p>{data.station.id} · {data.station.name} · {data.station.latitude}°N, {data.station.longitude}°E · elevation {data.station.elevation} m. Forecasts are requested at this station; grid/elevation metadata is retained.</p><p>Last observation: {data.sourceTime === null ? 'unknown' : new Date(data.sourceTime).toLocaleString('en-GB', { timeZone: 'Europe/London' })} · collector: {new Date(data.collectedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}{now - data.collectedAt > 3 * HOUR && ' · stale collector'}{result?.error && ` · refresh failed: ${result.error}`}</p>
      <label>Model <select value={model} onChange={e => setModel(e.target.value)}><option value="all">All</option>{[...new Set(data.results.map(r => r.modelId))].map(m => <option key={m}>{m}</option>)}</select></label><label>Fixed lead <select value={lead} onChange={e => setLead(e.target.value)}><option value="all">All</option>{[...new Set(data.results.map(r => r.leadHours))].map(l => <option key={l} value={l}>{l} hours</option>)}</select></label>
      {!rows.length && <p>Insufficient matched observations for this selection.</p>}<div className="verification-scroll"><table><thead><tr><th>Model / variable / lead</th><th>Dates</th><th>Pairs / dates / coverage</th><th>MAE / MSE / bias</th><th>Proposed subtraction</th><th>Held-out MAE (raw / proposal / equal-family baseline)</th><th>Enabled</th></tr></thead><tbody>{rows.map(r => <tr key={`${r.modelId}:${r.variable}:${r.leadHours}`}><td>{r.modelId}<br />{r.variable} · {r.leadHours}h</td><td>{new Date(r.range[0]).toISOString().slice(0, 10)}–{new Date(r.range[1]).toISOString().slice(0, 10)}</td><td>{r.metrics.n} / {r.metrics.days} / {Math.round(r.coverage * 100)}%</td><td>{metric(r.metrics.mae)} / {metric(r.metrics.mse)} / {metric(r.metrics.bias)}</td><td>{r.proposal === null ? 'Gate not met' : `${r.proposal.toFixed(2)}°C`}<details><summary>Evidence</summary>{r.reasons.map(reason => <p key={reason}>{reason}</p>)}<p>Training: {r.training.n} pairs / {r.training.days} dates. Held out: {r.heldOutRaw.n} pairs / {r.heldOutRaw.days} dates. Mean absolute match offset {r.meanMatchOffsetMinutes.toFixed(1)} min.</p></details></td><td>{metric(r.heldOutRaw.mae)} / {metric(r.heldOutProposed?.mae ?? null)} / {metric(r.heldOutBaseline.mae)}</td><td>No</td></tr>)}</tbody></table></div>{data.failures?.map(f => <p key={f}>{f}</p>)}
    </>}
    <p>Temperature errors use station-matched instantaneous forecasts and the nearest report within 30 minutes, with one observation per UTC hour. Wind diagnostics await compatible measurement definitions. METAR present weather is not an hourly rain gauge; no rain Brier score is calculated. Cloud reports are not exact total-column cloud percentages. Bias proposals need ≥200 training hours across ≥20 dates, use 30 training days and seven subsequent held-out dates, and are capped at ±3°C. Minimum sample gates do not prove general skill.</p><p>Observations: <a href="https://aviationweather.gov/data/api/">NOAA AviationWeather</a>. Fixed-lead forecasts: <a href="https://open-meteo.com/en/docs/previous-runs-api">Open-Meteo Previous Runs</a>.</p>
  </section>;
}
