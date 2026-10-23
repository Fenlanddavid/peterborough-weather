import { DETERMINISTIC_MODELS } from '../config/models.ts';
import { finite, utc } from '../data/contracts.ts';
import type { CachedRun } from '../types.ts';
import type { OperationalForecast } from '../api/operational.ts';
import type { ModelUpdates } from '../api/modelUpdates.ts';
import { validatePolicy } from './policy.ts';
import type { BlendPolicy } from './policy.ts';

export interface ForecastProduct { schema: 1; generatedAt: number; location: string; runs: CachedRun[]; updates: ModelUpdates; operational?: OperationalForecast }
export interface PolicyProduct { schema: 1; publishedAt: number; revision: string; policy: BlendPolicy | null; reason: string }
export function validateForecastProduct(raw: unknown): ForecastProduct {
  const p = raw as ForecastProduct;
  if (!p || p.schema !== 1 || p.location !== 'peterborough' || !finite(p.generatedAt) || !Array.isArray(p.runs) || p.runs.length > 500 || !p.updates) throw new RangeError('Invalid shared forecast');
  for (const r of p.runs) if (!r || !DETERMINISTIC_MODELS.some(m => m.id === r.modelId) || !finite(utc(r.runTime)) || !finite(r.fetchedAt) || !Array.isArray(r.times) || !Array.isArray(r.values) || r.times.length !== r.values.length || r.times.length > 500 || r.times.some((t, i) => typeof t !== 'string' || !finite(utc(t)) || i > 0 && utc(t) <= utc(r.times[i - 1])) || r.values.some(v => v !== null && !finite(v)) || r.key !== `${r.modelId}__${r.runTime}__${r.variable}`) throw new RangeError('Malformed shared forecast run');
  return p;
}
export function validatePolicyProduct(raw: unknown, now = Date.now()): PolicyProduct {
  const p = raw as PolicyProduct;
  if (!p || p.schema !== 1 || !finite(p.publishedAt) || p.publishedAt > now || typeof p.revision !== 'string' || !Object.hasOwn(p, 'policy') || typeof p.reason !== 'string') throw new RangeError('Invalid policy publication');
  if (p.policy !== null) validatePolicy(p.policy, now);
  return p;
}
