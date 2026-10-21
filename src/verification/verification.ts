import { finite, HOUR } from '../data/contracts.ts';
import type { Family } from '../data/contracts.ts';
import { familyMean } from '../forecast/signals.ts';
export const VERIFICATION_CONFIG = { automaticCorrection: false, automaticReweighting: false, transferStationBiasToPeterborough: false } as const;
export interface Station { id: string; name: string; latitude: number; longitude: number; elevation: number }
export interface Observation { station: Station; id: string; time: number; reportTime: string | null; type: string; temperature: number | null; wind: number | null; gust: number | null; direction: number | 'VRB' | null; raw: string; fetchedAt: number }
export interface VerificationForecast {
  modelId: string; family: Family; validTime: number; leadHours: number; variable: 'temperature' | 'wind'; value: number;
  station: Station; forecastLocation: { latitude: number; longitude: number; elevation: number };
  provider: 'Open-Meteo Previous Runs'; issuedAt: null; sourceTime: null; fetchedAt: number; unit: '°C' | 'm/s'; measurementCompatible: boolean;
}
export interface MatchedPair { forecast: VerificationForecast; observation: Observation; observed: number; error: number; offsetMinutes: number }
export function parseMetars(raw: unknown, fetchedAt = Date.now()): Observation[] {
  if (!Array.isArray(raw)) throw new RangeError('Invalid METAR JSON');
  const rows = raw.flatMap(row => {
    if (row?.icaoId !== 'EGXT' || !finite(row.obsTime) || !finite(row.lat) || !finite(row.lon) || !finite(row.elev) || typeof row.rawOb !== 'string') return [];
    const time = row.obsTime * 1000;
    if (time < Date.UTC(2000, 0) || time > fetchedAt + HOUR) return [];
    const speed = (v: unknown) => finite(v) && v >= 0 ? v * 0.514444 : null;
    return [{ station: { id: 'EGXT', name: row.name ?? 'Wittering', latitude: row.lat, longitude: row.lon, elevation: row.elev }, id: `${row.icaoId}:${time}:${row.rawOb}`, time, reportTime: typeof row.reportTime === 'string' ? row.reportTime : null, type: row.metarType ?? 'METAR', temperature: finite(row.temp) ? row.temp : null, wind: speed(row.wspd), gust: speed(row.wgst), direction: finite(row.wdir) && row.wdir >= 0 && row.wdir <= 360 ? row.wdir : row.wdir === 'VRB' ? 'VRB' as const : null, raw: row.rawOb, fetchedAt }];
  });
  return [...new Map(rows.map(row => [row.id, row])).values()].sort((a, b) => a.time - b.time);
}
export function matchForecasts(forecasts: VerificationForecast[], observations: Observation[]): MatchedPair[] {
  const buckets = new Map<string, Observation[]>();
  for (const o of observations) {
    // A report is eligible for only its nearest UTC hour, preventing reuse in adjacent hours.
    const key = `${o.station.id}:${Math.round(o.time / HOUR) * HOUR}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(o);
  }
  return forecasts.flatMap(f => {
    if (!f.measurementCompatible) return [];
    const candidate = [...(buckets.get(`${f.station.id}:${f.validTime}`) ?? [])].filter(o => Math.abs(o.time - f.validTime) <= HOUR / 2 && o[f.variable] !== null
      && Math.abs(o.station.latitude - f.station.latitude) < 0.0001 && Math.abs(o.station.longitude - f.station.longitude) < 0.0001)
      .sort((a, b) => Math.abs(a.time - f.validTime) - Math.abs(b.time - f.validTime) || (a.type === 'METAR' ? 0 : 1) - (b.type === 'METAR' ? 0 : 1) || a.id.localeCompare(b.id))[0];
    return candidate ? [{ forecast: f, observation: candidate, observed: candidate[f.variable]!, error: f.value - candidate[f.variable]!, offsetMinutes: (candidate.time - f.validTime) / 60_000 }] : [];
  });
}
export interface ErrorMetrics { n: number; days: number; mae: number | null; mse: number | null; bias: number | null }
export function errorMetrics(pairs: { error: number; forecast: { validTime: number } }[]): ErrorMetrics {
  const n = pairs.length;
  return { n, days: new Set(pairs.map(p => new Date(p.forecast.validTime).toISOString().slice(0, 10))).size, mae: n ? pairs.reduce((s, p) => s + Math.abs(p.error), 0) / n : null, mse: n ? pairs.reduce((s, p) => s + p.error ** 2, 0) / n : null, bias: n ? pairs.reduce((s, p) => s + p.error, 0) / n : null };
}
export interface VerificationResult { modelId: string; variable: string; leadHours: number; station: Station; range: [number, number]; coverage: number; metrics: ErrorMetrics; training: ErrorMetrics; heldOutRaw: ErrorMetrics; heldOutProposed: ErrorMetrics | null; heldOutBaseline: ErrorMetrics; proposal: number | null; enabled: false; reasons: string[]; meanMatchOffsetMinutes: number; evaluatedAt: number }
export function evaluateVerification(forecasts: VerificationForecast[], observations: Observation[], now = Date.now()): VerificationResult[] {
  const pairs = matchForecasts(forecasts, observations);
  const groups = new Map<string, MatchedPair[]>();
  const baselineGroups = new Map<string, MatchedPair[]>();
  for (const pair of pairs) {
    const f = pair.forecast;
    const group = `${f.modelId}:${f.variable}:${f.leadHours}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(pair);
    const bkey = `${f.variable}:${f.leadHours}:${f.validTime}`;
    if (!baselineGroups.has(bkey)) baselineGroups.set(bkey, []);
    baselineGroups.get(bkey)!.push(pair);
  }
  // Subsequent UTC dates are held out. Fit only on the preceding rolling 30-day period.
  const evaluationEnd = Math.floor(now / (24 * HOUR)) * 24 * HOUR;
  const trainingEnd = evaluationEnd - 7 * 24 * HOUR;
  const trainingStart = trainingEnd - 30 * 24 * HOUR;
  return [...groups.values()].map(list => {
    const first = list[0].forecast;
    const trainingPairs = list.filter(p => p.forecast.validTime >= trainingStart && p.forecast.validTime < trainingEnd);
    const heldOut = list.filter(p => p.forecast.validTime >= trainingEnd && p.forecast.validTime < evaluationEnd);
    const training = errorMetrics(trainingPairs);
    const enough = training.n >= 200 && training.days >= 20;
    const proposal = first.variable === 'temperature' && enough && training.bias !== null ? Math.max(-3, Math.min(3, training.bias)) : null;
    const corrected = proposal === null ? null : errorMetrics(heldOut.map(p => ({ ...p, error: p.error - proposal })));
    const baseline = heldOut.flatMap(p => {
      const cohort = baselineGroups.get(`${p.forecast.variable}:${p.forecast.leadHours}:${p.forecast.validTime}`) ?? [];
      const value = familyMean(cohort.map(c => ({ modelId: c.forecast.modelId, family: c.forecast.family, value: c.forecast.value })));
      return value === null ? [] : [{ forecast: p.forecast, error: value - p.observed }];
    });
    const requested = forecasts.filter(f => f.modelId === first.modelId && f.variable === first.variable && f.leadHours === first.leadHours).length;
    return { modelId: first.modelId, variable: first.variable, leadHours: first.leadHours, station: first.station, range: [Math.min(...list.map(p => p.forecast.validTime)), Math.max(...list.map(p => p.forecast.validTime))] as [number, number], coverage: requested ? list.length / requested : 0, metrics: errorMetrics(list), training, heldOutRaw: errorMetrics(heldOut), heldOutProposed: corrected, heldOutBaseline: errorMetrics(baseline), proposal, enabled: false, reasons: [!enough ? 'Training gate not met: require 200 paired hours across 20 dates' : 'Minimum sample gate met; not proof of general forecast skill', !heldOut.length ? 'No subsequent held-out observations' : 'Held-out dates retained separately', 'Station bias is not automatically transferred to Peterborough', 'Wind scores disabled until observation/model measurement definitions are compatible', 'Automatic corrections and reweighting disabled'], meanMatchOffsetMinutes: list.reduce((s, p) => s + Math.abs(p.offsetMinutes), 0) / list.length, evaluatedAt: now };
  });
}
export function subsetGate(pairs: MatchedPair[]): boolean { const metrics = errorMetrics(pairs); return metrics.n >= 100 && metrics.days >= 15; }
