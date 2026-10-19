import { useId, useMemo, useState } from 'react';
import { useSeasonalData } from '../hooks/useSeasonalData';
import { SEASONAL_MODELS, tempSignal, precipSignal, type SeasonalMonth } from '../api/seasonal';
import { getLocalDate, useLocalNow } from '../hooks/useLocalTime';
import { WeatherIcon } from '../components/WeatherIcon';

export function Seasonal() {
  const now = useLocalNow();
  const today = getLocalDate(now);
  const { data, loading, error, refresh } = useSeasonalData(today);
  const [expanded, setExpanded] = useState<string | null>(null);

  const months = data?.months ?? [];
  // Show up to 7 months
  const displayMonths = months.slice(0, 7);
  const modelConfigs = SEASONAL_MODELS;
  const chartMax = Math.max(1, ...displayMonths.flatMap((m) => [...m.tempAnomalies.values()].map(Math.abs)));
  const period = displayMonths.length ? `${displayMonths[0].label} – ${displayMonths.at(-1)!.label}` : '';
  const availableModels = useMemo(() => {
    if (!data) return [];
    return modelConfigs.filter((m) => data.models.some((d) => d.modelId === m.id));
  }, [data, modelConfigs]);

  const overallTemp = useMemo(() => {
    if (displayMonths.length < 2) return null;
    const means = displayMonths.map((m) => m.tempMean).filter((v): v is number => v !== null);
    if (means.length < 2) return null;
    return means.reduce((a, b) => a + b, 0) / means.length;
  }, [displayMonths]);

  const overallPrecip = useMemo(() => {
    if (displayMonths.length < 2) return null;
    const means = displayMonths.map((m) => m.precipMean).filter((v): v is number => v !== null);
    if (means.length < 2) return null;
    return means.reduce((a, b) => a + b, 0) / means.length;
  }, [displayMonths]);

  return <div className="view-seasonal">
    <header className="seasonal-intro">
      <div>
        <p className="seasonal-eyebrow">Peterborough · Long range</p>
        <h1>Seasonal outlook</h1>
        <p>Temperature and rainfall signals for the months ahead.</p>
      </div>
      <button type="button" className="seasonal-refresh" onClick={refresh} disabled={loading} aria-label="Refresh seasonal outlook">
        <WeatherIcon name="refresh" /><span>{loading ? 'Updating' : 'Refresh'}</span>
      </button>
    </header>

    {(loading && !data) && <div className="seasonal-status" role="status">
      <WeatherIcon name="calendar" />
      <p>Gathering the seasonal outlook and shorter-range comparison…</p>
    </div>}

    {error && !data && <div className="seasonal-status seasonal-status--error" role="status">
      <WeatherIcon name="cloud" /><div><strong>Seasonal outlook unavailable</strong><p>Check your connection, then try Refresh seasonal outlook.</p></div>
    </div>}

    {data && <>
      <div className="seasonal-sources">
        <span className="seasonal-eyebrow">Forecast sources · {availableModels.length} of {modelConfigs.length} available</span>
        <div className="seasonal-model-chips">
          {modelConfigs.map((m) => {
            const active = availableModels.some((a) => a.id === m.id);
            return <span key={m.id} className={`seasonal-chip ${active ? '' : 'seasonal-chip--missing'}`}>
              <span className="seasonal-chip-dot" style={{ backgroundColor: active ? m.colour : undefined }} />
              {m.label}
              <span className="seasonal-chip-agency">{active ? m.id === 'ecmwf_seas5' ? 'Up to 7 months' : 'Up to 46 days' : 'Unavailable'}</span>
            </span>;
          })}
        </div>
        {error && <p className="seasonal-refresh-note">Latest refresh failed. Showing saved data from {new Date(data.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</p>}
      </div>

      {(overallTemp !== null || overallPrecip !== null) && <section className="seasonal-summary" aria-labelledby="seasonal-summary-title">
        <p className="seasonal-eyebrow">Overall signal</p>
        <h2 id="seasonal-summary-title">The months ahead</h2>
        <p className="seasonal-period">{period}</p>
        <div className="seasonal-summary-signals">
          {overallTemp !== null && <div className={`seasonal-signal seasonal-signal--temp seasonal-signal--${overallTemp >= 0.5 ? 'warm' : overallTemp <= -0.5 ? 'cool' : 'neutral'}`}>
            <WeatherIcon name="sun" />
            <div>
              <strong>{tempSignal(overallTemp)}</strong>
              <span>{overallTemp >= 0 ? '+' : ''}{overallTemp.toFixed(1)}°C compared with the model average</span>
            </div>
          </div>}
          {overallPrecip !== null && <div className={`seasonal-signal seasonal-signal--precip seasonal-signal--${overallPrecip >= 1 ? 'wet' : overallPrecip <= -1 ? 'dry' : 'neutral'}`}>
            <WeatherIcon name="drop" />
            <div>
              <strong>{precipSignal(overallPrecip)}</strong>
              <span>{overallPrecip >= 0 ? '+' : ''}{overallPrecip.toFixed(1)} mm/week anomaly</span>
            </div>
          </div>}
        </div>
      </section>}

      <aside className="seasonal-reading-note"><WeatherIcon name="calendar" /><p><strong>A guide to the season.</strong> Values show differences from each system’s usual climate. These are broad tendencies; individual days can still vary. EC46 covers fewer weeks, so the available systems change by month.</p></aside>
      {!displayMonths.length && <div className="seasonal-status" role="status">No upcoming months are available from these sources. Try refreshing the outlook.</div>}
      {displayMonths.length > 0 && <section className="seasonal-months" aria-labelledby="seasonal-months-title">
        <div className="seasonal-section-heading">
          <div>
            <p className="seasonal-eyebrow">Month by month</p>
            <h2 id="seasonal-months-title">Your month-by-month outlook</h2>
          </div>
          <span className="seasonal-tap-hint">Select a month to compare systems</span>
        </div>

        <div className="seasonal-month-grid">
          {displayMonths.map((month) => <MonthCard
            key={month.month}
            month={month}
            models={availableModels}
            expanded={expanded === month.month}
            onToggle={() => setExpanded(expanded === month.month ? null : month.month)}
          />)}
        </div>
      </section>}

      {displayMonths.some((month) => month.tempMean !== null) && <section className="seasonal-bars" aria-labelledby="seasonal-bars-title">
        <p className="seasonal-eyebrow">At a glance</p>
        <h2 id="seasonal-bars-title">Temperature anomaly by model</h2>
        <p className="seasonal-chart-caption" id="seasonal-chart-help">Above the line is warmer; below is cooler. Select a month to see exact values.</p>
        <div className="seasonal-chart-scroll" tabIndex={0} role="region" aria-label="Monthly temperature comparison" aria-describedby="seasonal-chart-help">
          <div className="seasonal-bar-chart">
            {displayMonths.map((month) => <button type="button" key={month.month} className={`seasonal-bar-col ${expanded === month.month ? 'is-selected' : ''}`}
              aria-label={`${month.label}: ${month.tempMean === null ? 'temperature unavailable' : `${month.tempMean >= 0 ? '+' : ''}${month.tempMean.toFixed(1)} degrees Celsius from average`}. Show forecast details.`}
              onClick={() => {
                setExpanded(month.month);
                document.getElementById(`seasonal-month-${month.month}`)?.focus({ preventScroll: true });
                document.getElementById(`seasonal-month-${month.month}`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
              }}>
              <span className="seasonal-bar-month">{new Date(`${month.month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/London' })}</span>
              <div className="seasonal-bar-group" aria-hidden="true">
                {availableModels.map((m) => {
                  const val = month.tempAnomalies.get(m.id);
                  if (val === undefined) return null;
                  return <div key={m.id} className="seasonal-bar-wrap">
                    <div className={`seasonal-bar ${val >= 0 ? 'seasonal-bar--warm' : 'seasonal-bar--cool'}`}
                      style={{ height: `${Math.max(2, Math.abs(val) / chartMax * 62)}px`, backgroundColor: m.colour }} />
                  </div>;
                })}
              </div>
              <span className={`seasonal-bar-mean ${month.tempMean !== null && month.tempMean >= 0.5 ? 'warm' : month.tempMean !== null && month.tempMean <= -0.5 ? 'cool' : ''}`}>
                {month.tempMean === null ? '—' : `${month.tempMean >= 0 ? '+' : ''}${month.tempMean.toFixed(1)}°C`}
              </span>
            </button>)}
          </div>
        </div>
        <div className="seasonal-bar-legend">
          {availableModels.map((m) => <span key={m.id}><span className="seasonal-chip-dot" style={{ backgroundColor: m.colour }} />{m.label}</span>)}
        </div>
        <p className="seasonal-chart-caption">Values below the chart are the mean of the available systems for each month.</p>
      </section>}

      <details className="seasonal-method">
        <summary><span className="seasonal-info-mark" aria-hidden="true">i</span>About this seasonal outlook<span className="seasonal-disclosure" aria-hidden="true">+</span></summary>
        <div>
          <p>SEAS5 supplies monthly forecasts for up to seven months. EC46 supplies weekly forecasts for up to 46 days; available upcoming weeks are grouped by their start month. Both are ECMWF systems, so agreement is not a comparison of independent forecast centres.</p>
          <p>Temperature differences are in °C. Rainfall differences and mean rainfall are shown in mm/week; SEAS5 monthly rainfall is converted to a weekly equivalent using the number of days in each month. EC46 may cover only part of a month. The mean gives equal weight to each available system, and the overall signal gives equal weight to each available month.</p>
          <p>Agreement describes the direction of the temperature difference across available systems, not forecast certainty. SEAS5 includes the whole current month; the EC46 comparison includes only upcoming weekly periods. Forecasts become less certain further ahead.</p>
          <p>Seasonal forecasts describe broad tendencies, not day-to-day weather. A "warmer than average" month may still contain cold spells. Use alongside the shorter-range forecast for timing.</p>
        </div>
      </details>

      <p className="seasonal-source-note">
        Forecast data from <a href="https://open-meteo.com/en/docs/seasonal-forecast-api" target="_blank" rel="noopener noreferrer">Open-Meteo Seasonal API</a>.
        {data.fetchedAt && <> Last updated {new Date(data.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.</>}
      </p>
    </>}
  </div>;
}

function MonthCard({ month, models, expanded, onToggle }: {
  month: SeasonalMonth;
  models: typeof SEASONAL_MODELS;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detailId = useId();
  const tempClass = month.tempMean !== null
    ? month.tempMean >= 0.5 ? 'warm' : month.tempMean <= -0.5 ? 'cool' : 'neutral'
    : 'neutral';
  const precipClass = month.precipMean !== null
    ? month.precipMean >= 1 ? 'wet' : month.precipMean <= -1 ? 'dry' : 'neutral'
    : 'neutral';

  return <div id={`seasonal-month-${month.month}`} tabIndex={-1} className={`seasonal-month ${expanded ? 'is-expanded' : ''}`}>
    <button type="button" className="seasonal-month-header" onClick={onToggle} aria-expanded={expanded} aria-controls={detailId}>
      <span className="seasonal-month-title">
        <span className="seasonal-month-label">{month.label}</span>
        <span className="seasonal-month-badges">
          <span className={`seasonal-badge seasonal-badge--${tempClass}`}>
            <WeatherIcon name="sun" />{tempSignal(month.tempMean)}
          </span>
          <span className={`seasonal-badge seasonal-badge--${precipClass}`}>
            <WeatherIcon name="drop" />{precipSignal(month.precipMean)}
          </span>
        </span>
      </span>
      <span className="seasonal-month-quick">
        {month.tempMean !== null && <span className={`seasonal-anomaly seasonal-anomaly--${tempClass}`}>
          {month.tempMean >= 0 ? '+' : ''}{month.tempMean.toFixed(1)}°C
        </span>}
        <span className={`seasonal-agreement seasonal-agreement--${month.tempAgreement}`}>
          {month.tempAnomalies.size < 2 ? `${systemCountLabel(month.tempAnomalies.size)}` : `${month.tempAgreement === 'none' ? 'Mixed' : month.tempAgreement} agreement`}
        </span>
      </span>
      <span className="seasonal-expand-icon" aria-hidden="true">{expanded ? '−' : '+'}</span>
    </button>

    <div id={detailId} hidden={!expanded} className="seasonal-month-detail">
      <div className="seasonal-detail-grid">
        <div className="seasonal-detail-col">
          <h4><WeatherIcon name="sun" />Temperature</h4>
          {models.map((m) => {
            const val = month.tempAnomalies.get(m.id);
            return <div key={m.id} className="seasonal-model-row">
              <span className="seasonal-chip-dot" style={{ backgroundColor: m.colour }} />
              <span className="seasonal-model-name">{m.label}</span>
              <span className={`seasonal-model-value ${val !== undefined && val >= 0.5 ? 'warm' : val !== undefined && val <= -0.5 ? 'cool' : ''}`}>
                {val !== undefined ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}°C` : '—'}
              </span>
            </div>;
          })}
          <div className="seasonal-model-row seasonal-model-row--mean">
            <span />
            <span className="seasonal-model-name">Available-system mean</span>
            <span className={`seasonal-model-value ${month.tempMean !== null && month.tempMean >= 0.5 ? 'warm' : month.tempMean !== null && month.tempMean <= -0.5 ? 'cool' : ''}`}>
              {month.tempMean !== null ? `${month.tempMean >= 0 ? '+' : ''}${month.tempMean.toFixed(1)}°C` : '—'}
            </span>
          </div>
        </div>
        <div className="seasonal-detail-col">
          <h4><WeatherIcon name="drop" />Rainfall · mm/week</h4>
          {models.map((m) => {
            const anomaly = month.precipAnomalies.get(m.id);
            const total = month.precipTotals.get(m.id);
            return <div key={m.id} className="seasonal-model-row">
              <span className="seasonal-chip-dot" style={{ backgroundColor: m.colour }} />
              <span className="seasonal-model-name">{m.label}</span>
              <span className={`seasonal-model-value ${anomaly !== undefined && anomaly >= 1 ? 'wet' : anomaly !== undefined && anomaly <= -1 ? 'dry' : ''}`}>
                {anomaly !== undefined ? `${anomaly >= 0 ? '+' : ''}${anomaly.toFixed(1)} mm/wk` : '—'}
                {total !== undefined && <small> ({total.toFixed(0)} mm)</small>}
              </span>
            </div>;
          })}
          <div className="seasonal-model-row seasonal-model-row--mean">
            <span />
            <span className="seasonal-model-name">Available-system mean</span>
            <span className={`seasonal-model-value ${month.precipMean !== null && month.precipMean >= 1 ? 'wet' : month.precipMean !== null && month.precipMean <= -1 ? 'dry' : ''}`}>
              {month.precipMean !== null ? `${month.precipMean >= 0 ? '+' : ''}${month.precipMean.toFixed(1)} mm/wk` : '—'}
            </span>
          </div>
        </div>
      </div>
      <p className="seasonal-detail-note">Rainfall values are weekly equivalents; brackets show mean weekly rainfall. A dash means this system has no data for this month.</p>
    </div>
  </div>;
}

function systemCountLabel(count: number) { return count === 0 ? 'Awaiting data' : `${count} ${count === 1 ? 'system' : 'systems'}`; }
