import { useMemo } from 'react';
import type { CachedRun } from '../types';
import { buildForecastBriefing } from '../metrics/forecastSummary';
import type { EnsembleIndex } from '../forecast/events';
import { getLocalDate, toLocalTime, useLocalNow } from '../hooks/useLocalTime';
import { WeatherIcon, type IconName } from '../components/WeatherIcon';
import './Summary.css';

interface Props {
  runs: CachedRun[];
  loading: boolean;
  hasError: boolean;
  ensembles: EnsembleIndex;
}

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' });

export function Summary({ runs, loading, hasError, ensembles }: Props) {
  const now = useLocalNow();
  const hour = Math.floor(now.getTime() / 3600_000);
  const briefing = useMemo(() => buildForecastBriefing(runs, new Date(hour * 3600_000), { ensembles }), [runs, hour, ensembles]);
  const topics: { title: string; icon: IconName; text: string }[] = [
    { title: 'Temperatures & how they change', icon: 'sun', text: briefing.temperature },
    { title: 'Rain/snow & drier spells', icon: 'drop', text: briefing.rainfall },
    { title: 'Wind & strongest gusts', icon: 'wind', text: briefing.wind },
  ];
  if (briefing.cold) topics.push({ title: 'Cold & snowfall signals', icon: 'snow', text: briefing.cold });

  return <div className="view-summary">
    <header className="summary-intro">
      <p className="summary-eyebrow">Peterborough · The next seven days</p>
      <h1>Your forecast, in detail.</h1>
      <p>{dateLabel(getLocalDate(now))} – {dateLabel(briefing.days.at(-1)!.date)} · All times are local to Peterborough.</p>
    </header>

    {!briefing.hasData ? <div className="summary-status" role="status">
      {loading ? 'Gathering the forecast for your detailed summary…' : hasError ? 'The forecast could not be loaded. Use Refresh above to try again.' : 'No forecast data is available for the coming seven days. Use Refresh above to check again.'}
    </div> : <>
      {(hasError || briefing.stale) && <p className="summary-status" role="status">{hasError ? 'The latest refresh failed. This briefing uses the forecast data already saved on this device.' : 'Some contributing model output is more than 36 hours old. Refresh for newer forecasts.'}</p>}
      <section className="summary-lead" aria-labelledby="summary-overview-title">
        <p className="summary-eyebrow">The bigger picture</p>
        <h2 id="summary-overview-title">The week ahead</h2>
        <p>{briefing.overview}</p>
        <span>Today covers the current hour onwards; later days cover the full local day.</span>
      </section>

      <div className="summary-topics">
        {topics.map((topic) => <section className="summary-topic" key={topic.title}>
          <div className="summary-topic-heading"><WeatherIcon name={topic.icon} /><h2>{topic.title}</h2></div>
          <p>{topic.text}</p>
        </section>)}
      </div>

      <section className="summary-agreement" aria-labelledby="summary-agreement-title">
        <h2 id="summary-agreement-title">Where the forecast is less settled</h2>
        <p>{briefing.agreement}</p>
      </section>

      <section className="summary-daily" aria-labelledby="summary-daily-title">
        <div className="summary-daily-heading"><h2 id="summary-daily-title">Day by day</h2><span>Temperatures · precipitation timing · wind · model agreement</span></div>
        <div className="summary-days">
          {briefing.days.map((day) => <article className="summary-day" key={day.date}>
            <div className="summary-day-heading">
              <div><h3>{day.label}</h3><p>{dateLabel(day.date)}{day.remainingToday ? ' · From this hour onwards' : ''}</p></div>
              {day.high !== null && <span className="summary-day-temperature">{Math.round(day.high)}°<small> / {Math.round(day.low!)}°</small></span>}
            </div>
            <p className="summary-day-condition">{day.condition.label}.</p>
            {day.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </article>)}
        </div>
      </section>
      <p className="summary-method">Available ECMWF, NOAA and UKMO families receive equal total weight; UKV contributes within its actual data range. Daily totals and extremes are calculated within each complete model/member window before combining. Ensemble probabilities are uncalibrated estimates; deterministic agreement and recent-run support have separate meanings. Missing values remain unknown. {briefing.latestRun && <>Newest contributing model run: {toLocalTime(briefing.latestRun, 'short')}.</>} Explore Trends for raw run comparisons.</p>
    </>}
  </div>;
}
