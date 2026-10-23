import { HOUR, finite, utc } from '../../src/data/contracts.ts';
import { LOCATION } from '../../src/config/models.ts';
import { MET_OFFICE_BASE, MET_OFFICE_PARAMETERS, parseMetOffice } from '../../src/forecast/metOffice.ts';
import type { MetOfficeProduct } from '../../src/forecast/metOffice.ts';

export interface CollectorStore { read<T>(path: string, fallback: T): Promise<T>; save(path: string, data: unknown): Promise<unknown> }
export interface MetOfficeBudget { date: string; calls: number; blockedUntil: number; lastAttempt: number }
export function canRequestMetOffice(budget: MetOfficeBudget, now: number) {
  return now >= budget.blockedUntil && (budget.date !== new Date(now).toISOString().slice(0, 10) || budget.calls < 48);
}
interface Discovery { version?: 2; checkedAt: number; collections: { id: string; parameters: string[] }[]; instances: Record<string, { checkedAt: number; id: string; issuedAt: number | null }> }
const safeId = (id: string) => encodeURIComponent(id);
export async function collectMetOffice(store: CollectorStore, key: string | undefined, now = Date.now(), request: typeof fetch = fetch) {
  if (!key) { await store.save('forecast/metoffice-status.json', { checkedAt: now, connected: false, reason: 'One-time setup: subscribe to Met Office Site-Specific Blended Probabilistic Forecast v2 Free plan and add repository Actions secret MET_OFFICE_API_KEY.' }); return; }
  let budget: MetOfficeBudget;
  try {
    budget = await store.read<MetOfficeBudget>('forecast/metoffice-budget.json', { date: '', calls: 0, blockedUntil: 0, lastAttempt: 0 });
    if (!budget || ![budget.calls, budget.blockedUntil, budget.lastAttempt].every(finite) || budget.calls < 0) throw new Error('Invalid Met Office budget');
  } catch {
    budget = { date: new Date(now).toISOString().slice(0, 10), calls: 48, blockedUntil: Math.floor(now / (24 * HOUR)) * 24 * HOUR + 24 * HOUR, lastAttempt: now - 3 * HOUR };
    await store.save('forecast/metoffice-budget.json', budget);
  }
  let discovery: Discovery;
  try { discovery = await store.read<Discovery>('forecast/metoffice-discovery.json', { checkedAt: 0, collections: [], instances: {} }); if (!discovery || !Array.isArray(discovery.collections) || !discovery.instances || !finite(discovery.checkedAt)) throw new Error('Invalid discovery'); } catch { discovery = { checkedAt: 0, collections: [], instances: {} }; }
  const rebuildDiscovery = discovery.version !== 2;
  if (!rebuildDiscovery && now - budget.lastAttempt < 3 * HOUR || !canRequestMetOffice(budget, now)) return;
  const get = async (path: string) => {
    if (!canRequestMetOffice(budget, now)) throw new Error('Met Office daily quota/backoff; previous product retained');
    if (budget.date !== new Date(now).toISOString().slice(0, 10)) budget = { date: new Date(now).toISOString().slice(0, 10), calls: 0, blockedUntil: 0, lastAttempt: now };
    budget.calls++; budget.lastAttempt = now;
    // Reserve every call durably BEFORE sending, including discovery and failed calls.
    await store.save('forecast/metoffice-budget.json', budget);
    const response = await request(`${MET_OFFICE_BASE}${path}`, { headers: { apikey: key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (response.status === 429) { budget.blockedUntil = Date.parse(`${budget.date}T00:00Z`) + 24 * HOUR; await store.save('forecast/metoffice-budget.json', budget); }
      throw new Error(`Met Office HTTP ${response.status}`); // never log headers or credentials
    }
    return response.json();
  };
  try {
    if (rebuildDiscovery || now - discovery.checkedAt >= 24 * HOUR || !discovery.collections.length) {
      const root = await get('/collections');
      if (!Array.isArray(root.collections)) throw new RangeError('Met Office discovery has no collections');
      const compatible: { id: string; parameters: string[] }[] = root.collections.flatMap((c: { id?: string; parameter_names?: Record<string, unknown>; parameters?: Record<string, unknown> }) => {
        if (typeof c.id !== 'string') return [];
        const available = Object.keys(c.parameter_names ?? c.parameters ?? {});
        const parameters = MET_OFFICE_PARAMETERS.filter(p => available.includes(p));
        return parameters.length ? [{ id: c.id, parameters }] : [];
      });
      // Some EDR catalogues provide parameters only in each collection document.
      if (!compatible.length) for (const c of root.collections.slice(0, 6)) {
        if (typeof c.id !== 'string') continue;
        const detail = await get(`/collections/${safeId(c.id)}`);
        const available = Object.keys(detail.parameter_names ?? detail.parameters ?? {});
        const parameters = MET_OFFICE_PARAMETERS.filter(p => available.includes(p));
        if (parameters.length) compatible.push({ id: c.id, parameters });
        if (compatible.length >= 3) break;
      }
      // Global Spot's global domain excludes UK sites and can legitimately return
      // a nearest site hundreds of kilometres away. Prefer the discovered UK
      // collections for our configured Peterborough point, including probabilities.
      const ukCollections = compatible.filter(c => c.id.startsWith('uk-'));
      const selected = ukCollections.length ? ukCollections : compatible;
      discovery = { version: 2, checkedAt: now, collections: selected.sort((a, b) => b.parameters.length - a.parameters.length).slice(0, 3), instances: discovery.instances };
      await store.save('forecast/metoffice-discovery.json', discovery);
    }
    if (!discovery.collections.length) throw new Error('No documented compatible v2 diagnostics discovered');
    const products: MetOfficeProduct[] = [];
    const collectionErrors: string[] = [];
    for (const collection of discovery.collections) {
      try {
      let instance = discovery.instances[collection.id];
      if (!instance || now - instance.checkedAt >= 6 * HOUR) {
        const list = await get(`/collections/${safeId(collection.id)}/instances`);
        const entries = list.instances ?? list.collections;
        if (!Array.isArray(entries)) throw new RangeError('Invalid Met Office instances');
        const latest = entries.filter((i: { id?: string }) => typeof i.id === 'string').sort((a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id))[0];
        if (!latest) throw new Error('No available Met Office instance');
        const issue = utc(latest.id);
        instance = { checkedAt: now, id: latest.id, issuedAt: finite(issue) ? issue : null };
        discovery.instances[collection.id] = instance;
        await store.save('forecast/metoffice-discovery.json', discovery);
      }
      const params = new URLSearchParams({ coords: `POINT(${LOCATION.longitude} ${LOCATION.latitude})`, 'parameter-name': collection.parameters.join(','), datetime: `${new Date(Math.floor(now / HOUR) * HOUR).toISOString()}/${new Date(now + 168 * HOUR).toISOString()}` });
      const raw = await get(`/collections/${safeId(collection.id)}/instances/${safeId(instance.id)}/position?${params}`);
      // A dynamic blend may have no genuine issue time. Preserve that fact; fetch time
      // is a recency fallback only, never an invented model initialisation.
      products.push(parseMetOffice(raw, LOCATION, instance.issuedAt, now));
      } catch (error) { collectionErrors.push(`${collection.id}: ${String(error)}`); }
    }
    const first = products.sort((a, b) => a.site.distanceKm - b.site.distanceKm)[0];
    if (!first) throw new RangeError('No compatible Met Office collection returned a site');
    const matching = products.filter(p => p.site.id === first.site.id);
    for (const p of products.filter(p => p.site.id !== first.site.id)) collectionErrors.push(`Excluded different nearest site ${p.site.id} (${p.site.distanceKm.toFixed(1)} km); quantities from different locations are not combined`);
    const product: MetOfficeProduct = { ...first, issuedAt: matching.every(p => p.issuedAt === first.issuedAt) ? first.issuedAt : null, validFrom: Math.min(...matching.map(p => p.validFrom)), validTo: Math.max(...matching.map(p => p.validTo)), values: matching.flatMap(p => p.values), diagnostics: [...matching.flatMap(p => p.diagnostics), ...collectionErrors] };
    let previous: MetOfficeProduct | null = null;
    try { previous = await store.read<MetOfficeProduct | null>('forecast/metoffice.json', null); } catch { /* new valid product replaces a malformed optional cache */ }
    const identity = (v: MetOfficeProduct['values'][number]) => `${v.parameter}:${v.start}:${v.end}:${v.statistic}:${v.threshold}`;
    const oldValues = new Map((previous?.values ?? []).map(v => [identity(v), v.value]));
    const overlaps = product.values.filter(v => oldValues.has(identity(v)));
    const unchanged = previous?.site.id === product.site.id && overlaps.length > 0 && overlaps.every(v => oldValues.get(identity(v)) === v.value);
    product.firstSeenAt = unchanged ? previous!.firstSeenAt ?? previous!.fetchedAt : now;
    await store.save('forecast/metoffice.json', product);
    await store.save('forecast/metoffice-status.json', { checkedAt: now, connected: true, reason: 'Shared v2 product collected; compatible fresh diagnostics contribute within UKMO only', callsToday: budget.calls, limit: 48, site: product.site });
  } catch (error) {
    await store.save('forecast/metoffice-status.json', { checkedAt: now, connected: false, reason: String(error), callsToday: budget.calls, limit: 48 });
  }
}
