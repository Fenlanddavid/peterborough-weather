import { useMemo, useRef, useState } from 'react';
import type { CachedRun } from '../types';
import type { EnsembleIndex } from '../forecast/events';
import type { ForecastContext } from '../forecast/signals';
import { windOutlook } from '../metrics/forecastMessages';
import { formatPrecipitation } from '../metrics/hourlyWeather';
import { DEFAULT_VERSION } from '../forecast/policy';
import { eventPercent } from '../data/contracts';
import { buildForecastSignals } from '../forecast/signals';
import { buildForecastBriefing } from '../metrics/forecastSummary';
import { buildHourlySlot } from '../metrics/hourlySlot';
import { getHourlyForecastTimes, getLocalDate, useLocalNow } from '../hooks/useLocalTime';
import { HOUR } from '../data/contracts';
import { SkyIllustration, WeatherIcon } from '../components/WeatherIcon';
import { MonthlyOutlook } from '../components/MonthlyOutlook';
import { RegimeBadge } from '../components/RegimeBadge';

interface Props { runs: CachedRun[]; loading: boolean; hasError: boolean; lastUpdated?: number | null; ensembles: EnsembleIndex; context?: ForecastContext; sourceNotes?: string[] }
const number = (v: number | null) => v === null ? '—' : Math.round(v);
export function Forecast({ runs, lastUpdated = null, ensembles, context, sourceNotes = [] }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const now = useLocalNow();
  const hour = Math.floor(now.getTime() / HOUR) * HOUR;
  const signals = useMemo(() => buildForecastSignals(runs, hour, context), [runs, hour, context]);
  const briefing = useMemo(() => buildForecastBriefing(runs, new Date(hour), { wholeToday: true, ensembles, context }), [runs, hour, ensembles, context]);
  const day = briefing.days[selectedIndex];
  const hourlyScroll = useRef<HTMLDivElement>(null);
  const hourly = useMemo(() => getHourlyForecastTimes(day.date, now).map(time => buildHourlySlot(signals, time, ensembles)), [day.date, now, signals, ensembles]);
  const windyDays = briefing.days.flatMap(d => {
    const text = windOutlook(d);
    return text === null ? [] : [{ date: d.date, label: d.label, text }];
  });
  const snowyDays = briefing.days.filter(d => d.snowCm !== null && d.snowCm > 0);
  const condition = day.condition;
  return <div className="view-forecast">
    <div className="forecast-intro"><div><p className="eyebrow">A little local perspective</p><h1>Your weather, at a glance.</h1><p>A clearer outlook for the Savorys and the days ahead.</p></div></div>
    {windyDays.length > 0 && <div className="forecast-warning wind-warning" role="status"><WeatherIcon name="wind" /><div><h2>Strong-wind outlook</h2><ul>{windyDays.map(d => <li key={d.date}>{d.label} · <strong>{d.text}</strong></li>)}</ul></div></div>}
    {snowyDays.length > 0 && <div className="forecast-warning snow-warning" role="status"><WeatherIcon name="snow" /><div><h2>Snow outlook</h2><p>Some forecasts indicate snowfall in the next 7 days; settling is uncertain.</p><ul>{snowyDays.map(d => <li key={d.date}>{d.label} · <strong>{d.snowCm! < 0.1 ? '<0.1' : d.snowCm!.toFixed(1)} cm</strong></li>)}</ul></div></div>}
    <div className="forecast-overview">
      <section className={`outlook-card ${day.high === null ? 'outlook-card--pending' : ''}`}><div className="outlook-topline"><span className="eyebrow">{day.label}'s outlook</span></div>
        <div className="outlook-main"><div className="outlook-weather"><span className="daily-high-label">Daily high</span><div className="outlook-temperature">{number(day.high)}<span>°C</span></div><h2>{condition.label}</h2><p>{day.high === null ? 'Your daily outlook will appear here.' : <>Low of {number(day.low)}° · {day.rainMm === null || day.rainHours < day.expectedHours ? 'Rainfall data incomplete or unavailable' : day.rainMm >= 0.5 ? 'Keep an umbrella handy' : 'A mostly dry day'}</>}</p></div><SkyIllustration wet={day.rainMm !== null && day.rainMm >= 0.5} /></div>
        <div className="outlook-stats"><div><WeatherIcon name="drop" /><span>Rainfall<strong>{formatPrecipitation(day.rainMm).replace(/ mm$/, '')} <small>mm</small></strong></span></div><div><WeatherIcon name="wind" /><span>Average wind<strong>{number(day.windMph)} <small>mph</small></strong></span></div><div><WeatherIcon name="wind" /><span>Peak gust<strong>{number(day.gustMph)} <small>mph</small></strong></span></div></div>
      </section>
      <aside className="week-briefing"><div className="briefing-heading"><span className="briefing-icon"><WeatherIcon name="sun" /></span><span className="eyebrow">The bigger picture</span></div><h2>A look at <br />the week ahead.</h2><p>{briefing.overview}</p></aside>
    </div>
    <MonthlyOutlook today={getLocalDate(now)} refreshKey={lastUpdated} /><RegimeBadge />
    <section className="weekly-section"><div className="section-heading"><h2>The next 7 days</h2><span><span className="desktop-hint">Select a day to explore</span><span className="mobile-hint">Swipe &amp; select</span> <WeatherIcon name="arrow" /></span></div><div className="day-cards">{briefing.days.map((d, i) => {
      const c = d.condition;
      return <button type="button" className={`day-card ${i === selectedIndex ? 'day-card--selected' : ''}`} key={d.date} aria-pressed={i === selectedIndex} onClick={() => { setSelectedIndex(i); hourlyScroll.current?.scrollTo(0, 0); }}><span className="day-name">{d.label}</span><span className="day-date">{d.date}</span><WeatherIcon name={c.icon ?? 'calendar'} /><span className="day-card-condition">{c.label}</span><span className="day-card-temps"><strong>{number(d.high)}°</strong><span>{number(d.low)}°</span></span><span className="day-card-rain"><WeatherIcon name="drop" />{formatPrecipitation(d.rainMm)}</span><span className="day-card-wind"><WeatherIcon name="wind" />{number(d.windMph)} mph</span></button>;
    })}</div></section>
    <section className="hourly-section">
      <div className="section-heading"><div><p className="eyebrow">A closer look</p><h2>{day.label}, hour by hour</h2></div><span>Local time · °C</span></div>
      <div className="hourly-scroll" ref={hourlyScroll} tabIndex={0} role="region" aria-label="Hourly forecast; scroll horizontally for more hours"><div className="hourly-grid">
        {hourly.map(h => <div className="hourly-item" key={h.start} role="group" aria-label={h.accessible.interval}>
          <span className="hourly-time">{h.display.time}</span>
          <span className={`hourly-condition hourly-condition--${h.condition.icon ?? 'unknown'}`} role="img" aria-label={h.condition.description ?? h.condition.label} title={h.condition.label}>{h.condition.icon ? <WeatherIcon name={h.condition.icon} /> : <span>—</span>}</span>
          <strong><span aria-hidden="true">{h.display.temperature}</span><span className="hourly-sr-only">{h.accessible.temperature}</span></strong>
          <span className="hourly-rain"><WeatherIcon name="drop" /><span aria-hidden="true">{h.display.precipitation}</span><span className="hourly-sr-only">{h.accessible.precipitation}</span></span>
          <span className="hourly-wind"><span aria-hidden="true">Wind {h.display.wind}</span><span className="hourly-sr-only">{h.accessible.wind}</span></span>
          <span className="hourly-gust"><span aria-hidden="true">Gust {h.display.gust}</span><span className="hourly-sr-only">{h.accessible.gust}</span></span>
          {h.start === h.rainWindow.start && h.rainWindow.value !== null && <span className="hourly-window">{(h.rainWindow.end - h.rainWindow.start) / HOUR}h: {h.rainWindow.basis === 'ensemble-probability' ? 'rain probability' : 'wet agreement'} {eventPercent(h.rainWindow.value)}</span>}
          {h.condition.risks?.map(r => <span className="hourly-risk" key={r.label}>{r.label} risk</span>)}
          {h.cached && <span className="hourly-cached">Cached</span>}
        </div>)}
      </div></div>
      <p className="hourly-caption">Temperature and wind are at the shown time. Precipitation and gusts cover the following hour. Rain windows respect three- or six-hour native timing. Daily rain totals use ensemble expectations where available; hourly amounts use the deterministic blend, so these different statistics may not add to the same total.</p>
    </section>
    <details className="forecast-note"><summary>Forecast sources and learning</summary><p>Local policy: {context?.policy?.rules.some(r => r.location === 'peterborough') ? context.policy.version : DEFAULT_VERSION}. Published revision: {context?.policy?.version ?? DEFAULT_VERSION}. Equal-family defaults and the optional Met Office split are configured heuristics. Measured accuracy improvement has not yet been established.</p>
      <p>No validated numerical radar nowcast is connected. The immediate forecast uses fresh model output; a radar image would not provide a numerical nowcast.</p>
      {context?.operational && <p>The latest UKV forecast product is separate from archived Single Runs. Its response issue time is not supplied; provider metadata is a reference only. Repeated identical downloads retain their original first-seen time.</p>}
      {context?.metOffice && <p>Met Office nearest site {context.metOffice.site.id}: {context.metOffice.site.distanceKm.toFixed(1)} km from the requested point, elevation {context.metOffice.site.elevation ?? 'unknown'} m. Requested {context.metOffice.requested.latitude}, {context.metOffice.requested.longitude}; returned {context.metOffice.site.latitude}, {context.metOffice.site.longitude}. Source percentiles remain separate from the ensemble mixture. Issue time: {context.metOffice.issuedAt === null ? 'not supplied' : new Date(context.metOffice.issuedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}; fetched {new Date(context.metOffice.fetchedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}. Only compatible values within six hours of source recency contribute.</p>}
      {sourceNotes.map(note => <p key={note}>{note}</p>)}
      <p>Issue times belong to the models; availability belongs to the provider; the header reports the last check. New checks do not reissue old output. Older output is explicitly marked as cached.</p>
      <p>This uses Environment Agency rainfall data from the real-time data API (Beta). Measured amounts remain provisional until their interval definition is validated.</p>
      <p>Wittering is regional station evidence. Central Peterborough corrections require representative local observations. Rainfall and gust learning stay disabled where measurement intervals are incompatible. <a href={`${import.meta.env.BASE_URL}data/forecast/diagnostics.json`}>Automatic collection and policy diagnostics</a>.</p>
    </details>
    <p className="forecast-note"><span className="note-mark">i</span> Based on available ECMWF, GFS and UKMO forecasts. See Trends for how the models have shifted run to run.</p>
  </div>;
}
