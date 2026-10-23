import { estimatedCost, HttpError } from '../../src/data/scheduler.ts';
import type { CollectorStore } from './metOfficeCollector.ts';
export interface CollectorBudget { date: string; http: number; weighted: number; blockedUntil: number }
export function collectorBudgetAllows(budget: CollectorBudget, cost: number, now: number) {
  return now >= budget.blockedUntil && (budget.date !== new Date(now).toISOString().slice(0, 10) || budget.weighted + cost <= 1500);
}
export function budgetedCollectorJson(store: CollectorStore, request: typeof fetch = fetch, now = Date.now()) {
  return async (url: string): Promise<any> => {
    const isMeteo = /(^|\.)open-meteo\.com$/.test(new URL(url).hostname);
    let budget: CollectorBudget | undefined;
    if (isMeteo) {
      try {
        budget = await store.read<CollectorBudget>('forecast/openmeteo-budget.json', { date: '', http: 0, weighted: 0, blockedUntil: 0 });
        if (!budget || ![budget.http, budget.weighted, budget.blockedUntil].every(Number.isFinite) || budget.http < 0 || budget.weighted < 0) throw new RangeError('Invalid budget');
      } catch {
        // Usage cannot be reconstructed safely for this UTC date. Reserve the
        // remainder and recover automatically tomorrow, rather than resetting to zero.
        budget = { date: new Date(now).toISOString().slice(0, 10), http: 0, weighted: 1500, blockedUntil: Math.floor(now / 86400_000) * 86400_000 + 86400_000 };
        await store.save('forecast/openmeteo-budget.json', budget);
      }
      const cost = estimatedCost(url);
      if (!collectorBudgetAllows(budget, cost, now)) throw new HttpError(429, 'Scheduled collector budget/backoff; retained sources used');
      if (budget.date !== new Date(now).toISOString().slice(0, 10)) budget = { date: new Date(now).toISOString().slice(0, 10), http: 0, weighted: 0, blockedUntil: 0 };
      budget.http++; budget.weighted += cost;
      await store.save('forecast/openmeteo-budget.json', budget);
    }
    const response = await request(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (budget && response.status === 429) {
        const retry = response.headers.get('retry-after');
        budget.blockedUntil = now + Math.max(15 * 60_000, retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 0);
        await store.save('forecast/openmeteo-budget.json', budget);
      }
      throw new HttpError(response.status, `HTTP ${response.status} from ${new URL(url).hostname}`);
    }
    return response.json();
  };
}
