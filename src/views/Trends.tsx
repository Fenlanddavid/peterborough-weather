import { useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import type { CachedRun } from '../types';
import type { VariableId } from '../config/models';
import { DETERMINISTIC_MODELS, VARIABLES } from '../config/models';
import { getModelRuns, getTrendValue } from '../metrics/utils';
import { calcChange, calcFlipFlop, calcPersistence, calcTrendSlope } from '../metrics/metrics';
import { generateCommentary } from '../commentary/commentary';
import { VariableSelector } from '../components/VariableSelector';
import { toLocalTime } from '../hooks/useLocalTime';

interface Props {
  runs: CachedRun[];
}

function getValidTimes(): string[] {
  const now = new Date();
  const times: string[] = [];
  // Every 6 hours for the next 7 days
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let h = 0; h <= 168; h += 6) {
    const t = new Date(start.getTime() + h * 3600_000);
    times.push(t.toISOString().slice(0, 16));
  }
  return times;
}

export function Trends({ runs }: Props) {
  const [variable, setVariable] = useState<VariableId>('temperature_2m');
  const [validTimeIdx, setValidTimeIdx] = useState(4); // ~24h ahead
  const [cycleFilter, setCycleFilter] = useState<number | null>(null);
  const validTimes = useMemo(() => getValidTimes(), []);
  const validTime = validTimes[validTimeIdx] ?? validTimes[0];

  const models = DETERMINISTIC_MODELS;
  const variableCfg = VARIABLES.find((v) => v.id === variable)!;

  // Chart data: x = run time, y = forecast value for the chosen valid time
  const chartData = useMemo(() => {
    // Collect all run times across all models
    const runTimeSet = new Set<string>();
    for (const model of models) {
      const modelRuns = getModelRuns(runs, model.id, variable);
      for (const run of modelRuns) {
        if (cycleFilter === null || new Date(run.runTime + 'Z').getUTCHours() === cycleFilter) {
          runTimeSet.add(run.runTime);
        }
      }
    }

    const runTimes = [...runTimeSet].sort();

    return runTimes.map((rt) => {
      const point: Record<string, string | number | null> = {
        runTime: rt,
        runTimeLabel: toLocalTime(rt, 'short'),
      };
      for (const model of models) {
        const modelRuns = getModelRuns(runs, model.id, variable);
        const run = modelRuns.find((r) => r.runTime === rt);
        point[model.id] = run ? getTrendValue(run, validTime) : null;
      }
      return point;
    });
  }, [runs, variable, validTime, models, cycleFilter]);

  // Metrics
  const metrics = useMemo(() => {
    return models
      .filter((m) => !m.isOverlay)
      .map((model) => {
        const modelRuns = getModelRuns(runs, model.id, variable);
        const change = calcChange(modelRuns, validTime);
        const flipFlop = calcFlipFlop(modelRuns, validTime, variable);
        const slope = calcTrendSlope(modelRuns, validTime);
        const persist = variable === 'precipitation'
          ? calcPersistence(modelRuns, validTime, 1, 8, 'gt')
          : null;

        return { model, change, flipFlop, slope, persist };
      });
  }, [runs, variable, validTime, models]);

  const commentary = useMemo(
    () => generateCommentary(runs, variable, validTime),
    [runs, variable, validTime]
  );

  return (
    <div className="view-trends">
      <VariableSelector selected={variable} onChange={setVariable} />

      <div className="valid-time-picker">
        <label>Valid time: </label>
        <input
          type="range"
          min={0}
          max={validTimes.length - 1}
          value={validTimeIdx}
          onChange={(e) => setValidTimeIdx(Number(e.target.value))}
        />
        <span className="valid-time-label">{toLocalTime(validTime, 'long')}{variable === 'precipitation' ? ' · 6h total to this time' : variable === 'wind_gusts_10m' ? ' · 6h max to this time' : ''}</span>
      </div>

      <div className="cycle-filter">
        <label>Cycle filter: </label>
        <select
          value={cycleFilter ?? 'all'}
          onChange={(e) => setCycleFilter(e.target.value === 'all' ? null : Number(e.target.value))}
        >
          <option value="all">All cycles</option>
          <option value="0">00Z</option>
          <option value="6">06Z</option>
          <option value="12">12Z</option>
          <option value="18">18Z</option>
        </select>
      </div>

      <div className="chart-container">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="runTimeLabel"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11 }}
              label={{ value: variableCfg.unit, angle: -90, position: 'insideLeft' }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #444' }}
              labelStyle={{ color: '#ccc' }}
            />
            <Legend />
            {models.map((model) => (
              <Line
                key={model.id}
                type="monotone"
                dataKey={model.id}
                name={model.label}
                stroke={model.colour}
                strokeWidth={model.isOverlay ? 1 : 2}
                strokeDasharray={model.isOverlay ? '4 2' : undefined}
                dot={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {commentary.text && (
        <div className="commentary-card">
          <p>{commentary.text}</p>
        </div>
      )}

      <div className="metrics-grid">
        {metrics.map(({ model, change, flipFlop, slope, persist }) => (
          <div key={model.id} className="metric-card" style={{ borderLeftColor: model.colour }}>
            <h4>{model.label}</h4>
            <div className="metric-row">
              <span>vs previous run:</span>
              <span>{change.changePrev !== null ? `${change.changePrev > 0 ? '+' : ''}${change.changePrev.toFixed(variableCfg.precision)} ${variableCfg.unit}` : '—'}</span>
            </div>
            <div className="metric-row">
              <span>vs 24h ago:</span>
              <span>{change.change24h !== null ? `${change.change24h > 0 ? '+' : ''}${change.change24h.toFixed(variableCfg.precision)} ${variableCfg.unit}` : '—'}</span>
            </div>
            <div className="metric-row">
              <span>vs 48h ago:</span>
              <span>{change.change48h !== null ? `${change.change48h > 0 ? '+' : ''}${change.change48h.toFixed(variableCfg.precision)} ${variableCfg.unit}` : '—'}</span>
            </div>
            <div className="metric-row">
              <span>Flip-flops:</span>
              <span>{flipFlop.totalRuns >= 3 ? `${flipFlop.reversals} reversals in ${flipFlop.totalRuns} runs` : '—'}</span>
            </div>
            {slope !== null && (
              <div className="metric-row">
                <span>Trend:</span>
                <span>{slope > 0 ? '+' : ''}{slope.toFixed(2)} {variableCfg.unit}/day</span>
              </div>
            )}
            {persist && persist.total >= 4 && (
              <div className="metric-row">
                <span>&gt;1 mm in 6h:</span>
                <span>{persist.count} of {persist.total} runs</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
