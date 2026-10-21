import { useMemo } from 'react';
import { getRelevantShowers } from '../astro/events';
import { planetVisibility, seasonalEvents, eclipseCircumstances, direction, moonBelowThroughout } from '../astro/ephemeris';
import type { Darkness } from '../astro/ephemeris';
import { fetchIssElements, predictIssPasses } from '../astro/iss';
import { useVisibleResource } from '../hooks/useVisibleResource';
import { SourceDetail } from './AuroraPanel';
import type { ObservingWindow } from '../sky/scoring';
import { HOUR, localTime } from '../data/contracts';
const fullTime = (time: number) => new Date(time).toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
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
  return <section className="nightsky-events" aria-labelledby="nightsky-events-title"><h2 id="nightsky-events-title">Sky events and planets</h2>
    <h3>Planets above 10° during nautical darkness</h3>{!planets.length && <p>No qualifying planets for this interval.</p>}<ul>{planets.map(p => <li key={p.body}><strong>{p.body}</strong> · highest {p.highestAltitude.toFixed(0)}° {direction(p.azimuthDegrees)} at {localTime(p.highestTime)} · apparent magnitude {p.magnitude.toFixed(1)} · {p.rise === null ? 'no rise in noon-to-noon interval (may already be up)' : `rise ${localTime(p.rise)}`} · {p.set === null ? 'no set in this interval' : `set ${localTime(p.set)}`}</li>)}</ul>
    <h3>Meteor showers</h3>{showers.map(s => <article className="nightsky-shower" key={s.name}><strong>{s.name}</strong><p>Approximate annual peak: {s.peakLabel}; these dates are not a verified {year} peak time. Moon at 22:00: {Math.round(moonIllumination * 100)}% illuminated. {best ? `Weather window ${localTime(best.start)}–${localTime(best.end)}.` : 'No eligible weather window.'}</p><p>{s.tip} Ideal zenithal rate: {s.zhr}/hour; local rates can be lower.</p></article>)}
    <h3>Equinoxes and solstices</h3><ul>{seasons.map(e => <li key={e.name + e.time}>{e.name}: {fullTime(e.time)}</li>)}</ul>
    <h3>Locally visible eclipse portions · next 12 months</h3>{!eclipses.length && <p>No eclipse portions above the local horizon were found.</p>}<ul>{eclipses.map(e => <li key={e.peak}>{e.kind} {e.body === 'Moon' ? 'lunar' : 'solar'} eclipse · {fullTime(e.peak)}{e.visiblePortions.map(p => <p key={p.label + p.start}>{p.label}: {fullTime(p.start)}–{fullTime(p.end)}.</p>)}</li>)}</ul>
    <h3>ISS visible-segment predictions</h3><p>Observer Sun below −6°, ISS above 10°, and at least 99% of the solar disc unshadowed. Times show the visible portion; peak is within that portion. Elements expire 72 hours after epoch.</p>{elements?.data && now - elements.data.epoch > 72 * HOUR && <p role="status">Orbital elements are over 72 hours old; predictions suppressed.</p>}{passes.length ? <ul>{passes.slice(0, 12).map(p => <li key={p.start}>{fullTime(p.start)}–{localTime(p.end)} · visible peak {p.elevationDegrees.toFixed(0)}° {direction(p.azimuthDegrees)} at {localTime(p.peak)}</li>)}</ul> : <p>No eligible passes in the reliable prediction range, or elements unavailable.</p>}<SourceDetail label="CelesTrak ISS elements" result={elements} />
    <p>Orbital data: <a href="https://celestrak.org/">CelesTrak</a>; propagation: <a href="https://github.com/shashwatak/satellite-js">satellite.js 7.1.0 (MIT)</a>. Ephemerides: <a href="https://github.com/cosinekitty/astronomy">Astronomy Engine 2.1.19 (MIT)</a>.</p>
    <p>{zodiacal ? 'Zodiacal light: a moonless astronomical-dark weather window lasts at least two hours. From a very dark site, look along the ecliptic near the western dusk horizon in spring or eastern dawn horizon in autumn.' : 'Zodiacal light needs a moonless astronomical-dark window of at least two hours and a very dark site. No recommendation qualifies for the selected night.'}</p>
  </section>;
}
