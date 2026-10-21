/** Compatibility facade. Night Sky uses the independently cached, typed products directly. */
import { fetchCurrentKp, fetchKpForecast } from '../sky/aurora.ts';
import type { KpProduct } from '../sky/aurora.ts';
import { utc } from '../data/contracts.ts';
export interface KpForecastEntry { time: string; kp: number; observed: boolean }
export interface AuroraData { current: KpProduct | null; forecast: KpProduct | null; fetchedAt: number }
export function upcomingKpForecast(entries: KpForecastEntry[], now = Date.now()): KpForecastEntry[] {
  return entries.filter(entry => !entry.observed && Number.isFinite(entry.kp) && entry.kp >= 0 && entry.kp <= 9 && utc(entry.time) + 3 * 3600_000 > now && utc(entry.time) < now + 72 * 3600_000).sort((a, b) => a.time.localeCompare(b.time));
}
export async function fetchAuroraData(force = false): Promise<AuroraData | null> {
  const [current, forecast] = await Promise.all([fetchCurrentKp(undefined, force), fetchKpForecast(undefined, force)]);
  return current.data || forecast.data ? { current: current.data, forecast: forecast.data, fetchedAt: Math.max(current.checkedAt, forecast.checkedAt) } : null;
}
export function kpColour(kp: number): string { return kp >= 8 ? '#ef6b73' : kp >= 6 ? '#f2bb9d' : kp >= 4 ? '#eed49d' : kp >= 2 ? '#b5dacd' : '#a6b2c5'; }
export function kpLabel(kp: number): string { return kp >= 8 ? 'Severe storm' : kp >= 7 ? 'Strong storm' : kp >= 6 ? 'Moderate storm' : kp >= 5 ? 'Minor storm' : kp >= 4 ? 'Active' : kp >= 2 ? 'Unsettled' : 'Quiet'; }
