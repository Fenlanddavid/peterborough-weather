/** Lazy Night Sky chunk only. satellite.js propagation in TEME/ECI km;
 * satellite.js sunPos and shadowFraction use the documented matching ECI frames.
 * Require <=1% obscured solar disc (conservative full-sunlight criterion).
 */
import { twoline2satrec, propagate, gstime, eciToEcf, ecfToLookAngles, sunPos, shadowFraction, jday, degreesToRadians, radiansToDegrees } from 'satellite.js';
import { Body } from 'astronomy-engine';
import { position } from './ephemeris.ts';
import { HOUR, finite } from '../data/contracts.ts';
import type { Provenance } from '../data/contracts.ts';
import { resource } from '../data/resource.ts';
import { scheduledFetch } from '../data/scheduler.ts';
export interface IssElements extends Provenance { line1: string; line2: string; epoch: number; collectorTime: number | null }
export interface IssPass extends Provenance { start: number; end: number; peak: number; elevationDegrees: number; azimuthDegrees: number; epoch: number; calculatedAt: number; status: 'prediction' }
function checksum(line: string): boolean {
  return line.length === 69 && [...line.slice(0, 68)].reduce((s, c) => s + (/\d/.test(c) ? Number(c) : c === '-' ? 1 : 0), 0) % 10 === Number(line[68]);
}
export function parseIssTle(text: string, fetchedAt = Date.now()): IssElements {
  const lines = text.trim().split(/\r?\n/).map(l => l.trimEnd());
  const line1 = lines.find(l => l.startsWith('1 25544'));
  const line2 = lines.find(l => l.startsWith('2 25544'));
  if (!line1 || !line2 || !checksum(line1) || !checksum(line2)) throw new RangeError('Invalid ISS NORAD 25544 TLE/checksum');
  const rec = twoline2satrec(line1, line2);
  const epoch = (rec.jdsatepoch - 2440587.5) * 86400_000;
  if (!finite(epoch) || rec.error || rec.satnum !== '25544') throw new RangeError('Invalid ISS orbital epoch');
  return { provider: 'CelesTrak', modelId: 'NORAD 25544 / SGP4', issuedAt: null, sourceTime: epoch, fetchedAt, validFrom: epoch, validTo: epoch + 72 * HOUR, units: { position: 'km ECI', elevation: 'degrees', time: 'UTC epoch ms' }, coverage: 'Predictions limited to 72 hours from element epoch', line1, line2, epoch, collectorTime: null };
}
export function fetchIssElements(signal?: AbortSignal) {
  return resource('iss:elements', 12 * HOUR, async () => {
    try { return parseIssTle(await (await scheduledFetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE', { signal })).text()); }
    catch (error) {
      if (signal?.aborted) throw error;
      console.warn('ISS direct request failed; checking optional static elements:', error);
      return parseIssTle(await (await scheduledFetch(new URL(`${import.meta.env.BASE_URL}data/iss-tle.txt`, location.href).href, { signal })).text());
    }
  });
}
export function issVisibility(elements: IssElements, time: number) {
  const rec = twoline2satrec(elements.line1, elements.line2);
  return issSample(rec, time);
}
function issSample(rec: ReturnType<typeof twoline2satrec>, time: number) {
  const date = new Date(time);
  const state = propagate(rec, date);
  if (!state || !state.position) return { visible: false, elevationDegrees: -90, azimuthDegrees: 0, sunlit: false, sunAltitude: 90 };
  const look = ecfToLookAngles({ latitude: degreesToRadians(52.5736), longitude: degreesToRadians(-0.2400), height: 0.010 }, eciToEcf(state.position, gstime(date)));
  const elevationDegrees = radiansToDegrees(look.elevation);
  const azimuthDegrees = radiansToDegrees(look.azimuth);
  const sunlit = shadowFraction(sunPos(jday(date)).rsun, state.position) <= 0.01;
  const sunAltitude = position(Body.Sun, time).altitude;
  return { visible: elevationDegrees >= 10 && sunAltitude < -6 && sunlit, elevationDegrees, azimuthDegrees, sunlit, sunAltitude };
}
export function predictIssPasses(elements: IssElements, now: number): IssPass[] {
  if (now - elements.epoch > 72 * HOUR || elements.epoch > now + HOUR) return [];
  const start = Math.max(now, elements.epoch); const end = elements.epoch + 72 * HOUR;
  const rec = twoline2satrec(elements.line1, elements.line2);
  const sample = (time: number) => issSample(rec, time);
  const boundary = (lo: number, hi: number, before: boolean) => { while (hi - lo > 500) { const mid = (lo + hi) / 2; if (sample(mid).visible === before) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const passes: IssPass[] = [];
  let open: number | null = sample(start).visible ? start : null;
  for (let t = start; t < end; t += 20_000) {
    const next = Math.min(t + 20_000, end);
    const a = sample(t).visible; const b = sample(next).visible;
    if (!a && b) open = boundary(t, next, false);
    if ((a && !b) || (b && next === end)) {
      const close = a && !b ? boundary(t, next, true) : end;
      if (open !== null) {
        let best = open;
        for (let p = open; p <= close; p += 1000) if (sample(p).elevationDegrees > sample(best).elevationDegrees) best = p;
        const peak = sample(best);
        passes.push({ provider: 'CelesTrak', modelId: 'NORAD 25544 / satellite.js 7.1.0 SGP4', issuedAt: null, fetchedAt: elements.fetchedAt, sourceTime: elements.epoch, validFrom: open, validTo: close, units: { elevation: 'degrees', azimuth: 'degrees clockwise from north', time: 'UTC epoch milliseconds' }, coverage: 'Local visible-segment prediction; element epoch +72h maximum', calculatedAt: now, status: 'prediction', start: open, end: close, peak: best, elevationDegrees: peak.elevationDegrees, azimuthDegrees: peak.azimuthDegrees, epoch: elements.epoch });
      }
      open = null;
    }
  }
  return passes;
}
