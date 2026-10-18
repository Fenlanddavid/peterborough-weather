import type { CachedRun, WindowValue } from '../types';
import type { VariableId } from '../config/models';
import { VARIABLES } from '../config/models';

const MS_TO_MPH = 2.23694;

/** Convert m/s to mph if needed */
export function convertUnit(value: number | null, variable: VariableId): number | null {
  if (value === null) return null;
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
  const idx = run.times.indexOf(validTime);
  if (idx === -1) return null;
  return convertUnit(run.values[idx], run.variable);
}

/** Compute 6-hour precipitation total (sum) ending at windowEnd */
export function sixHourPrecipTotal(
  run: CachedRun,
  windowEndISO: string
): WindowValue {
  const endTime = new Date(windowEndISO).getTime();
  let sum = 0;
  let complete = true;
  let hasAny = false;

  for (let h = 5; h >= 0; h--) {
    const t = new Date(endTime - h * 3600_000).toISOString().slice(0, 16);
    const idx = run.times.indexOf(t);
    if (idx === -1 || run.values[idx] === null) {
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
  const endTime = new Date(windowEndISO).getTime();
  let max: number | null = null;
  let complete = true;

  for (let h = 5; h >= 0; h--) {
    const t = new Date(endTime - h * 3600_000).toISOString().slice(0, 16);
    const idx = run.times.indexOf(t);
    if (idx === -1 || run.values[idx] === null) {
      complete = false;
    } else {
      const v = convertUnit(run.values[idx]!, run.variable)!;
      if (max === null || v > max) max = v;
    }
  }

  return { windowEnd: windowEndISO, value: max, complete };
}

/** Generate 6-hour window end times (00, 06, 12, 18 UTC) covering a run's forecast */
export function generateWindows(run: CachedRun): string[] {
  if (run.times.length === 0) return [];
  const first = new Date(run.times[0]).getTime();
  const last = new Date(run.times[run.times.length - 1]).getTime();
  const windows: string[] = [];
  const startDay = new Date(first);
  startDay.setUTCHours(0, 0, 0, 0);

  for (let t = startDay.getTime(); t <= last + 6 * 3600_000; t += 6 * 3600_000) {
    if (t >= first && t <= last) {
      windows.push(new Date(t).toISOString().slice(0, 16));
    }
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
