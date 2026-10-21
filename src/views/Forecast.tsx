import { useMemo, useRef, useState } from 'react';
import type { CachedRun } from '../types';
import type { EnsembleIndex } from '../forecast/events';
import { PRECIP_3H, FROST, GUST, SNOW } from '../forecast/events';
import { buildForecastSignals } from '../forecast/signals';
import { buildForecastBriefing } from '../metrics/forecastSummary';
import { getHourlyCondition } from '../metrics/hourlyWeather';
import { getHourlyForecastTimes, getLocalDate, useLocalNow } from '../hooks/useLocalTime';
import { dayWindow, eventPercent, frostWindow, HOUR, localTime, msToMph, utc } from '../data/contracts';
import { WeatherIcon } from '../components/WeatherIcon';
import { EventEvidence } from '../components/ForecastEvidence';
import { MonthlyOutlook } from '../components/MonthlyOutlook';
import { RegimeBadge } from '../components/RegimeBadge';

interface Props { runs: CachedRun[]; loading: boolean; hasError: boolean; lastUpdated?: number | null; ensembles: EnsembleIndex }
const number = (v: number | null) => v === null ? '—' : Math.round(v);
export function Forecast({ runs, loading, hasError, lastUpdated = null, ensembles }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const now = useLocalNow();
  const hour = Math.floor(now.getTime() / HOUR) * HOUR;
  const signals = useMemo(() => buildForecastSignals(runs, hour), [runs, hour]);
  const briefing = useMemo(() => buildForecastBriefing(runs, new Date(hour), { wholeToday: true, ensembles }), [runs, hour, ensembles]);
  const day = briefing.days[selectedIndex];
  const hourlyScroll = useRef<HTMLDivElement>(null);
  const hourly = useMemo(() => getHourlyForecastTimes(day.date, now).map(time => {
    const instant = utc(time);
    const precipitation = signals.event(PRECIP_3H, instant, instant + 3 * HOUR, ensembles);
    return { time, instant, precipitation, condition: getHourlyCondition(signals, time, precipitation), temperature: signals.mean('temperature_2m', instant), wind: signals.mean('wind_speed_10m', instant) };
  }), [day.date, now, signals, ensembles]);
  const alerts = useMemo(() => briefing.days.flatMap(day => {
    const [start, end] = dayWindow(day.date);
    const windows = [{ spec: SNOW, start, end }, { spec: FROST, start: frostWindow(day.date)[0], end: frostWindow(day.date)[1] }, ...Array.from({ length: Math.ceil((end - start) / (6 * HOUR)) }, (_, i) => ({ spec: GUST, start: start + i * 6 * HOUR, end: start + (i + 1) * 6 * HOUR }))];
    return windows.flatMap(w => {
      if (w.end <= hour) return [];
      const support = signals.supporting(w.spec, w.start, w.end);
      if (w.start < hour + 48 * HOUR) return support.models ? [{ ...w, text: `${support.models >= 2 && support.families >= 2 ? 'Consensus outlook' : 'Isolated signal'}: ${w.spec.label} · ${support.models} supporting models / ${support.families} families` }] : [];
      const event = ensembles.event(w.spec, w.start, w.end);
      return event.value !== null && event.value >= 0.3 - 1e-12 ? [{ ...w, text: `${event.value >= 0.6 - 1e-12 ? 'Likely' : 'Possible'}: ${w.spec.label} · ${eventPercent(event.value)} uncalibrated ensemble estimate · ${event.systems.length} systems · ${event.usable}/${event.expected} members` }] : [];
    });
  }), [briefing.days, signals, ensembles, hour]);
  const condition = day.condition;
  const support = signals.support(PRECIP_3H, hour, hour + 3 * HOUR);
  const current = signals.agreement(PRECIP_3H, hour, hour + 3 * HOUR);
  return <div className="view-forecast">
    <div className="forecast-intro"><div><p className="eyebrow">A little local perspective</p><h1>Your weather, at a glance.</h1><p>A clearer outlook for the Savorys and the days ahead.</p></div></div>
    {!briefing.hasData && <p role="status" className="forecast-status">{loading ? 'Gathering your forecast…' : 'Forecast unavailable. Missing data is not a dry-weather signal.'}</p>}
    {(hasError || briefing.stale) && <p role="status" className="forecast-status">{hasError ? 'Refresh failed. Saved forecasts remain available.' : 'Model output is over 36 hours old. Saved values are shown; current recommendations exclude stale runs.'}</p>}
    {alerts.length > 0 && <details className="forecast-warning"><summary>App outlook alerts · {alerts.length} signals</summary><p>These are app outlooks, not official weather warnings. Snowfall does not imply settled snow; air frost does not guarantee ground frost.</p><ul>{alerts.map((a, i) => <li key={i}>{a.text}<br />{new Date(a.start).toLocaleDateString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })} · {localTime(a.start)}–{localTime(a.end)}</li>)}</ul></details>}
    <div className="forecast-overview">
      <section className="outlook-card"><div className="outlook-topline"><span className="eyebrow">{day.label} · {day.date}</span></div><div className="outlook-main"><div className="outlook-weather"><span className="daily-high-label">Daily high · complete model windows</span><div className="outlook-temperature">{number(day.high)}<span>°C</span></div><h2>{condition.label}</h2><p>Low {number(day.low)}°C</p></div>{condition.icon && <WeatherIcon name={condition.icon} />}</div>
        <div className="outlook-stats"><div><WeatherIcon name="drop" /><span>Expected precipitation<strong>{day.rainMm === null ? '—' : day.rainMm.toFixed(1)} <small>mm</small></strong></span></div><div><WeatherIcon name="wind" /><span>Average wind<strong>{number(day.windMph)} <small>mph</small></strong></span></div><div><WeatherIcon name="wind" /><span>Peak gust<strong>{number(day.gustMph)} <small>mph</small></strong></span></div></div>
        <p><EventEvidence event={day.precipitation} /></p>{day.precipitation.conditionalAmount !== null && <p>If wet (at least 1 mm), typically around {day.precipitation.conditionalAmount.toFixed(1)} mm.</p>}
        <details><summary>Coverage and daily detail</summary>{day.paragraphs.map(p => <p key={p}>{p}</p>)}<p>Sources: {day.precipitation.systems.join(', ') || 'none'}. Totals and extremes use complete model/member windows. Day length: {day.expectedHours} hours.</p></details>
      </section>
      <aside className="week-briefing"><p className="eyebrow">The bigger picture</p><h2>The week ahead.</h2><p>{briefing.overview}</p><p>Current wet agreement: {current.value === null ? 'unavailable' : `${eventPercent(current.value)}`} · recent-run support: {support.value === null ? 'unavailable' : `${eventPercent(support.value)}`} · at least 0.2 mm over the next 3 hours. These deterministic measures are not calibrated probabilities.</p></aside>
    </div>
    <MonthlyOutlook today={getLocalDate(now)} refreshKey={lastUpdated} /><RegimeBadge />
    <section className="weekly-section"><div className="section-heading"><h2>The next 7 days</h2><span>Select a day</span></div><div className="day-cards">{briefing.days.map((d, i) => {
      const c = d.condition;
      return <button type="button" className={`day-card ${i === selectedIndex ? 'day-card--selected' : ''}`} key={d.date} aria-pressed={i === selectedIndex} onClick={() => { setSelectedIndex(i); hourlyScroll.current?.scrollTo(0, 0); }}><span className="day-name">{d.label}</span><span className="day-date">{d.date}</span><WeatherIcon name={c.icon ?? 'calendar'} /><span className="day-card-condition">{c.label}</span><span className="day-card-temps"><strong>{number(d.high)}°</strong><span>{number(d.low)}°</span></span><span className="day-card-rain">Expected {d.rainMm === null ? '—' : d.rainMm.toFixed(1)} mm</span><small>{d.precipitation.value === null ? 'Risk unknown' : `${eventPercent(d.precipitation.value)} ${d.precipitation.basis === 'ensemble-probability' ? 'ensemble estimate' : 'wet agreement'}`} · ≥1 mm / local day</small></button>;
    })}</div></section>
    <section className="hourly-section"><div className="section-heading"><h2>{day.label}, hour by hour</h2></div><div className="hourly-scroll" ref={hourlyScroll} tabIndex={0}><div className="hourly-grid">{hourly.map(h => <div className="hourly-item" key={h.time}><span>{localTime(h.instant)}</span><span title={h.condition.label}><WeatherIcon name={h.condition.icon ?? 'calendar'} /></span><strong>{number(h.temperature)}°</strong><span>{number(h.wind === null ? null : msToMph(h.wind))} mph</span><span>{h.precipitation.value === null ? 'Risk unknown' : `${eventPercent(h.precipitation.value)}`}</span><small>{h.precipitation.basis === 'ensemble-probability' ? 'Ensemble estimate' : 'Wet agreement'}<br />≥0.2 mm / following 3h</small></div>)}</div></div><p className="hourly-caption">Rain/snow risk covers the next three hours. Open-Meteo amounts include rain and snow; displayed hourly accumulation timestamps denote the preceding interval.</p></section>
    <p className="forecast-note">Equal family weighting (ECMWF, NOAA, UKMO); UKV contributes within its available range. Weights and alert thresholds are configurable planning heuristics without demonstrated forecast skill. Trends retains its own family comparison.</p>
  </div>;
}
