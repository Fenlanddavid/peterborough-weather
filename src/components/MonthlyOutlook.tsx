import { useMonthlyOutlook } from '../hooks/useMonthlyOutlook';
import { monthlySummary, rainfallSignal, temperatureSignal } from '../metrics/monthly';
import { WeatherIcon } from './WeatherIcon';

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const weekEnd = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);

export function MonthlyOutlook({ today, refreshKey }: { today: string; refreshKey: number | null }) {
  const { data, loading, failed, refresh } = useMonthlyOutlook(today, refreshKey);
  const weeks = data?.weeks.filter((week) => week.date >= today).slice(0, 4) ?? [];
  return <section className="monthly-outlook" aria-labelledby="monthly-title" aria-busy={loading}>
    <div className="monthly-heading">
      <div><p className="eyebrow">A little further ahead</p><h2 id="monthly-title">Monthly outlook</h2></div>
      <WeatherIcon name="calendar" />
    </div>
    {weeks.length > 0 ? <>
      <p className="monthly-period">{dateLabel(weeks[0].date)} – {dateLabel(weekEnd(weeks[weeks.length - 1].date))} · {weeks.length === 4 ? 'The next four full weeks' : 'Partial outlook'}</p>
      <p className="monthly-summary">{monthlySummary(weeks)}</p>
      <div className="monthly-weeks">
        {weeks.map((week, index) => <div className="monthly-week" key={week.date}>
          <h3><span>Week {index + 1}</span>{dateLabel(week.date)} – {dateLabel(weekEnd(week.date))}</h3>
          <p>{temperatureSignal(week.temperatureAnomaly)}</p>
          <p><WeatherIcon name="drop" />{rainfallSignal(week.rainfallMm, week.rainfallAnomaly)}</p>
        </div>)}
      </div>
      <p className="monthly-note">Compared with seasonal averages. Broad regional guidance: local weather and timing become less certain further ahead.</p>
    </> : <p className="monthly-summary" role="status">{loading ? 'Gathering the longer-range outlook…' : 'The monthly outlook is unavailable just now. Try again when you’re online.'}</p>}
    {failed && weeks.length > 0 && <p className="monthly-note" role="status">Couldn’t update. Showing the saved outlook, checked {new Date(data!.fetchedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}.</p>}
    <div className="monthly-source"><a href="https://open-meteo.com/en/docs/seasonal-forecast-api" target="_blank" rel="noopener noreferrer">ECMWF long-range outlook via Open-Meteo</a><button type="button" onClick={refresh} disabled={loading}>{loading ? 'Updating…' : 'Refresh outlook'}</button></div>
  </section>;
}
