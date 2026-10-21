import { useMemo } from 'react';
import { getRelevantShowers } from '../astro/events';
import { planetVisibility, seasonalEvents, eclipseCircumstances, direction, moonBelowThroughout } from '../astro/ephemeris';
import type { Darkness } from '../astro/ephemeris';
import { fetchIssElements, predictIssPasses } from '../astro/iss';
import { useVisibleResource } from '../hooks/useVisibleResource';
import type { ObservingWindow } from '../sky/scoring';
import { HOUR, localTime } from '../data/contracts';
const ukDateTime = (time: number) => new Date(time).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ukDateTimeFull = (time: number) => new Date(time).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function SkyEventsPanel({ date, darkness, best, moonIllumination, now }: { date: string; darkness: Darkness; best: ObservingWindow | null; moonIllumination: number; now: number }) {
  const planets = useMemo(() => planetVisibility(date), [date]);
  const year = Number(date.slice(0, 4));
  const seasons = useMemo(() => [...seasonalEvents(year), ...seasonalEvents(year + 1)].filter(e => e.time >= now && e.time < now + 366 * 24 * HOUR), [year, now]);
  const eclipses = useMemo(() => eclipseCircumstances(now), [now]);
  const elements = useVisibleResource('iss:elements', 12 * HOUR, fetchIssElements);
  const passes = useMemo(() => elements?.data ? predictIssPasses(elements.data, now) : [], [elements, now]);
  const showers = getRelevantShowers(date);
  const month = Number(date.slice(5, 7));
  const zodiacal = [2, 3, 4, 9, 10].includes(month) && best && darkness.astronomical && Math.min(best.end, darkness.astronomical.end) - Math.max(best.start, darkness.astronomical.start) >= 2 * HOUR && moonBelowThroughout({ start: Math.max(best.start, darkness.astronomical.start), end: Math.min(best.end, darkness.astronomical.end) });
  const staleElements = elements?.data && now - elements.data.epoch > 72 * HOUR;
  return <section className="nightsky-events" aria-labelledby="nightsky-events-title"><h2 id="nightsky-events-title">Sky events</h2>

    <details className="sky-events-expandable"><summary className="sky-events-summary">Planets visible tonight · {planets.length || 'none'}</summary>
      {!planets.length ? <p>No planets above 10° during nautical darkness.</p> : <div className="sky-planets">{planets.map(p => <div className="sky-planet-card" key={p.body}>
        <strong>{p.body}</strong>
        <span>Highest {p.highestAltitude.toFixed(0)}° {direction(p.azimuthDegrees)} at {localTime(p.highestTime)}</span>
        <span>Magnitude {p.magnitude.toFixed(1)}</span>
        <span>{p.rise === null ? 'Already up' : `Rise ${localTime(p.rise)}`} · {p.set === null ? 'Does not set' : `Set ${localTime(p.set)}`}</span>
      </div>)}</div>}
    </details>

    {showers.map(s => <article className="nightsky-shower" key={s.name}><strong>{s.name}</strong><p>Approximate annual peak: {s.peakLabel}. Moon at 22:00: {Math.round(moonIllumination * 100)}% illuminated. {best ? `Weather window ${localTime(best.start)}–${localTime(best.end)}.` : 'No eligible weather window.'}</p><p>{s.tip} Ideal rate: {s.zhr}/hour; local rates can be lower.</p></article>)}

    <details className="sky-events-expandable"><summary className="sky-events-summary">Equinoxes and solstices</summary>
      <div className="sky-seasons">{seasons.map(e => <div className="sky-season-card" key={e.name + e.time}><strong>{e.name}</strong><span>{ukDateTimeFull(e.time)}</span></div>)}</div>
    </details>

    {!eclipses.length ? null : <details className="sky-events-expandable"><summary className="sky-events-summary">Eclipses · next 12 months</summary>
      <ul>{eclipses.map(e => <li key={e.peak}>{e.kind} {e.body === 'Moon' ? 'lunar' : 'solar'} eclipse · {ukDateTimeFull(e.peak)}{e.visiblePortions.map(p => <span key={p.label + p.start}><br />{p.label}: {ukDateTime(p.start)}–{localTime(p.end)}</span>)}</li>)}</ul>
    </details>}

    <div className="sky-iss-section">
      <h3>ISS passes</h3>
      {staleElements ? <p className="sky-iss-stale">Orbital data is outdated — predictions unavailable.</p>
        : !passes.length ? <p>No visible passes in the next few days.</p>
        : <div className="sky-iss-grid">{passes.slice(0, 8).map(p => <div className="sky-iss-card" key={p.start}>
          <div className="sky-iss-date">{ukDateTime(p.start)}</div>
          <div className="sky-iss-details">
            <span className="sky-iss-peak">{p.elevationDegrees.toFixed(0)}° peak</span>
            <span className="sky-iss-dir">{direction(p.azimuthDegrees)}</span>
          </div>
          <div className="sky-iss-times">{localTime(p.start)} – {localTime(p.end)} · brightest {localTime(p.peak)}</div>
        </div>)}</div>}
    </div>

    <p>{zodiacal ? 'Zodiacal light: a moonless dark window lasts at least two hours. Look along the ecliptic near the western horizon at dusk (spring) or eastern horizon at dawn (autumn).' : ''}</p>
  </section>;
}
