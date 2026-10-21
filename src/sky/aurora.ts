import { finite, HOUR, utc } from '../data/contracts.ts';
import type { Provenance, SourceResult } from '../data/contracts.ts';
import { resource } from '../data/resource.ts';
import { scheduledFetch } from '../data/scheduler.ts';
import type { Interval } from '../astro/ephemeris.ts';
export interface KpPoint { time: number; kp: number; kind: 'observed' | 'estimated' | 'forecast'; decimal: boolean }
export interface KpProduct extends Provenance { entries: KpPoint[] }
const validKp = (v: unknown): v is number => finite(v) && v >= 0 && v <= 9;
export function parseCurrentKp(raw: unknown, fetchedAt = Date.now()): KpProduct {
  if (!Array.isArray(raw)) throw new RangeError('Invalid Kp product');
  const entries: KpPoint[] = raw.flatMap(row => {
    const time = typeof row?.time_tag === 'string' ? utc(row.time_tag) : NaN;
    const decimal = validKp(row?.estimated_kp);
    const kp = decimal ? row.estimated_kp : row?.kp_index;
    return finite(time) && validKp(kp) ? [{ time, kp, kind: 'estimated' as const, decimal }] : [];
  }).sort((a, b) => a.time - b.time);
  if (!entries.length) throw new RangeError('No valid Kp values');
  return { provider: 'NOAA SWPC', modelId: 'planetary_k_index_1m', issuedAt: null, fetchedAt, sourceTime: entries.at(-1)!.time, validFrom: entries[0].time, validTo: entries.at(-1)!.time + 60_000, units: { kp: 'Kp (0–9)' }, coverage: 'One-minute estimates; integer fallback retains source precision', entries };
}
export function parseKpForecast(raw: unknown, fetchedAt = Date.now()): KpProduct {
  if (!Array.isArray(raw)) throw new RangeError('Invalid forecast Kp product');
  const entries: KpPoint[] = raw.flatMap(row => {
    const time = typeof row?.time_tag === 'string' ? utc(row.time_tag) : NaN;
    const kind = row?.observed === 'predicted' ? 'forecast' : row?.observed;
    return finite(time) && validKp(row?.kp) && ['observed', 'estimated', 'forecast'].includes(kind) ? [{ time, kp: row.kp, kind, decimal: !Number.isInteger(row.kp) }] : [];
  }).sort((a, b) => a.time - b.time);
  if (!entries.length) throw new RangeError('No valid forecast blocks');
  // Forecast issue time is not supplied. Last non-forecast block is a data recency proxy, explicitly not an issue time.
  const sourceTime = entries.filter(e => e.kind !== 'forecast' && e.time <= fetchedAt).at(-1)?.time ?? null;
  return { provider: 'NOAA SWPC', modelId: 'noaa-planetary-k-index-forecast', issuedAt: null, fetchedAt, sourceTime, validFrom: entries[0].time, validTo: entries.at(-1)!.time + 3 * HOUR, units: { kp: 'Kp (0–9)' }, coverage: 'Three-hour blocks, UTC timestamp is block start; source time is latest non-forecast block', entries };
}
export function kpForDarkness(product: KpProduct, dark: Interval, now = -Infinity) {
  return product.entries.filter(e => e.kind !== 'observed').flatMap(e => {
    const start = Math.max(e.time, dark.start, now); const end = Math.min(e.time + 3 * HOUR, dark.end);
    return end > start ? [{ ...e, start, end }] : [];
  });
}
export function auroraGuidance(kp: number): string {
  return kp >= 8 ? 'Strong activity; naked-eye viewing may be possible' : kp >= 7 ? 'Elevated opportunity; camera and visual checks worthwhile' : kp >= 6 ? 'Photographic opportunity may exist' : kp >= 5 ? 'Watch for stronger bursts' : 'Generally low expectation locally';
}
export function freshProduct(product: Provenance, maxAge: number, now = Date.now()): boolean { return product.sourceTime !== null && now - product.sourceTime <= maxAge && product.sourceTime <= now + 5 * 60_000; }
export interface Ovation extends Provenance { observationTime: number; forecastTime: number; context: { longitude: number; latitude: number; intensity: number }[] }
export const wrappedLongitude = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;
export function parseOvation(raw: unknown, fetchedAt = Date.now()): Ovation {
  const data = raw as Record<string, any>;
  const observationTime = typeof data?.['Observation Time'] === 'string' ? utc(data['Observation Time']) : NaN;
  const forecastTime = typeof data?.['Forecast Time'] === 'string' ? utc(data['Forecast Time']) : NaN;
  if (!finite(observationTime) || !finite(forecastTime) || !Array.isArray(data.coordinates)) throw new RangeError('Invalid OVATION product');
  const grid = data.coordinates;
  if (grid.some((v: unknown) => !Array.isArray(v) || v.length !== 3 || !v.every(finite) || v[0] < -180 || v[0] > 360 || v[1] < -90 || v[1] > 90 || v[2] < 0 || v[2] > 100)) throw new RangeError('Invalid OVATION coordinates/intensity');
  const context = grid.flatMap((v: number[]) => v[1] >= 55 && v[1] <= 60 && Math.abs(wrappedLongitude(v[0]) - (-0.24)) <= 2 ? [{ longitude: wrappedLongitude(v[0]), latitude: v[1], intensity: v[2] }] : []);
  if (!context.length) throw new RangeError('OVATION regional context missing');
  return { provider: 'NOAA SWPC', modelId: 'OVATION', issuedAt: null, sourceTime: observationTime, fetchedAt, observationTime, forecastTime, validFrom: forecastTime, validTo: forecastTime + 30 * 60_000, units: { intensity: 'source grid intensity (0–100), regional context only', longitude: 'degrees east', latitude: 'degrees north' }, coverage: '55–60°N near Peterborough longitude; not local viewing probability', context };
}
export interface SolarSample { time: number; bzGsm: number; source: string }
export interface SolarWind extends Provenance { samples: SolarSample[]; speed: number | null; speedTime: number | null; speedSource: string | null }
export function parseSolarWind(mag: unknown, plasma?: unknown, fetchedAt = Date.now()): SolarWind {
  if (!Array.isArray(mag)) throw new RangeError('Invalid RTSW magnetometer product');
  const samples: SolarSample[] = mag.flatMap(row => {
    const time = typeof row?.time_tag === 'string' ? utc(row.time_tag) : NaN;
    return row?.active === true && row?.overall_quality === 0 && finite(time) && finite(row?.bz_gsm) && Math.abs(row.bz_gsm) < 200 && typeof row?.source === 'string' ? [{ time, bzGsm: row.bz_gsm, source: row.source }] : [];
  }).sort((a, b) => a.time - b.time);
  const unique = [...new Map(samples.map(s => [s.time, s])).values()];
  if (!unique.length) throw new RangeError('No valid active GSM samples');
  const speed = Array.isArray(plasma) ? plasma.filter(row => row?.active === true && finite(row?.proton_speed) && row.proton_speed > 0 && typeof row.time_tag === 'string' && finite(utc(row.time_tag))).sort((a, b) => utc(a.time_tag) - utc(b.time_tag)).at(-1) : null;
  return { provider: 'NOAA SWPC', modelId: 'RTSW active spacecraft', issuedAt: null, sourceTime: unique.at(-1)!.time, fetchedAt, validFrom: unique[0].time, validTo: unique.at(-1)!.time + 60_000, units: { bzGsm: 'nT (GSM)', speed: 'km/s' }, coverage: 'Active, quality-zero magnetometer samples; speed retains separate source and valid time', samples: unique, speed: speed?.proton_speed ?? null, speedTime: speed ? utc(speed.time_tag) : null, speedSource: speed?.source ?? null };
}
export function sustainedSouthward(product: SolarWind, now: number, locallyDark: boolean): boolean {
  if (!locallyDark || !freshProduct(product, 5 * 60_000, now)) return false;
  const start = now - 30 * 60_000;
  const samples = product.samples.filter(s => s.time >= start && s.time <= now);
  if (!samples.length || samples.some(s => s.bzGsm > -10)) return false;
  const points = [start, ...samples.map(s => s.time), now];
  if (points.some((t, i) => i > 0 && t - points[i - 1] > 5 * 60_000)) return false;
  // Each one-minute sample represents one minute; do not credit a long gap as coverage.
  const covered = samples.reduce((sum, s, i) => sum + Math.max(0, Math.min(60_000, now - s.time, (samples[i + 1]?.time ?? now) - s.time)), 0);
  return covered >= 0.8 * 30 * 60_000;
}
export interface AuroraWatch extends Provenance { level: 'green' | 'yellow' | 'amber' | 'red'; collectorTime: number | null }
export const AURORAWATCH_MEANING = {
  green: 'No significant activity; the upstream guidance expects little UK opportunity.',
  yellow: 'Minor activity. Upstream guidance favours Scottish visual checks, with camera opportunities extending into northern England and Northern Ireland.',
  amber: 'Upstream guidance favours northern UK visual viewing, with wider UK photographic opportunities and possible visual sightings further south.',
  red: 'Upstream guidance indicates a UK-wide visual and photographic opportunity, subject to local darkness and weather.',
};
export function parseAuroraWatch(xml: string, fetchedAt = Date.now()): AuroraWatch {
  if (!/<current_status\b[^>]*>[\s\S]*<\/current_status>\s*$/.test(xml) || /<parsererror\b/.test(xml)) throw new RangeError('Invalid AuroraWatch XML');
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    if (document.querySelector('parsererror') || document.documentElement.nodeName !== 'current_status') throw new RangeError('Malformed AuroraWatch XML');
  }
  const timestamp = /<updated>\s*<datetime>([^<]+)<\/datetime>\s*<\/updated>/.exec(xml)?.[1];
  const level = /<site_status\b[^>]*\bstatus_id="(green|yellow|amber|red)"/.exec(xml)?.[1] as AuroraWatch['level'] | undefined;
  const time = timestamp ? Date.parse(timestamp.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')) : NaN;
  if (!level || !finite(time)) throw new RangeError('AuroraWatch status or source timestamp absent');
  return { provider: 'Lancaster University / SAMNET / AuroraWatchNet', modelId: 'AuroraWatch UK', issuedAt: null, sourceTime: time, fetchedAt, validFrom: time, validTo: time + 10 * 60_000, units: { level: 'upstream UK geomagnetic alert colour, not local probability' }, coverage: 'Upstream active site status', level, collectorTime: null };
}
async function json(url: string, signal?: AbortSignal) { return (await scheduledFetch(url, { signal })).json(); }
export const fetchCurrentKp = (signal?: AbortSignal, force = false) => resource('aurora:current', 30 * 60_000, async () => parseCurrentKp(await json('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', signal)), force);
export const fetchKpForecast = (signal?: AbortSignal, force = false) => resource('aurora:forecast', 30 * 60_000, async () => parseKpForecast(await json('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', signal)), force);
export const fetchOvation = (signal?: AbortSignal) => resource('aurora:ovation', 10 * 60_000, async () => parseOvation(await json('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json', signal)));
export const fetchSolarWind = (signal?: AbortSignal) => resource('aurora:solar-wind', 10 * 60_000, async () => {
  const mag = await json('https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json', signal);
  let plasma: unknown;
  try { plasma = await json('https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json', signal); } catch (error) { console.warn('Solar-wind speed unavailable:', error); }
  return parseSolarWind(mag, plasma);
});
export function fetchAuroraWatch(signal?: AbortSignal): Promise<SourceResult<AuroraWatch>> {
  return resource('aurora:watch', 10 * 60_000, async () => {
    try { return parseAuroraWatch(await (await scheduledFetch('https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml', { signal })).text()); }
    catch (error) {
      if (signal?.aborted) throw error;
      console.warn('AuroraWatch direct request failed; checking optional static collector:', error);
      const url = new URL(`${import.meta.env.BASE_URL}data/aurorawatch.json`, location.href);
      const data = await (await scheduledFetch(url.href, { signal })).json();
      const parsed = parseAuroraWatch(data.xml);
      return { ...parsed, collectorTime: finite(data.collectedAt) ? data.collectedAt : null };
    }
  });
}
