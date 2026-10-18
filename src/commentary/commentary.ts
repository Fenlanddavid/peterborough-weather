import type { CachedRun } from '../types';
import type { VariableId } from '../config/models';
import { DETERMINISTIC_MODELS, VARIABLES } from '../config/models';
import { calcChange, calcFlipFlop, calcPersistence } from '../metrics/metrics';
import { getModelRuns } from '../metrics/utils';
import { format } from 'date-fns';

/** Material change thresholds (in display units) */
const MATERIAL: Record<string, number> = {
  temperature_2m: 1,
  precipitation: 1,     // mm in 6h
  wind_gusts_10m: 4,    // mph
  wind_speed_10m: 4,    // mph
  pressure_msl: 2,      // hPa
};

const VAR_LABELS: Record<string, { up: string; down: string }> = {
  temperature_2m: { up: 'warmer', down: 'cooler' },
  precipitation: { up: 'wetter', down: 'drier' },
  wind_gusts_10m: { up: 'gustier', down: 'calmer' },
  wind_speed_10m: { up: 'windier', down: 'calmer' },
  pressure_msl: { up: 'higher pressure', down: 'lower pressure' },
};

function getUnit(variable: VariableId): string {
  return VARIABLES.find((v) => v.id === variable)?.unit ?? '';
}

function formatValidTime(validTime: string): string {
  return format(new Date(validTime + 'Z'), 'EEEE HH:mm');
}

export interface Commentary {
  text: string;
  validTime: string;
  variable: VariableId;
}

/** Generate commentary for a variable at a specific valid time */
export function generateCommentary(
  allRuns: CachedRun[],
  variable: VariableId,
  validTime: string
): Commentary {
  const lines: string[] = [];
  const unit = getUnit(variable);
  const labels = VAR_LABELS[variable] ?? { up: 'rising', down: 'falling' };
  const materialThreshold = MATERIAL[variable] ?? 1;
  const timeLabel = formatValidTime(validTime);

  const trendingFamilies: string[] = [];
  const changelessFamilies: string[] = [];
  const missingFamilies: string[] = [];

  for (const model of DETERMINISTIC_MODELS) {
    if (model.isOverlay) continue;

    const runs = getModelRuns(allRuns, model.id, variable);
    if (runs.length === 0) {
      missingFamilies.push(model.label);
      continue;
    }

    const change = calcChange(runs, validTime);
    const flipFlop = calcFlipFlop(runs, validTime, variable);

    // Trending if material change, low flip-flops, and enough runs
    if (
      change.change24h !== null &&
      Math.abs(change.change24h) >= materialThreshold &&
      flipFlop.reversals <= 2 &&
      runs.length >= 4
    ) {
      const direction = change.change24h > 0 ? labels.up : labels.down;
      const sign = change.change24h > 0 ? '+' : '';
      lines.push(
        `${model.label} is trending ${direction} for ${timeLabel} (${sign}${change.change24h.toFixed(1)} ${unit} over 24h).`
      );
      trendingFamilies.push(model.label);
    } else if (flipFlop.reversals > 2 && runs.length >= 4) {
      lines.push(
        `${model.label} remains changeable for ${timeLabel} (${flipFlop.reversals} reversals in ${flipFlop.totalRuns} runs).`
      );
      changelessFamilies.push(model.label);
    }

    // Persistence for precip
    if (variable === 'precipitation' && runs.length >= 4) {
      const persist = calcPersistence(runs, validTime, 1, 8, 'gt');
      if (persist.total >= 4) {
        lines.push(
          `${persist.count} of ${persist.total} recent ${model.label} runs show >1 mm.`
        );
      }
    }
  }

  if (missingFamilies.length > 0) {
    lines.push(`No data from ${missingFamilies.join(', ')}.`);
  }

  if (lines.length === 0) {
    lines.push(`No material changes detected for ${timeLabel}.`);
  }

  return { text: lines.join(' '), validTime, variable };
}

/** Generate headline summaries across multiple valid times */
export function generateHeadlines(
  allRuns: CachedRun[],
  variable: VariableId,
  validTimes: string[]
): string[] {
  const headlines: string[] = [];

  for (const vt of validTimes) {
    const c = generateCommentary(allRuns, variable, vt);
    if (!c.text.includes('No material changes')) {
      headlines.push(c.text);
    }
  }

  return headlines;
}
