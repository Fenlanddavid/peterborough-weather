/** Optional public-repository collectors. No browser credentials or paid service. */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { scheduledFetch } from '../src/data/scheduler.ts';
import { parseMetars, evaluateVerification } from '../src/verification/verification.ts';
import type { Observation, VerificationForecast } from '../src/verification/verification.ts';
import { parseAuroraWatch } from '../src/sky/aurora.ts';
import { parseIssTle } from '../src/astro/iss.ts';
import { DETERMINISTIC_MODELS } from '../src/config/models.ts';
import { HOUR, finite, utc } from '../src/data/contracts.ts';
import { compactForecasts, expandForecasts, compactResults, verificationIsRecent, VERIFICATION_RETENTION_MS } from './lib/verificationArchive.ts';
import type { ForecastArchiveV2, LegacyForecastArchive, VerificationProduct } from './lib/verificationArchive.ts';
const root = new URL('../public/data/', import.meta.url);
await mkdir(new URL('obs/', root), { recursive: true });
await mkdir(new URL('verification/', root), { recursive: true });
async function read<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`Collector cache ${path}:`, error); return fallback; }
}
async function save(path: string, data: unknown) {
  const destination = new URL(path, root); const temporary = new URL(`${path}.tmp`, root);
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  let previous: string | null = null;
  try { previous = await readFile(destination, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous === text) return false;
  await writeFile(temporary, text); await rename(temporary, destination); return true;
}
interface Archive { provider: string; station: Observation['station'] | null; observations: Observation[]; sourceTime: number | null; collectedAt: number; watermark: number | null; missingPeriods: string[] }
async function collectMetars() {
  const now = Date.now();
  const previous = await read<Archive>('obs/egxt.json', { provider: 'AviationWeather.gov METAR', station: null, observations: [], sourceTime: null, collectedAt: 0, watermark: null, missingPeriods: [] });
  const observations = new Map(previous.observations.map(o => [o.id, o]));
  // The service retains up to 30 days, caps most responses at 400 rows. One station/day stays bounded.
  const begin = Math.max(now - 30 * 24 * HOUR + HOUR, (previous.watermark ?? now - 30 * 24 * HOUR + HOUR) - 2 * HOUR);
  const gaps: string[] = [];
  let changed = false;
  for (let start = begin; start < now; start += 24 * HOUR) {
    const end = Math.min(now, start + 24 * HOUR);
    const params = new URLSearchParams({ ids: 'EGXT', format: 'json', date: new Date(end).toISOString(), hours: String(Math.ceil((end - start) / HOUR)) });
    try {
      const response = await scheduledFetch(`https://aviationweather.gov/api/data/metar?${params}`, { retries: 1 });
      const raw = response.status === 204 ? [] : await response.json();
      if (!Array.isArray(raw) || raw.length >= 400) throw new RangeError('METAR result cap reached or invalid schema; refusing truncated archive');
      const next = parseMetars(raw, now);
      if (!next.length) gaps.push(`${new Date(start).toISOString()}–${new Date(end).toISOString()}: no EGXT reports returned`);
      for (const o of next) if (!observations.has(o.id)) { observations.set(o.id, o); changed = true; }
    } catch (error) { gaps.push(`${new Date(start).toISOString()}: ${String(error)}`); console.error(gaps.at(-1)); }
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  const rows = [...observations.values()].filter(o => o.time >= now - 100 * 24 * HOUR).sort((a, b) => a.time - b.time);
  if (!rows.length) throw new Error('No valid METAR observations; previous archive retained');
  if (changed || gaps.length) await save('obs/egxt.json', { provider: 'AviationWeather.gov METAR', station: rows[0].station, observations: rows, sourceTime: rows.at(-1)!.time, collectedAt: now, watermark: gaps.length ? previous.watermark : now, missingPeriods: gaps });
  console.log(`METAR ${rows.length} reports across ${new Set(rows.map(o => new Date(o.time).toISOString().slice(0, 10))).size} UTC dates; ${gaps.length} gaps`);
}
async function collectWatch() {
  const xml = await (await scheduledFetch('https://aurorawatch-api.lancs.ac.uk/0.2/status/current-status.xml')).text();
  const parsed = parseAuroraWatch(xml);
  const previous = await read<{ xml?: string }>('aurorawatch.json', {});
  if (previous.xml !== xml) await save('aurorawatch.json', { xml, sourceTime: parsed.sourceTime, collectedAt: Date.now(), provider: parsed.provider });
}
async function collectIss() {
  const meta = await read<{ collectedAt?: number }>('iss-tle.meta.json', {});
  if (meta.collectedAt && Date.now() - meta.collectedAt < 12 * HOUR) return;
  const text = await (await scheduledFetch('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE')).text();
  const parsed = parseIssTle(text);
  if (await save('iss-tle.txt', text)) await save('iss-tle.meta.json', { sourceTime: parsed.epoch, collectedAt: Date.now(), provider: parsed.provider });
}
async function collectVerification() {
  const now = Date.now();
  // Missing files can bootstrap; malformed existing archives must never silently
  // become empty archives on a partially successful provider response.
  const strictRead = async <T>(path: string, fallback: T): Promise<T> => {
    try { return JSON.parse(await readFile(new URL(path, root), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
  };
  const archive = await strictRead<Archive | null>('obs/egxt.json', null);
  if (!archive?.station) throw new Error('Collect EGXT observations before station-matched forecasts');
  const station = archive.station;
  const previous = await strictRead<ForecastArchiveV2 | LegacyForecastArchive>('verification/forecasts.json', { station, forecasts: [] });
  const history = await strictRead<VerificationProduct | null>('verification/results.json', null);
  const existing = expandForecasts(previous);
  // Migrate before the daily gate, preserving the exact existing scores and
  // collectedAt. A recent hourly v1 run must not postpone the initial migration.
  if (previous.version === undefined && existing.length) await save('verification/forecasts.json', JSON.stringify(compactForecasts(existing, previous.station, now)));
  if (history) await save('verification/results.json', JSON.stringify(compactResults(history, now)));
  if (verificationIsRecent(history, now)) {
    console.log('Verification collected less than 20 hours ago; retaining scores without provider requests');
    return;
  }
  const key = (f: VerificationForecast) => `${f.modelId}:${f.validTime}:${f.leadHours}:${f.variable}`;
  const forecasts = new Map(existing.map(f => [key(f), f]));
  const offsets = [1, 2, 3, 5, 7];
  const variables = offsets.map(day => `temperature_2m_previous_day${day}`);
  const failures: string[] = [];
  let successfulModels = 0;
  for (const model of DETERMINISTIC_MODELS) {
    const params = new URLSearchParams({ latitude: String(station.latitude), longitude: String(station.longitude), elevation: String(station.elevation), models: model.id, hourly: variables.join(','), past_days: '7', forecast_days: '1', timezone: 'GMT', temperature_unit: 'celsius' });
    try {
      const response = await scheduledFetch(`https://previous-runs-api.open-meteo.com/v1/forecast?${params}`, { optional: true });
      const raw = await response.json();
      if (!raw?.hourly || !Array.isArray(raw.hourly.time) || raw.utc_offset_seconds !== 0 || !finite(raw.latitude) || !finite(raw.longitude) || !finite(raw.elevation)) throw new RangeError('Invalid verification forecast location/time');
      const next: VerificationForecast[] = [];
      for (const day of offsets) {
        const field = `temperature_2m_previous_day${day}`;
        const values = raw.hourly[field];
        if (!Array.isArray(values)) continue;
        if (raw.hourly_units?.[field] !== '°C' || values.length !== raw.hourly.time.length) throw new RangeError(`Invalid verification units/length ${field}`);
        raw.hourly.time.forEach((time: unknown, i: number) => {
          const validTime = typeof time === 'string' ? utc(time) : NaN;
          if (!finite(validTime) || !finite(values[i]) || validTime > now) return;
          next.push({ modelId: model.id, family: model.family, validTime, leadHours: day * 24, variable: 'temperature', value: values[i], station, forecastLocation: { latitude: raw.latitude, longitude: raw.longitude, elevation: raw.elevation }, provider: 'Open-Meteo Previous Runs', issuedAt: null, sourceTime: null, fetchedAt: now, unit: '°C', measurementCompatible: true });
        });
      }
      if (next.length) successfulModels++;
      for (const forecast of next) if (!forecasts.has(key(forecast))) forecasts.set(key(forecast), forecast);
    } catch (error) { const message = `${model.id}: ${String(error)}`; failures.push(message); console.error(message); }
  }
  if (!successfulModels) throw new Error('No usable temperature responses; previous verification retained for retry');
  const rows = [...forecasts.values()].filter(f => f.validTime >= now - VERIFICATION_RETENTION_MS).sort((a, b) => a.validTime - b.validTime || key(a).localeCompare(key(b)));
  if (!rows.length) throw new Error('No station forecasts; previous verification retained');
  const results = evaluateVerification(rows, archive.observations, now);
  await save('verification/forecasts.json', JSON.stringify(compactForecasts(rows, station, now)));
  await save('verification/results.json', JSON.stringify(compactResults({ ...history, station, provider: 'AviationWeather / Open-Meteo Previous Runs', sourceTime: archive.sourceTime, collectedAt: now, results, correctionEnabled: false, reweightingEnabled: false, failures }, now)));
}
const requested = process.argv.slice(2);
if (!requested.length) throw new Error('Specify metar, aurorawatch, iss or verification');
for (const source of requested) {
  try {
    if (source === 'metar') await collectMetars(); else if (source === 'aurorawatch') await collectWatch(); else if (source === 'iss') await collectIss(); else if (source === 'verification') await collectVerification(); else throw new Error(`Unknown collector ${source}`);
  } catch (error) { console.error(`${source}: ${String(error)}; existing valid files retained`); process.exitCode = 1; }
}
