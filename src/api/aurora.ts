/**
 * Aurora / geomagnetic data from NOAA Space Weather Prediction Center (SWPC).
 *
 * At Peterborough (52.57°N), aurora is typically visible when Kp ≥ 7.
 * Kp 5–6 means aurora is possible from Scotland/Northern England.
 * Kp 8+ means a good chance of aurora across central England.
 */

const CACHE_KEY = 'pb-weather:aurora:v2';
const CACHE_TTL = 30 * 60_000; // 30 minutes

export interface KpForecastEntry {
  time: string;    // UTC time string
  kp: number;      // Predicted Kp index (0–9)
  observed: boolean;
}

export interface AuroraData {
  current: { kp: number; time: string } | null;
  forecast: KpForecastEntry[];
  maxKp3Day: number;
  /** Visibility assessment for Peterborough */
  visibility: 'None expected' | 'Unlikely' | 'Possible' | 'Good chance' | 'Strong display likely';
  /** Brief explanation */
  visibilityNote: string;
  fetchedAt: number;
}

/** Kp threshold for Peterborough at 52.57°N geomagnetic latitude */
function assessVisibility(maxKp: number): Pick<AuroraData, 'visibility' | 'visibilityNote'> {
  // Geomagnetic latitude of Peterborough is roughly 54.5°N (higher than geographic)
  if (maxKp >= 9) return {
    visibility: 'Strong display likely',
    visibilityNote: `Kp ${maxKp} — a severe storm. Aurora should be visible across England, potentially to the south. Look north for curtains of light.`,
  };
  if (maxKp >= 8) return {
    visibility: 'Good chance',
    visibilityNote: `Kp ${maxKp} — a strong storm. Aurora may be visible low on the northern horizon from Peterborough. Find a dark site with a clear view north.`,
  };
  if (maxKp >= 7) return {
    visibility: 'Possible',
    visibilityNote: `Kp ${maxKp} — aurora may reach central England. Check for a faint glow or green tint low on the northern horizon after dark.`,
  };
  if (maxKp >= 5) return {
    visibility: 'Unlikely',
    visibilityNote: `Kp ${maxKp} — aurora is active at higher latitudes. Unlikely from Peterborough but possible from Scotland or northern England.`,
  };
  return {
    visibility: 'None expected',
    visibilityNote: 'Geomagnetic activity is quiet. Aurora is not expected at Peterborough\'s latitude.',
  };
}

/** Parse the NOAA Kp forecast JSON */
function parseForecast(raw: Array<{ time_tag: string; kp: number; observed: string }>): KpForecastEntry[] {
  return raw.map((entry) => ({
    time: entry.time_tag,
    kp: entry.kp ?? 0,
    observed: entry.observed === 'observed',
  }));
}

/** Fetch the latest 1-minute Kp observation */
async function fetchCurrentKp(): Promise<{ kp: number; time: string } | null> {
  try {
    const res = await fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const data = await res.json() as Array<{ time_tag: string; kp_index: number }>;
    if (!data.length) return null;
    const latest = data[data.length - 1];
    return { kp: latest.kp_index, time: latest.time_tag };
  } catch {
    return null;
  }
}

/** Fetch 3-day Kp forecast from NOAA SWPC */
async function fetchKpForecast(): Promise<KpForecastEntry[]> {
  try {
    const res = await fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json', { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = await res.json();
    return parseForecast(data);
  } catch {
    return [];
  }
}

/** NOAA includes historical observations before its predictions. Keep the current and upcoming blocks. */
export function upcomingKpForecast(entries: KpForecastEntry[], now = Date.now()): KpForecastEntry[] {
  return entries.filter((entry) => {
    const time = Date.parse(entry.time.endsWith('Z') ? entry.time : `${entry.time}Z`);
    return !entry.observed && Number.isFinite(entry.kp) && entry.kp >= 0 && entry.kp <= 9
      && time + 3 * 3600_000 > now && time < now + 72 * 3600_000;
  }).sort((a, b) => a.time.localeCompare(b.time));
}

/** Fetch aurora data with localStorage caching */
export async function fetchAuroraData(force = false): Promise<AuroraData | null> {
  // Check cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (!force && cached) {
      const parsed = JSON.parse(cached) as AuroraData;
      if (Date.now() - parsed.fetchedAt < CACHE_TTL) return parsed;
    }
  } catch { /* ignore corrupt cache */ }

  const [current, history] = await Promise.all([fetchCurrentKp(), fetchKpForecast()]);

  const forecast = upcomingKpForecast(history);
  if (!current && forecast.length === 0) return null;

  const allKp = [...forecast.map((f) => f.kp), ...(current ? [current.kp] : [])];
  const maxKp3Day = Math.max(...allKp, 0);
  const { visibility, visibilityNote } = assessVisibility(maxKp3Day);

  const result: AuroraData = {
    current,
    forecast,
    maxKp3Day,
    visibility,
    visibilityNote,
    fetchedAt: Date.now(),
  };

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch { /* storage full */ }

  return result;
}

/** Kp level colour for UI */
export function kpColour(kp: number): string {
  if (kp >= 8) return '#ef6b73';
  if (kp >= 6) return '#f2bb9d';
  if (kp >= 4) return '#eed49d';
  if (kp >= 2) return '#b5dacd';
  return '#a6b2c5';
}

/** Kp level label */
export function kpLabel(kp: number): string {
  if (kp >= 8) return 'Severe storm';
  if (kp >= 7) return 'Strong storm';
  if (kp >= 6) return 'Moderate storm';
  if (kp >= 5) return 'Minor storm';
  if (kp >= 4) return 'Active';
  if (kp >= 2) return 'Unsettled';
  return 'Quiet';
}
