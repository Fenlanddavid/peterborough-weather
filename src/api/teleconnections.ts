const API_BASE = 'https://enso-teleconnections.christopherwcorwin.workers.dev/api/teleconnections';
const CACHE_KEY = 'pb-weather:teleconnections:v2';
const CACHE_AGE = 6 * 3600_000; // 6 hours

export interface TeleconnectionIndex {
  slug: string;
  name: string;
  value: number;
  date: string;
  trend?: 'rising' | 'falling' | 'steady';
}

export interface MJOData {
  phase: number;
  amplitude: number;
  rmm1: number;
  rmm2: number;
  date: string;
}

export interface TeleconnectionSnapshot {
  nao: TeleconnectionIndex | null;
  ao: TeleconnectionIndex | null;
  enso: TeleconnectionIndex | null;
  pna: TeleconnectionIndex | null;
  ea: TeleconnectionIndex | null;
  scand: TeleconnectionIndex | null;
  mjo: MJOData | null;
  fetchedAt: number;
}

interface CachedSnapshot {
  data: TeleconnectionSnapshot;
  fetchedAt: number;
}

function readCache(key: string): CachedSnapshot | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!saved || !isFiniteNumber(saved.fetchedAt) || saved.fetchedAt < 0 || saved.fetchedAt > Date.now() + 60_000) return null;
    const data = saved.data;
    if (!isRecord(data) || data.fetchedAt !== saved.fetchedAt) return null;
    const indices = ['nao', 'ao', 'enso', 'pna', 'ea', 'scand'];
    if (!indices.every((slug) => data[slug] === null || validIndex(data[slug]))) return null;
    if (data.mjo !== null && !validMJO(data.mjo)) return null;
    if (!indices.some((slug) => data[slug] !== null) && data.mjo === null) return null;
    return saved;
  } catch { return null; }
}

function writeCache(key: string, data: TeleconnectionSnapshot): void {
  try { localStorage.setItem(key, JSON.stringify({ data, fetchedAt: data.fetchedAt })); } catch { /* storage full */ }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validIndex(value: unknown): value is TeleconnectionIndex {
  return isRecord(value) && isFiniteNumber(value.value) && typeof value.date === 'string'
    && typeof value.slug === 'string' && typeof value.name === 'string';
}

function validMJO(value: unknown): value is MJOData {
  return isRecord(value) && isFiniteNumber(value.phase) && Number.isInteger(value.phase)
    && value.phase >= 1 && value.phase <= 8 && isFiniteNumber(value.amplitude) && value.amplitude >= 0
    && isFiniteNumber(value.rmm1) && isFiniteNumber(value.rmm2) && typeof value.date === 'string';
}

/** Extract an index from the flat API response object (keyed by slug). */
function extractIndex(body: unknown, slug: string): TeleconnectionIndex | null {
  const item = isRecord(body) ? body[slug] : null;
  if (!isRecord(item) || !isFiniteNumber(item.value)) return null;
  return {
    slug,
    name: typeof item.name === 'string' ? item.name : slug.toUpperCase(),
    value: item.value,
    date: typeof item.updated === 'string' ? item.updated : '',
    // The API's phase describes the sign, not the direction of change.
  };
}

async function fetchJSON(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error('Teleconnection data unavailable');
  return response.json();
}

let pending: Promise<TeleconnectionSnapshot> | null = null;

export function fetchTeleconnections(force = false): Promise<TeleconnectionSnapshot> {
  const cached = readCache(CACHE_KEY);
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_AGE) return Promise.resolve(cached.data);
  if (pending) return pending;

  pending = (async () => {
    const fetchedAt = Date.now();
    const snapshot: TeleconnectionSnapshot = {
      nao: null, ao: null, enso: null, pna: null, ea: null, scand: null, mjo: null, fetchedAt,
    };

    // One unavailable endpoint must not discard the other endpoint's data.
    const [main, mjo] = await Promise.allSettled([
      fetchJSON(API_BASE),
      fetchJSON(`${API_BASE}/mjo`),
    ]);

    if (main.status === 'fulfilled') {
      for (const slug of ['nao', 'ao', 'enso', 'pna', 'ea', 'scand'] as const) {
        snapshot[slug] = extractIndex(main.value, slug);
      }
    }

    if (mjo.status === 'fulfilled' && isRecord(mjo.value)) {
      const latest = mjo.value.latest ?? mjo.value;
      if (validMJO(latest)) snapshot.mjo = latest;
    }

    const hasIndices = snapshot.nao || snapshot.ao || snapshot.enso || snapshot.pna || snapshot.ea || snapshot.scand;
    if (!hasIndices && !snapshot.mjo) {
      throw new Error('Teleconnection data unavailable');
    }
    // Keep the previous successful cache when a refresh is incomplete.
    if (hasIndices && snapshot.mjo) writeCache(CACHE_KEY, snapshot);
    return snapshot;
  })().finally(() => { pending = null; });

  return pending;
}

export function readTeleconnections(): TeleconnectionSnapshot | null {
  return readCache(CACHE_KEY)?.data ?? null;
}
