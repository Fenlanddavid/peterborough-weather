import type { CachedRun, EnsembleData } from '../types';
import { DETERMINISTIC_MODELS, ENSEMBLE_MODELS, LOCATION } from '../config/models';
import { toLocalTime, timeAgo } from '../hooks/useLocalTime';

interface Props {
  runs: CachedRun[];
  ensembles: EnsembleData[];
  lastUpdated: number | null;
}

export function About({ runs, ensembles, lastUpdated }: Props) {
  // Latest run time per model
  const modelStatus = DETERMINISTIC_MODELS.map((model) => {
    const modelRuns = runs.filter((r) => r.modelId === model.id);
    const runTimes = [...new Set(modelRuns.map((r) => r.runTime))].sort();
    const latest = runTimes[runTimes.length - 1] ?? null;
    const count = new Set(modelRuns.map((r) => r.runTime)).size;

    return { model, latestRun: latest, runCount: count };
  });

  const ensembleStatus = ENSEMBLE_MODELS.map((model) => {
    const ens = ensembles.filter((e) => e.modelId === model.id);
    const fetchedAt = ens.length > 0 ? Math.max(...ens.map((e) => e.fetchedAt)) : null;
    return { model, fetchedAt, variables: ens.length };
  });

  return (
    <div className="view-about">
      <h3>Peterborough Weather Model Trends</h3>
      <p>
        This app compares what successive weather model runs forecast for
        the same future times, revealing trends, flip-flops, and model
        disagreement.
      </p>

      <div className="about-section">
        <h4>Location</h4>
        <p>{LOCATION.name} ({LOCATION.latitude}°N, {LOCATION.longitude}°E)</p>
      </div>

      <div className="about-section">
        <h4>Data Age</h4>
        <p>
          {lastUpdated
            ? `Last updated: ${timeAgo(lastUpdated)} (${new Date(lastUpdated).toLocaleString('en-GB', { timeZone: 'Europe/London' })})`
            : 'Not yet loaded'}
        </p>
      </div>

      <div className="about-section">
        <h4>Deterministic Models</h4>
        <table className="about-table">
          <thead>
            <tr><th>Model</th><th>Latest Run</th><th>Cached Runs</th></tr>
          </thead>
          <tbody>
            {modelStatus.map(({ model, latestRun, runCount }) => (
              <tr key={model.id}>
                <td style={{ color: model.colour }}>{model.label}</td>
                <td>{latestRun ? toLocalTime(latestRun, 'short') : 'No data'}</td>
                <td>{runCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="about-section">
        <h4>Ensemble Models</h4>
        <table className="about-table">
          <thead>
            <tr><th>Model</th><th>Members</th><th>Last Fetch</th></tr>
          </thead>
          <tbody>
            {ensembleStatus.map(({ model, fetchedAt }) => (
              <tr key={model.id}>
                <td style={{ color: model.colour }}>{model.label}</td>
                <td>{model.members}</td>
                <td>{fetchedAt ? timeAgo(fetchedAt) : 'No data'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="about-section">
        <h4>Notes</h4>
        <ul>
          <li>All times displayed in Europe/London time (GMT/BST).</li>
          <li>Temperatures in °C, precipitation in mm, wind/gusts in mph, pressure in hPa.</li>
          <li>Runs are cached locally and never re-downloaded. Runs older than 120 hours are pruned.</li>
          <li>Nulls are treated as missing data, never as zero.</li>
          <li>Ensemble figures are current snapshots, not calibrated probabilities.</li>
        </ul>
      </div>

      <div className="about-section attribution">
        <h4>Data Source</h4>
        <p>
          Weather data provided by{' '}
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Open-Meteo
          </a>{' '}
          (free, non-commercial API).
        </p>
        <p className="attribution-note">
          ECMWF, NOAA GFS, and UK Met Office model data via Open-Meteo.
          See{' '}
          <a href="https://open-meteo.com/en/terms" target="_blank" rel="noopener noreferrer">
            terms of use
          </a>.
        </p>
      </div>
    </div>
  );
}
