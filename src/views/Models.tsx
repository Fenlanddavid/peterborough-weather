import { useMemo, useState } from 'react';
import type { CachedRun } from '../types';
import type { VariableId } from '../config/models';
import { DETERMINISTIC_MODELS, VARIABLES, FAMILY_COLOURS } from '../config/models';
import { getModelRuns, getValueAtTime } from '../metrics/utils';
import { calcFamilySpread } from '../metrics/metrics';
import { VariableSelector } from '../components/VariableSelector';
import { toLocalTime } from '../hooks/useLocalTime';

interface Props {
  runs: CachedRun[];
}

function getDayNoons(): string[] {
  const now = new Date();
  const times: string[] = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, 12));
    times.push(date.toISOString().slice(0, 16));
  }
  return times;
}

export function Models({ runs }: Props) {
  const [variable, setVariable] = useState<VariableId>('temperature_2m');
  const noons = useMemo(() => getDayNoons(), []);
  const variableCfg = VARIABLES.find((v) => v.id === variable)!;
  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);

  const spreadData = useMemo(() => {
    return noons.map((t) => ({
      time: t,
      spread: calcFamilySpread(runs, t, variable),
    }));
  }, [runs, variable, noons]);

  // Latest value per model per day
  const modelValues = useMemo(() => {
    return noons.map((t) => {
      const vals: Record<string, number | null> = {};
      for (const model of models) {
        const modelRuns = getModelRuns(runs, model.id, variable);
        const latest = modelRuns.length > 0 ? modelRuns[modelRuns.length - 1] : null;
        vals[model.id] = latest ? getValueAtTime(latest, t) : null;
      }
      return { time: t, vals };
    });
  }, [runs, variable, noons, models]);

  return (
    <div className="view-models">
      <VariableSelector selected={variable} onChange={setVariable} />

      <h3>Family Spread ({variableCfg.unit})</h3>
      <div className="spread-cards">
        {spreadData.map(({ time, spread }) => (
          <div key={time} className="spread-card">
            <h4>{toLocalTime(time, 'short').split(',')[0]}</h4>
            {spread ? (
              <>
                <div className="spread-value">{spread.spread.toFixed(variableCfg.precision)} {variableCfg.unit} spread</div>
                <div className="family-bars">
                  {spread.families.map((f) => (
                    <div key={f.family} className="family-bar">
                      <span style={{ color: FAMILY_COLOURS[f.family] }}>{f.family}</span>
                      <span>{f.value.toFixed(variableCfg.precision)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-data">Insufficient data</div>
            )}
          </div>
        ))}
      </div>

      <h3>Individual Models</h3>
      <div className="table-scroll">
        <table className="summary-table">
          <thead>
            <tr>
              <th>Model</th>
              {noons.map((t) => (
                <th key={t}>{toLocalTime(t, 'short').split(',')[0]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((model) => {
              // Check if models within same family disagree
              const sameFamily = models.filter((m) => m.family === model.family && m.id !== model.id);

              return (
                <tr key={model.id}>
                  <td style={{ color: model.colour, fontWeight: 600 }}>{model.label}</td>
                  {modelValues.map((d) => {
                    const val = d.vals[model.id];
                    // Check intra-family disagreement
                    let disagree = false;
                    if (val !== null) {
                      for (const peer of sameFamily) {
                        const peerVal = d.vals[peer.id];
                        if (peerVal !== null && Math.abs(val - peerVal) > 2) {
                          disagree = true;
                        }
                      }
                    }
                    return (
                      <td key={d.time} className={disagree ? 'disagree' : ''}>
                        {val !== null ? val.toFixed(variableCfg.precision) : '—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
