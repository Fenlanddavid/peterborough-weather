import { WIND_BANNER_PROBABILITY } from '../config/forecast.ts';
import { eventPercent } from '../data/contracts.ts';
import type { SummaryDay } from './forecastSummary.ts';

export function windOutlook(day: Pick<SummaryDay, 'gustMph' | 'gustEvent'>): string | null {
  const centralTrigger = day.gustMph !== null && day.gustMph >= 30;
  const probability = day.gustEvent.basis === 'ensemble-probability' ? day.gustEvent.value : null;
  if (!centralTrigger && (probability === null || probability < WIND_BANNER_PROBABILITY)) return null;
  const central = day.gustMph === null ? '—' : Math.round(day.gustMph);
  return `${central} mph${!centralTrigger ? ` · ${eventPercent(probability)} chance of 30+` : ''}`;
}
