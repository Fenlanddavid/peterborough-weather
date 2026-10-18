import { useMemo, useState } from 'react';
import type { EnsembleData } from '../types';
import type { VariableId } from '../config/models';
import { ENSEMBLE_MODELS, VARIABLES } from '../config/models';
import { ensembleExceedance } from '../metrics/ensemble';
import { VariableSelector } from '../components/VariableSelector';
import { toLocalTime, timeAgo } from '../hooks/useLocalTime';

interface Props {
  ensembles: EnsembleData[];
}

function getWindowEnds(): string[] {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const times: string[] = [];
  for (let h = 6; h <= 168; h += 6) {
    times.push(new Date(start.getTime() + h * 3600_000).toISOString().slice(0, 16));
  }
  return times;
}

const EVENTS: Record<string, { label: string; threshold: number; mode: 'sum' | 'max' }[]> = {
  temperature_2m: [
    { label: '> 20°C', threshold: 20, mode: 'max' },
    { label: '< 0°C', threshold: 0, mode: 'max' },
  ],
  precipitation: [
    { label: '> 1mm/6h', threshold: 1, mode: 'sum' },
    { label: '> 5mm/6h', threshold: 5, mode: 'sum' },
    { label: '> 10mm/6h', threshold: 10, mode: 'sum' },
  ],
  wind_gusts_10m: [
    { label: '> 30mph', threshold: 30, mode: 'max' },
    { label: '> 40mph', threshold: 40, mode: 'max' },
    { label: '> 50mph', threshold: 50, mode: 'max' },
  ],
  wind_speed_10m: [
    { label: '> 20mph', threshold: 20, mode: 'max' },
    { label: '> 30mph', threshold: 30, mode: 'max' },
  ],
  pressure_msl: [
    { label: '< 1000 hPa', threshold: 1000, mode: 'max' },
    { label: '< 990 hPa', threshold: 990, mode: 'max' },
  ],
};

export function Ensembles({ ensembles }: Props) {
  const [variable, setVariable] = useState<VariableId>('precipitation');
  const windowEnds = useMemo(() => getWindowEnds(), []);
  const events = EVENTS[variable] ?? [];

  const data = useMemo(() => {
    return ENSEMBLE_MODELS.map((model) => {
      const ens = ensembles.find((e) => e.modelId === model.id && e.variable === variable);
      if (!ens) return { model, rows: null, fetchedAt: null };

      const rows = windowEnds.map((w) => {
        const results = events.map((event) => {
          // For temperature/pressure events with '<', we need to flip the comparison
          if (event.label.startsWith('<')) {
            // Count members BELOW threshold
            const result = ensembleExceedance(ens, w, -event.threshold, variable, event.mode);
            // Actually, let's use the raw data differently
            // We need a custom check. For now, use exceedance as >threshold
            // and handle < separately
            return ensembleExceedanceLt(ens, w, event.threshold, variable, event.mode);
          }
          return ensembleExceedance(ens, w, event.threshold, variable, event.mode);
        });
        return { windowEnd: w, results };
      });

      return { model, rows, fetchedAt: ens.fetchedAt };
    });
  }, [ensembles, variable, windowEnds, events]);

  return (
    <div className="view-ensembles">
      <VariableSelector selected={variable} onChange={setVariable} />

      <p className="ensemble-note">
        Ensemble guidance — not a calibrated probability. Each value shows members meeting
        the event out of members with complete data.
      </p>

      {data.map(({ model, rows, fetchedAt }) => (
        <div key={model.id} className="ensemble-model-card">
          <h3 style={{ color: model.colour }}>
            {model.label} ({model.members} members)
            {fetchedAt && <span className="data-age">{timeAgo(fetchedAt)}</span>}
          </h3>

          {!rows ? (
            <p className="no-data">No ensemble data available for this variable.</p>
          ) : (
            <div className="table-scroll">
              <table className="ensemble-table">
                <thead>
                  <tr>
                    <th>Window</th>
                    {events.map((ev) => (
                      <th key={ev.label}>{ev.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ windowEnd, results }) => (
                    <tr key={windowEnd}>
                      <td>{toLocalTime(windowEnd, 'short')}</td>
                      {results.map((r, i) => (
                        <td key={i} className={r ? getProbClass(r.met / r.total) : ''}>
                          {r ? `${r.met}/${r.total}` : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** Exceedance for < threshold */
function ensembleExceedanceLt(
  ensemble: EnsembleData,
  windowEndISO: string,
  threshold: number,
  variable: VariableId,
  mode: 'sum' | 'max'
): { met: number; total: number } | null {
  const result = ensembleExceedance(ensemble, windowEndISO, -Infinity, variable, mode);
  if (!result) return null;

  // We need to re-count. Use the raw ensemble data.
  const endTime = new Date(windowEndISO).getTime();
  const convert = variable === 'wind_speed_10m' || variable === 'wind_gusts_10m';
  const MS_TO_MPH = 2.23694;

  const indices: number[] = [];
  for (let h = 5; h >= 0; h--) {
    const t = new Date(endTime - h * 3600_000).toISOString().slice(0, 16);
    const idx = ensemble.times.indexOf(t);
    if (idx !== -1) indices.push(idx);
  }

  if (indices.length === 0) return null;

  let met = 0;
  let total = 0;

  for (const memberValues of ensemble.members) {
    const windowValues: number[] = [];
    let complete = true;

    for (const idx of indices) {
      const v = memberValues[idx];
      if (v === null || v === undefined) { complete = false; break; }
      windowValues.push(convert ? v * MS_TO_MPH : v);
    }

    if (!complete) continue;
    total++;

    const windowResult = mode === 'sum'
      ? windowValues.reduce((a, b) => a + b, 0)
      : Math.max(...windowValues);

    if (windowResult < threshold) met++;
  }

  if (total === 0) return null;
  return { met, total };
}

function getProbClass(ratio: number): string {
  if (ratio >= 0.7) return 'prob-high';
  if (ratio >= 0.3) return 'prob-mid';
  if (ratio > 0) return 'prob-low';
  return '';
}
