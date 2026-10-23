import { SNOW_BANNER_PROBABILITY, WIND_BANNER_PROBABILITY } from '../config/forecast.ts';
import { SNOW } from '../forecast/events.ts';
import { eventPercent } from '../data/contracts.ts';
import type { SummaryDay } from './forecastSummary.ts';

export function windOutlook(day: Pick<SummaryDay, 'gustMph' | 'gustEvent'>): string | null {
  const centralTrigger = day.gustMph !== null && day.gustMph >= 30;
  const probability = day.gustEvent.basis === 'ensemble-probability' ? day.gustEvent.value : null;
  if (!centralTrigger && (probability === null || probability < WIND_BANNER_PROBABILITY)) return null;
  const central = day.gustMph === null ? '—' : Math.round(day.gustMph);
  return `${central} mph${!centralTrigger ? ` · ${eventPercent(probability)} chance of 30+` : ''}`;
}

export const snowOutlook = (day: Pick<SummaryDay, 'snowCm' | 'snowEvent'>): boolean =>
  day.snowCm !== null && day.snowCm >= SNOW.threshold ||
  day.snowEvent.basis === 'ensemble-probability' && day.snowEvent.value !== null && day.snowEvent.value >= SNOW_BANNER_PROBABILITY;

export function rainOutlook(day: Pick<SummaryDay, 'rainMm' | 'rainHours' | 'expectedHours' | 'precipitation'>): string {
  if (day.rainMm === null || day.rainHours < day.expectedHours) return 'Rainfall data incomplete or unavailable';
  const probability = day.precipitation.basis === 'ensemble-probability' ? day.precipitation.value : null;
  if (day.rainMm >= 0.5 || probability !== null && probability >= 0.6) return 'Keep an umbrella handy';
  if (probability !== null && probability >= 0.3 || day.precipitation.basis === 'deterministic-agreement' && day.precipitation.value !== null && day.precipitation.value >= 0.5) return 'Some rain possible';
  return 'A mostly dry day';
}
