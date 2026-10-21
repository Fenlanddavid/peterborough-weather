import type { CachedRun, WindowValue } from '../types';
import type { VariableId } from '../config/models.ts';
import { DETERMINISTIC_MODELS, VARIABLES } from '../config/models.ts';

const MS_TO_MPH = 2.23694;
const HOUR = 3600_000;

/**
 * Open-Meteo times are UTC without a suffix ("2026-10-17T00:00"). `new Date()` reads that
 * form as device-local time, which is an hour out during BST, so always parse through here.
 */
export function parseUtc(iso: string): number {
  return Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
}

const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

/** Convert m/s to mph if needed */
export function convertUnit(value: number | null, variable: VariableId): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const cfg = VARIABLES.find((v) => v.id === variable);
  if (cfg && 'convertFromMs' in cfg && cfg.convertFromMs) {
    return value * MS_TO_MPH;
  }
  return value;
}

/** Get the forecast value for a specific valid time from a run */
export function getValueAtTime(
  run: CachedRun,
  validTime: string
): number | null {
  if (run.unitState === 'unknown-legacy') return null;
  const idx = run.times.indexOf(validTime);
  if (idx === -1) return null;
  return convertUnit(run.values[idx], run.variable);
}

/** Compute 6-hour precipitation total (sum) ending at windowEnd */
export function sixHourPrecipTotal(
  run: CachedRun,
  windowEndISO: string
): WindowValue {
  const endTime = parseUtc(windowEndISO);
  let sum = 0;
  let complete = true;
  let hasAny = false;

  for (let h = 5; h >= 0; h--) {
    const idx = run.times.indexOf(toIso(endTime - h * HOUR));
    if (idx === -1 || !Number.isFinite(run.values[idx]) || run.values[idx] === null) {
      complete = false;
    } else {
      sum += convertUnit(run.values[idx]!, run.variable) ?? 0;
      hasAny = true;
    }
  }

  return {
    windowEnd: windowEndISO,
    value: hasAny ? sum : null,
    complete,
  };
}

/** Compute 6-hour max gust ending at windowEnd */
export function sixHourMaxGust(
  run: CachedRun,
  windowEndISO: string
): WindowValue {
  if (run.unitState === 'unknown-legacy') return { windowEnd: windowEndISO, value: null, complete: false };
  const endTime = parseUtc(windowEndISO);
  let max: number | null = null;
  let complete = true;

  for (let h = 5; h >= 0; h--) {
    const idx = run.times.indexOf(toIso(endTime - h * HOUR));
    if (idx === -1 || !Number.isFinite(run.values[idx]) || run.values[idx] === null) {
      complete = false;
    } else {
      const v = convertUnit(run.values[idx]!, run.variable)!;
      if (max === null || v > max) max = v;
    }
  }

  return { windowEnd: windowEndISO, value: max, complete };
}

/**
 * The value the run-to-run trend tools compare. Hourly rain and gusts are too noisy to
 * track between runs, so these use the six hours ending at the valid time (the thresholds
 * in metrics.ts and commentary.ts are written for 6h totals). Incomplete windows return
 * null rather than an undercount.
 */
export function getTrendValue(run: CachedRun, validTime: string): number | null {
  if (run.variable === 'precipitation') {
    const w = sixHourPrecipTotal(run, validTime);
    return w.complete ? w.value : null;
  }
  if (run.variable === 'wind_gusts_10m') {
    const w = sixHourMaxGust(run, validTime);
    return w.complete ? w.value : null;
  }
  return getValueAtTime(run, validTime);
}

/** Generate 6-hour window end times (00, 06, 12, 18 UTC) covering a run's forecast */
export function generateWindows(run: CachedRun): string[] {
  if (run.times.length === 0) return [];
  const first = parseUtc(run.times[0]);
  const last = parseUtc(run.times[run.times.length - 1]);
  const windows: string[] = [];
  const startDay = new Date(first);
  startDay.setUTCHours(0, 0, 0, 0);

  for (let t = startDay.getTime(); t <= last; t += 6 * HOUR) {
    if (t >= first) windows.push(toIso(t));
  }
  return windows;
}

/** Sort runs by run time */
export function sortByRunTime(runs: CachedRun[]): CachedRun[] {
  return [...runs].sort((a, b) => a.runTime.localeCompare(b.runTime));
}

/** Get all runs for a model+variable, sorted by run time */
export function getModelRuns(
  allRuns: CachedRun[],
  modelId: string,
  variable: VariableId
): CachedRun[] {
  return sortByRunTime(
    allRuns.filter((r) => r.modelId === modelId && r.variable === variable)
  );
}

/**
 * Latest-run lookup built once per data load. Each model/variable maps to the newest run's
 * values by valid time; hours missing from the newest run (still publishing, or past its
 * horizon) fall back to the previous run so one late upload doesn't blank the forecast.
 */
export interface LatestIndex {
  value(modelId: string, variable: VariableId, validTime: string): number | null;
  /** Mean across non-overlay models' latest runs, in display units. */
  consensus(variable: VariableId, validTime: string): number | null;
}

export function buildLatestIndex(runs: CachedRun[]): LatestIndex {
  const grouped = new Map<string, CachedRun[]>();
  for (const run of runs) {
    if (run.unitState === 'unknown-legacy') continue;
    const key = `${run.modelId}:${run.variable}`;
    const list = grouped.get(key);
    if (list) list.push(run); else grouped.set(key, [run]);
  }
  const index = new Map<string, Map<string, number>>();
  for (const [key, list] of grouped) {
    const [newest, previous] = sortByRunTime(list).reverse();
    const values = new Map<string, number>();
    for (const run of [previous, newest]) {
      if (!run) continue;
      run.times.forEach((time, i) => {
        const v = run.values[i];
        if (typeof v === 'number' && Number.isFinite(v)) values.set(time, v);
      });
    }
    index.set(key, values);
  }
  const models = DETERMINISTIC_MODELS.filter((m) => !m.isOverlay);

  const value = (modelId: string, variable: VariableId, validTime: string) => {
    const raw = index.get(`${modelId}:${variable}`)?.get(validTime);
    return raw === undefined ? null : convertUnit(raw, variable);
  };

  return {
    value,
    consensus(variable, validTime) {
      let sum = 0;
      let n = 0;
      for (const model of models) {
        const v = value(model.id, variable, validTime);
        if (v !== null) { sum += v; n++; }
      }
      return n ? sum / n : null;
    },
  };
}
