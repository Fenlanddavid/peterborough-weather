/**
 * Reference forecast from wttr.in (powered by World Weather Online).
 * Used to lightly anchor today's multi-model consensus toward an
 * independent commercial-grade forecast.
 */

import { LOCATION } from '../config/models';

export interface ReferenceHour {
  time: string;     // ISO like "2026-10-19T09:00"
  tempC: number;
  windMph: number;
  precipMm: number;
}

export interface ReferenceForecast {
  hours: Map<string, ReferenceHour>;  // keyed by ISO time
  fetchedAt: number;
}

const CACHE_KEY = 'pw_reference_forecast';
const CACHE_TTL = 3 * 3600_000; // 3 hours

function readCache(): ReferenceForecast | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > CACHE_TTL) return null;
    // Restore Map from serialised entries
    return { hours: new Map(parsed.entries), fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

function writeCache(forecast: ReferenceForecast) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      entries: [...forecast.hours.entries()],
      fetchedAt: forecast.fetchedAt,
    }));
  } catch { /* quota exceeded — not critical */ }
}

export async function fetchReferenceForecast(): Promise<ReferenceForecast | null> {
  const cached = readCache();
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://wttr.in/${LOCATION.latitude},${LOCATION.longitude}?format=j1`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const hours = new Map<string, ReferenceHour>();

    for (const day of data.weather ?? []) {
      const date = day.date; // "2026-10-19"
      for (const h of day.hourly ?? []) {
        // wttr.in uses "time" as "0", "300", "600", ... "2100" (HHMM without leading zeros)
        const hhmm = String(h.time).padStart(4, '0');
        const hour = hhmm.slice(0, 2);
        const isoTime = `${date}T${hour}:00`;

        hours.set(isoTime, {
          time: isoTime,
          tempC: parseFloat(h.tempC),
          windMph: parseFloat(h.windspeedMiles),
          precipMm: parseFloat(h.precipMM),
        });
      }
    }

    if (hours.size === 0) return null;

    const forecast: ReferenceForecast = { hours, fetchedAt: Date.now() };
    writeCache(forecast);
    return forecast;
  } catch {
    return null; // network error or timeout — not critical
  }
}

/**
 * Blend a model consensus value with the reference forecast.
 * Reference weight is kept low (0.15) so it nudges rather than overrides.
 */
export function blendWithReference(
  modelValue: number | null,
  referenceValue: number | undefined,
  weight = 0.15
): number | null {
  if (modelValue === null) return null;
  if (referenceValue === undefined || !Number.isFinite(referenceValue)) return modelValue;
  return modelValue * (1 - weight) + referenceValue * weight;
}
