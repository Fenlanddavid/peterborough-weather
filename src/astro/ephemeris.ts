/** Angles at this module boundary are degrees; illumination is a 0–1 fraction.
 * Peterborough 52.5736 N, -0.2400 E, elevation 10 m MSL; height above ground 0 m.
 * Mathematical unobstructed horizon. Rise/set uses upper limb + standard refraction;
 * twilight and position samples use geometric centre altitudes without refraction.
 */
import { Body, Observer, Equator, Horizon, Illumination, MoonPhase, SearchRiseSet, SearchAltitude, Seasons, SearchLocalSolarEclipse, NextLocalSolarEclipse, SearchLunarEclipse, NextLunarEclipse } from 'astronomy-engine';
import { addDays, HOUR, localDate, localInstant } from '../data/contracts.ts';
export const OBSERVER = new Observer(52.5736, -0.2400, 10);
export interface AstroProvenance {
  provider: 'Astronomy Engine'; modelId: '2.1.19'; issuedAt: null; fetchedAt: null; sourceTime: null;
  validFrom: number; validTo: number; units: Record<string, string>; coverage: string;
  freshness: 'calculated'; error: null;
}
function astroProvenance(start: number, end = start): AstroProvenance {
  return { provider: 'Astronomy Engine', modelId: '2.1.19', issuedAt: null, fetchedAt: null, sourceTime: null, validFrom: start, validTo: end, units: { angles: 'degrees', illumination: 'fraction', magnitude: 'apparent V magnitude', time: 'UTC epoch milliseconds' }, coverage: 'Local calculation, not fetched data; 52.5736N, -0.2400E, 10m MSL, mathematical horizon; Europe/London display', freshness: 'calculated', error: null };
}
export interface Interval { start: number; end: number }
export interface SkySample { time: number; sunAltitude: number; moonAltitude: number; illumination: number; provenance?: AstroProvenance }
export interface Darkness { eveningDate: string; start: number; end: number; sunset: number | null; sunrise: number | null; civil: Interval | null; nautical: Interval | null; astronomical: Interval | null; provenance: AstroProvenance }
export function position(body: Body, time: number) {
  const date = new Date(time);
  const eq = Equator(body, date, OBSERVER, true, true);
  return Horizon(date, OBSERVER, eq.ra, eq.dec); // degrees, no refraction
}
export function nightBounds(eveningDate: string): Interval { return { start: localInstant(eveningDate, 12), end: localInstant(addDays(eveningDate, 1), 12) }; }
function riseSet(body: Body, direction: number, start: number, end: number) {
  const event = SearchRiseSet(body, OBSERVER, direction, new Date(start), (end - start) / (24 * HOUR), 0)?.date.getTime() ?? null;
  return event !== null && event < end ? event : null;
}
export function darknessTimes(eveningDate: string): Darkness {
  const { start, end } = nightBounds(eveningDate);
  const threshold = (altitude: number): Interval | null => {
    const dusk = SearchAltitude(Body.Sun, OBSERVER, -1, new Date(start), (end - start) / (24 * HOUR), altitude)?.date.getTime();
    if (dusk === undefined || dusk >= end) return null;
    const dawn = SearchAltitude(Body.Sun, OBSERVER, 1, new Date(dusk + 1000), (end - dusk) / (24 * HOUR), altitude)?.date.getTime();
    return dawn === undefined || dawn >= end ? null : { start: dusk, end: dawn };
  };
  return { eveningDate, start, end, sunset: riseSet(Body.Sun, -1, start, end), sunrise: riseSet(Body.Sun, 1, start, end), civil: threshold(-6), nautical: threshold(-12), astronomical: threshold(-18), provenance: astroProvenance(start, end) };
}
export function nightTimeline(eveningDate: string): SkySample[] {
  const { start, end } = nightBounds(eveningDate);
  const samples: SkySample[] = [];
  for (let time = start; time <= end; time += 10 * 60_000) samples.push({ time, sunAltitude: position(Body.Sun, time).altitude, moonAltitude: position(Body.Moon, time).altitude, illumination: Illumination(Body.Moon, new Date(time)).phase_fraction, provenance: astroProvenance(time) });
  return samples;
}
export function moonEvents(eveningDate: string) {
  const { start, end } = nightBounds(eveningDate);
  const headlineTime = localInstant(eveningDate, 22);
  const phase = MoonPhase(new Date(headlineTime)); // elongation degrees 0–360
  const waxing = phase < 180;
  const illumination = Illumination(Body.Moon, new Date(headlineTime)).phase_fraction;
  const label = phase < 5 || phase > 355 ? 'New Moon' : phase < 85 ? 'Waxing crescent' : phase <= 95 ? 'First Quarter' : phase < 175 ? 'Waxing gibbous' : phase <= 185 ? 'Full Moon' : phase < 265 ? 'Waning gibbous' : phase <= 275 ? 'Last Quarter' : 'Waning crescent';
  return { rise: riseSet(Body.Moon, 1, start, end), set: riseSet(Body.Moon, -1, start, end), headlineTime, illumination, phaseDegrees: phase, waxing, label, provenance: astroProvenance(start, end) };
}
export function observingNight(time: number): string {
  const date = localDate(time);
  const previous = addDays(date, -1);
  const sunrise = darknessTimes(previous).sunrise;
  return sunrise !== null && time < sunrise && time >= localInstant(date, 0) ? previous : date;
}
export function moonAboveHorizon(time: number): boolean {
  const altitude = position(Body.Moon, time).altitude;
  if (altitude >= 0) return true;
  if (altitude < -1.2) return false;
  // Near the horizon retain the library's upper-limb/refraction convention. A centre
  // just below 0° can still have a visible limb. Search at most the preceding hour.
  const set = riseSet(Body.Moon, -1, time - HOUR, time + 1);
  return set === null;
}
export function moonBelowThroughout(interval: Interval): boolean {
  if (moonAboveHorizon(interval.start) || moonAboveHorizon(interval.end)) return false;
  return SearchRiseSet(Body.Moon, OBSERVER, 1, new Date(interval.start), (interval.end - interval.start) / (24 * HOUR), 0) === null;
}
export function direction(azimuthDegrees: number): string { return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(azimuthDegrees / 45) % 8]; }
export interface PlanetVisibility { body: string; start: number; end: number; highestAltitude: number; highestTime: number; azimuthDegrees: number; magnitude: number; rise: number | null; set: number | null; provenance: AstroProvenance }
export function planetVisibility(eveningDate: string, dark = darknessTimes(eveningDate).nautical): PlanetVisibility[] {
  if (!dark) return [];
  const bounds = nightBounds(eveningDate);
  return [Body.Mercury, Body.Venus, Body.Mars, Body.Jupiter, Body.Saturn].flatMap(body => {
    let best = dark.start;
    for (let t = dark.start; t <= dark.end; t += 5 * 60_000) if (position(body, t).altitude > position(body, best).altitude) best = t;
    // Ternary refinement to <1 second on the selected five-minute bracket.
    let lo = Math.max(dark.start, best - 5 * 60_000); let hi = Math.min(dark.end, best + 5 * 60_000);
    while (hi - lo > 1000) {
      const a = lo + (hi - lo) / 3; const b = hi - (hi - lo) / 3;
      if (position(body, a).altitude < position(body, b).altitude) lo = a; else hi = b;
    }
    const highestTime = (lo + hi) / 2;
    const p = position(body, highestTime);
    if (p.altitude <= 10) return [];
    return [{ body, start: dark.start, end: dark.end, highestAltitude: p.altitude, highestTime, azimuthDegrees: p.azimuth, magnitude: Illumination(body, new Date(highestTime)).mag, rise: riseSet(body, 1, bounds.start, bounds.end), set: riseSet(body, -1, bounds.start, bounds.end), provenance: astroProvenance(dark.start, dark.end) }];
  });
}
export function seasonalEvents(year: number) {
  const s = Seasons(year);
  return [{ name: 'March equinox', time: s.mar_equinox.date.getTime() }, { name: 'June solstice', time: s.jun_solstice.date.getTime() }, { name: 'September equinox', time: s.sep_equinox.date.getTime() }, { name: 'December solstice', time: s.dec_solstice.date.getTime() }].map(e => ({ ...e, provenance: astroProvenance(e.time) }));
}
export interface EclipseCircumstances { kind: string; body: 'Sun' | 'Moon'; peak: number; visiblePortions: { label: string; start: number; end: number }[]; provenance: AstroProvenance }
/** Refine horizon-limited visible eclipse segments. Lunar contacts derive from semi-durations. */
function aboveHorizon(body: Body, interval: Interval): Interval[] {
  const pieces: Interval[] = [];
  let start: number | null = position(body, interval.start).altitude > 0 ? interval.start : null;
  for (let t = interval.start; t < interval.end; t += 60_000) {
    const next = Math.min(interval.end, t + 60_000);
    const a = position(body, t).altitude > 0; const b = position(body, next).altitude > 0;
    if (a !== b) {
      let lo = t; let hi = next;
      while (hi - lo > 1000) { const mid = (lo + hi) / 2; if ((position(body, mid).altitude > 0) === a) lo = mid; else hi = mid; }
      if (b) start = (lo + hi) / 2; else { if (start !== null) pieces.push({ start, end: (lo + hi) / 2 }); start = null; }
    }
  }
  if (start !== null) pieces.push({ start, end: interval.end });
  return pieces;
}
export function eclipseCircumstances(from: number): EclipseCircumstances[] {
  const limit = new Date(from); limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  const end = limit.getTime();
  const events: EclipseCircumstances[] = [];
  for (let solar = SearchLocalSolarEclipse(new Date(from), OBSERVER); solar.peak.time.date.getTime() < end; solar = NextLocalSolarEclipse(solar.peak.time, OBSERVER)) {
    const portions = aboveHorizon(Body.Sun, { start: solar.partial_begin.time.date.getTime(), end: solar.partial_end.time.date.getTime() });
    if (portions.length) events.push({ kind: solar.kind, body: 'Sun', peak: solar.peak.time.date.getTime(), visiblePortions: portions.map(p => ({ ...p, label: 'Local partial phase above horizon' })), provenance: astroProvenance(solar.partial_begin.time.date.getTime(), solar.partial_end.time.date.getTime()) });
  }
  for (let lunar = SearchLunarEclipse(new Date(from)); lunar.peak.date.getTime() < end; lunar = NextLunarEclipse(lunar.peak)) {
    const peak = lunar.peak.date.getTime();
    const visiblePortions = [{ label: 'Penumbral phase', duration: lunar.sd_penum }, { label: 'Partial phase', duration: lunar.sd_partial }, { label: 'Total phase', duration: lunar.sd_total }].flatMap(p => p.duration > 0 ? aboveHorizon(Body.Moon, { start: peak - p.duration * 60_000, end: peak + p.duration * 60_000 }).map(v => ({ ...v, label: p.label })) : []);
    if (visiblePortions.length) events.push({ kind: lunar.kind, body: 'Moon', peak, visiblePortions, provenance: astroProvenance(peak - lunar.sd_penum * 60_000, peak + lunar.sd_penum * 60_000) });
  }
  return events.sort((a, b) => a.peak - b.peak);
}
