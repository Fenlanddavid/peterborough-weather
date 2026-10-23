import { finite, HOUR, utc } from '../data/contracts.ts';
import type { Observation } from './verification.ts';
import type { LearningObservation } from './learning.ts';

export const TEMPERATURE_DEFINITION = 'screen-air-temperature-point-celsius-v1';
export const RAIN_DEFINITION = 'liquid-equivalent-precipitation-total-mm-3h-v1';
export const GUST_DEFINITION = '10m-gust-maximum-preceding-hour-ms-v1';
export function metarLearningObservations(rows: Observation[]): LearningObservation[] {
  const selected = new Map<number, Observation>();
  for (const row of rows) {
    const hour = Math.round(row.time / HOUR) * HOUR;
    if (Math.abs(hour - row.time) > 15 * 60_000 || !finite(row.temperature) || row.temperature < -60 || row.temperature > 55 || /\b(?:NIL|CNL)\b/.test(row.raw)) continue;
    const previous = selected.get(hour);
    if (!previous || Math.abs(row.time - hour) < Math.abs(previous.time - hour)) selected.set(hour, row);
  }
  // Gust reports cover a different period, and weather codes are not rainfall gauges.
  return [...selected].map(([time, row]) => ({ id: row.id, location: row.station.id, latitude: row.station.latitude, longitude: row.station.longitude, start: time, end: time, variable: 'temperature_2m', unit: '°C', definition: TEMPERATURE_DEFINITION, value: row.temperature!, quality: 'accepted', collectedAt: row.fetchedAt }));
}
export interface RainGauge { id: string; latitude: number; longitude: number; measure: string; period: 900; unit: 'mm'; valueType: 'total'; timestampConvention: 'unknown' | 'period-end' | 'period-start' }
export interface GaugeReading { time: number; value: number; quality: 'accepted' | 'provisional' | 'rejected' }
export function parseGaugeReadings(raw: unknown, gauge: RainGauge, now = Date.now()): GaugeReading[] {
  const body = raw as { items?: { dateTime?: string; value?: number; quality?: string; measure?: string }[]; meta?: { limit?: number } };
  if (!Array.isArray(body?.items) || body.items.length >= (body.meta?.limit ?? 10000)) throw new RangeError('Invalid/truncated rainfall readings');
  const times = new Map<number, GaugeReading>();
  for (const r of body.items) {
    const time = typeof r.dateTime === 'string' ? utc(r.dateTime) : NaN;
    if (!finite(time) || time % (15 * 60_000) || time > now || !finite(r.value) || r.value < 0 || r.value > 100 || typeof r.measure !== 'string' || r.measure.replace('http:', 'https:') !== gauge.measure.replace('http:', 'https:')) continue;
    const quality = r.quality && !['good', 'validated', 'accepted'].includes(r.quality.toLowerCase()) ? 'rejected' : gauge.timestampConvention === 'unknown' ? 'provisional' : 'accepted';
    const existing = times.get(time);
    times.set(time, { time, value: r.value, quality: existing && existing.value !== r.value ? 'rejected' : quality });
  }
  return [...times.values()].sort((a, b) => a.time - b.time);
}
export function gaugeObservations(gauge: RainGauge, readings: GaugeReading[], collectedAt: number): LearningObservation[] {
  if (gauge.period !== 900 || gauge.unit !== 'mm' || gauge.valueType !== 'total' || gauge.timestampConvention === 'unknown') return [];
  const lookup = new Map(readings.map(r => [r.time, r]));
  const start = readings.length ? Math.floor(readings[0].time / (3 * HOUR)) * 3 * HOUR : 0;
  const result: LearningObservation[] = [];
  for (let t = start; t + 3 * HOUR <= collectedAt; t += 3 * HOUR) {
    const values = Array.from({ length: 12 }, (_, i) => lookup.get(t + (i + (gauge.timestampConvention === 'period-end' ? 1 : 0)) * 15 * 60_000));
    if (values.some(v => !v || v.quality !== 'accepted')) continue;
    const value = values.reduce((s, v) => s + v!.value, 0);
    result.push({ id: `${gauge.id}:${t}`, location: gauge.id, latitude: gauge.latitude, longitude: gauge.longitude, start: t, end: t + 3 * HOUR, variable: 'precipitation', unit: 'mm', definition: RAIN_DEFINITION, value, quality: 'accepted', collectedAt });
    result.push({ ...result.at(-1)!, id: `${gauge.id}:${t}:occurrence`, variable: 'precipitation_probability', unit: 'fraction', definition: `${RAIN_DEFINITION}:>=0.2`, value: value >= 0.2 ? 1 : 0 });
  }
  return result;
}
