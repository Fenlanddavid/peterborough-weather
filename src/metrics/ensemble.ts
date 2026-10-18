import type { EnsembleData } from '../types';
import type { VariableId } from '../config/models';

const MS_TO_MPH = 2.23694;

function needsConversion(variable: VariableId): boolean {
  return variable === 'wind_speed_10m' || variable === 'wind_gusts_10m';
}

/** Count ensemble members exceeding a threshold for a 6h window ending at windowEnd */
export function ensembleExceedance(
  ensemble: EnsembleData,
  windowEndISO: string,
  threshold: number,
  variable: VariableId,
  mode: 'sum' | 'max' = 'sum'
): { met: number; total: number } | null {
  const endTime = new Date(windowEndISO).getTime();
  const convert = needsConversion(variable);

  // Find indices for the 6h window
  const indices: number[] = [];
  for (let h = 5; h >= 0; h--) {
    const t = new Date(endTime - h * 3600_000).toISOString().slice(0, 16);
    const idx = ensemble.times.indexOf(t);
    if (idx !== -1) indices.push(idx);
  }

  if (indices.length === 0) return null;

  let met = 0;
  let total = 0;

  for (const memberValues of ensemble.members) {
    // Check if this member has complete data for the window
    const windowValues: number[] = [];
    let complete = true;

    for (const idx of indices) {
      const v = memberValues[idx];
      if (v === null || v === undefined) {
        complete = false;
        break;
      }
      windowValues.push(convert ? v * MS_TO_MPH : v);
    }

    if (!complete) continue;
    total++;

    let windowResult: number;
    if (mode === 'sum') {
      windowResult = windowValues.reduce((a, b) => a + b, 0);
    } else {
      windowResult = Math.max(...windowValues);
    }

    if (windowResult > threshold) met++;
  }

  if (total === 0) return null;
  return { met, total };
}

/** Get a single value at a specific time from ensemble (mean + spread) */
export function ensembleStats(
  ensemble: EnsembleData,
  timeISO: string,
  variable: VariableId
): { mean: number; p10: number; p90: number; min: number; max: number; count: number } | null {
  const idx = ensemble.times.indexOf(timeISO);
  if (idx === -1) return null;

  const convert = needsConversion(variable);
  const values: number[] = [];

  for (const memberValues of ensemble.members) {
    const v = memberValues[idx];
    if (v !== null && v !== undefined) {
      values.push(convert ? v * MS_TO_MPH : v);
    }
  }

  if (values.length === 0) return null;

  values.sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const p10Idx = Math.floor(values.length * 0.1);
  const p90Idx = Math.min(Math.floor(values.length * 0.9), values.length - 1);

  return {
    mean,
    p10: values[p10Idx],
    p90: values[p90Idx],
    min: values[0],
    max: values[values.length - 1],
    count: values.length,
  };
}
