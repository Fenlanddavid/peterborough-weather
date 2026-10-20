import type { CachedRun, ChangeMetric, FlipFlopMetric, PersistenceMetric } from '../types';
import type { VariableId } from '../config/models';
import { MS_PER_HOUR } from '../config/models';
import { getTrendValue, parseUtc, sortByRunTime } from './utils';

const FLAT_THRESHOLDS: Record<string, number> = {
  temperature_2m: 0.2,
  precipitation: 0.2,   // 6h total
  wind_gusts_10m: 0.5,  // mph, 6h max
  wind_speed_10m: 0.5,
  pressure_msl: 0.3,
};

/** Find the nearest run to a target age (in hours) within 3h tolerance */
function findRunByAge(runs: CachedRun[], newestRunTime: number, targetAgeH: number): CachedRun | null {
  const targetTime = newestRunTime - targetAgeH * MS_PER_HOUR;
  let best: CachedRun | null = null;
  let bestDiff = Infinity;

  for (const run of runs) {
    const diff = Math.abs(parseUtc(run.runTime) - targetTime);
    if (diff < bestDiff && diff <= 3 * MS_PER_HOUR) {
      bestDiff = diff;
      best = run;
    }
  }
  return best;
}

/** Calculate change metrics for a set of runs at a valid time */
export function calcChange(
  runs: CachedRun[],
  validTime: string
): ChangeMetric {
  const sorted = sortByRunTime(runs);
  if (sorted.length < 2) return { changePrev: null, change24h: null, change48h: null };

  const newest = sorted[sorted.length - 1];
  const newestVal = getTrendValue(newest, validTime);
  if (newestVal === null) return { changePrev: null, change24h: null, change48h: null };

  const newestMs = parseUtc(newest.runTime);

  const prev = sorted[sorted.length - 2];
  const prevVal = getTrendValue(prev, validTime);
  const changePrev = prevVal !== null ? newestVal - prevVal : null;

  const run24 = findRunByAge(sorted, newestMs, 24);
  const val24 = run24 ? getTrendValue(run24, validTime) : null;
  const change24h = val24 !== null ? newestVal - val24 : null;

  const run48 = findRunByAge(sorted, newestMs, 48);
  const val48 = run48 ? getTrendValue(run48, validTime) : null;
  const change48h = val48 !== null ? newestVal - val48 : null;

  return { changePrev, change24h, change48h };
}

/** Calculate flip-flop (direction reversals) */
export function calcFlipFlop(
  runs: CachedRun[],
  validTime: string,
  variable: VariableId
): FlipFlopMetric {
  const sorted = sortByRunTime(runs);
  const values: number[] = [];

  for (const run of sorted) {
    const v = getTrendValue(run, validTime);
    if (v !== null) values.push(v);
  }

  if (values.length < 3) return { reversals: 0, totalRuns: values.length };

  const threshold = FLAT_THRESHOLDS[variable] ?? 0.2;

  // Classify changes, removing flat steps
  const directions: ('up' | 'down')[] = [];
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (Math.abs(diff) > threshold) {
      directions.push(diff > 0 ? 'up' : 'down');
    }
  }

  // Count reversals
  let reversals = 0;
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] !== directions[i - 1]) reversals++;
  }

  return { reversals, totalRuns: values.length };
}

/** Calculate persistence — how many of the last N runs show an event */
export function calcPersistence(
  runs: CachedRun[],
  validTime: string,
  threshold: number,
  lastN: number = 8,
  comparator: 'gt' | 'lt' = 'gt'
): PersistenceMetric {
  const sorted = sortByRunTime(runs);
  const recent = sorted.slice(-lastN);
  let count = 0;
  let total = 0;

  for (const run of recent) {
    const v = getTrendValue(run, validTime);
    if (v !== null) {
      total++;
      if (comparator === 'gt' ? v > threshold : v < threshold) count++;
    }
  }

  return { count, total };
}

/** Weighted linear regression (trend slope) */
export function calcTrendSlope(
  runs: CachedRun[],
  validTime: string
): number | null {
  const sorted = sortByRunTime(runs);
  const points: { t: number; v: number }[] = [];

  for (const run of sorted) {
    const v = getTrendValue(run, validTime);
    if (v !== null) {
      points.push({ t: parseUtc(run.runTime), v });
    }
  }

  if (points.length < 4) return null;

  const spanH = (points[points.length - 1].t - points[0].t) / MS_PER_HOUR;
  if (spanH < 18) return null;

  const newestT = points[points.length - 1].t;
  const halfLifeMs = 36 * MS_PER_HOUR;

  // Weighted linear regression
  let sumW = 0, sumWx = 0, sumWy = 0, sumWxx = 0, sumWxy = 0;
  for (const p of points) {
    const ageMs = newestT - p.t;
    const w = Math.pow(0.5, ageMs / halfLifeMs);
    const x = (p.t - points[0].t) / (24 * MS_PER_HOUR); // x in days
    sumW += w;
    sumWx += w * x;
    sumWy += w * p.v;
    sumWxx += w * x * x;
    sumWxy += w * x * p.v;
  }

  const denom = sumW * sumWxx - sumWx * sumWx;
  if (Math.abs(denom) < 1e-10) return null;

  return (sumW * sumWxy - sumWx * sumWy) / denom; // units per day
}
