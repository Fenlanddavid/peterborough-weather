import { useMemo } from 'react';
import type { CachedRun } from '../types';
import type { VariableId } from '../config/models';
import { DETERMINISTIC_MODELS, VARIABLES } from '../config/models';
import { getModelRuns, getValueAtTime, sortByRunTime } from '../metrics/utils';
import { calcChange } from '../metrics/metrics';
import { generateHeadlines } from '../commentary/commentary';
import { toLocalTime } from '../hooks/useLocalTime';

interface Props {
  runs: CachedRun[];
}

function getNext7DayNoons(): string[] {
  const now = new Date();
  const times: string[] = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, 12
    ));
    times.push(date.toISOString().slice(0, 16));
  }
  return times;
}

export function Summary({ runs }: Props) {
  const noons = useMemo(() => getNext7DayNoons(), []);

  const summaryData = useMemo(() => {
    const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);
    const results: {
      time: string;
      values: Record<string, Record<string, { value: number | null; change24h: number | null }>>;
    }[] = [];

    for (const t of noons) {
      const row: Record<string, Record<string, { value: number | null; change24h: number | null }>> = {};

      for (const model of models) {
        row[model.id] = {};
        for (const v of VARIABLES) {
          const modelRuns = getModelRuns(runs, model.id, v.id);
          const latest = modelRuns.length > 0 ? modelRuns[modelRuns.length - 1] : null;
          const value = latest ? getValueAtTime(latest, t) : null;
          const change = calcChange(modelRuns, t);
          row[model.id][v.id] = { value, change24h: change.change24h };
        }
      }
      results.push({ time: t, values: row });
    }

    return results;
  }, [runs, noons]);

  const headlines = useMemo(() => {
    const allHeadlines: string[] = [];
    for (const v of VARIABLES) {
      const h = generateHeadlines(runs, v.id, noons.slice(0, 4));
      allHeadlines.push(...h);
    }
    return allHeadlines.slice(0, 6);
  }, [runs, noons]);

  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);

  return (
    <div className="view-summary">
      {headlines.length > 0 && (
        <div className="headlines-card">
          <h3>Headlines</h3>
          {headlines.map((h, i) => (
            <p key={i} className="headline">{h}</p>
          ))}
        </div>
      )}

      <h3>7-Day Overview (12:00 local)</h3>

      {VARIABLES.map((v) => (
        <div key={v.id} className="summary-table-wrap">
          <h4>{v.label} ({v.unit})</h4>
          <div className="table-scroll">
            <table className="summary-table">
              <thead>
                <tr>
                  <th>Model</th>
                  {summaryData.map((d) => (
                    <th key={d.time}>{toLocalTime(d.time, 'short').split(',')[0]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <tr key={model.id}>
                    <td style={{ color: model.colour, fontWeight: 600 }}>{model.label}</td>
                    {summaryData.map((d) => {
                      const cell = d.values[model.id]?.[v.id];
                      if (!cell || cell.value === null) {
                        return <td key={d.time} className="no-data">—</td>;
                      }
                      const changeStr = cell.change24h !== null
                        ? ` (${cell.change24h > 0 ? '+' : ''}${cell.change24h.toFixed(v.precision)})`
                        : '';
                      return (
                        <td key={d.time}>
                          {cell.value.toFixed(v.precision)}
                          {changeStr && <span className="change-badge">{changeStr}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
